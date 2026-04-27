"""
Tedarikçi Siparişleri (Hikrobot Proforma → TG Purchase).
"""
from typing import Optional
from datetime import datetime
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from pydantic import BaseModel

from app.core.auth import get_current_user
from app.core.database import get_db
from app.models.product import Product
from app.models.purchase_match import PurchaseMatch
from app.services import pdf_parser, teamgram


def _normalize_pdf_name(name: str) -> str:
    """PDF adını eşleştirme amacıyla normalize eder (lowercase, fazla boşluk temizleme)."""
    if not name:
        return ""
    import re
    s = name.strip().lower()
    s = re.sub(r"\s+", " ", s)
    return s

router = APIRouter()

# ─── Sabit TG ID'ler (Hikrobot için) ─────────────────────────────────
HIKROBOT_COMPANY_ID = 28599315
SUN_ZHIPING_CONTACT_ID = 28599320
URETIM_BEKLENIYOR_STAGE_ID = 196785
DEFAULT_DELIVERY_ADDRESS = (
    "Mustafa Kemal Mah. Dumlupınar Blv. No: 280G İç Kapı No:1260 Çankaya/Ankara"
)


# ─── Pydantic ─────────────────────────────────────────────────────────
class PurchaseItemIn(BaseModel):
    product_id: int             # local Product.id (eşleşen TG ürün)
    tg_product_id: int          # Product.tg_id
    product_name: str           # TG'de görünür ad (Displayname veya pdf adı)
    description: Optional[str] = None
    quantity: float
    unit_price: float
    vat: Optional[float] = 20.0
    unit: Optional[str] = "adet"


class CreatePurchaseIn(BaseModel):
    supplier: str = "Hikrobot"
    name: str                   # Sipariş adı (örn. "Hikrobot Proforma A2603...")
    po_no: Optional[str] = None
    delivery_address: str = DEFAULT_DELIVERY_ADDRESS
    billing_address: str = DEFAULT_DELIVERY_ADDRESS
    currency: str = "USD"
    items: list[PurchaseItemIn]


# ─── PDF Parse + Eşleştirme ──────────────────────────────────────────
@router.post("/parse-pdf")
async def parse_pdf(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """PDF'i parse eder, ürünleri lokal DB ile eşleştirir."""
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Sadece PDF dosyası yükleyin")

    content = await file.read()
    parsed = pdf_parser.parse_proforma(content)

    if not parsed["items"]:
        raise HTTPException(400, "PDF'te ürün bulunamadı veya format desteklenmiyor")

    # Her item için lokal ürünle eşleştirme dene
    enriched_items = []
    for it in parsed["items"]:
        match = _match_product(db, it["product_name"])
        enriched_items.append({
            **it,
            "match": _product_to_match_dict(match) if match else None,
        })

    return {
        "supplier": parsed["supplier"],
        "po_no": parsed["po_no"],
        "currency": parsed["currency"],
        "doc_total_quantity": parsed.get("doc_total_quantity"),
        "doc_total_amount": parsed.get("doc_total_amount"),
        "items": enriched_items,
    }


def _match_product(db: Session, raw_name: str) -> Optional[Product]:
    """
    PDF'teki ürün adıyla lokal Product tablosunda eşleşme arar.
    Strateji:
      0. Önceden kaydedilmiş manuel eşleşme (purchase_matches tablosu)
      1. Tam prod_model eşleşmesi
      2. Prod_model substring (case-insensitive)
      3. SKU substring
    """
    if not raw_name:
        return None
    name = raw_name.strip()

    # 0. Cache lookup
    norm = _normalize_pdf_name(name)
    cached = db.query(PurchaseMatch).filter(PurchaseMatch.pdf_name_norm == norm).first()
    if cached:
        p = db.query(Product).filter(Product.id == cached.product_id).first()
        if p:
            return p

    # 1. Tam prod_model eşleşmesi
    p = db.query(Product).filter(Product.prod_model.ilike(name)).first()
    if p:
        return p

    # 2. Prod_model substring (PDF adı içinde model varsa veya tersi)
    candidates = db.query(Product).filter(
        Product.prod_model.isnot(None)
    ).all()
    name_upper = name.upper()
    for c in candidates:
        pm = (c.prod_model or "").strip().upper()
        if not pm:
            continue
        if pm == name_upper or pm in name_upper or name_upper in pm:
            return c

    # 3. SKU substring
    p = db.query(Product).filter(Product.sku.ilike(f"%{name}%")).first()
    return p


def _product_to_match_dict(p: Product) -> dict:
    return {
        "id": p.id,
        "tg_id": p.tg_id,
        "brand": p.brand,
        "prod_model": p.prod_model,
        "sku": p.sku,
        "displayname": f"{p.brand or ''} - {p.prod_model or ''}".strip(" -"),
    }


# ─── Manuel Ürün Arama ───────────────────────────────────────────────
@router.get("/products/search")
def search_products(
    q: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Manuel ürün eşleştirmesi için arama (prod_model, sku, brand)."""
    pattern = f"%{q}%"
    rows = db.query(Product).filter(
        or_(
            Product.prod_model.ilike(pattern),
            Product.sku.ilike(pattern),
            Product.brand.ilike(pattern),
        )
    ).limit(20).all()
    return [_product_to_match_dict(p) for p in rows]


# ─── Manuel Eşleşmeyi Kaydet (gelecek PDF'ler için) ──────────────────
class SaveMatchIn(BaseModel):
    pdf_name: str
    product_id: int


@router.post("/match")
def save_match(
    data: SaveMatchIn,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """PDF adı → ürün eşleşmesini kaydeder. Aynı pdf_name varsa günceller."""
    norm = _normalize_pdf_name(data.pdf_name)
    if not norm:
        raise HTTPException(400, "PDF adı boş")

    # Ürün var mı kontrolü
    p = db.query(Product).filter(Product.id == data.product_id).first()
    if not p:
        raise HTTPException(404, "Ürün bulunamadı")

    existing = db.query(PurchaseMatch).filter(PurchaseMatch.pdf_name_norm == norm).first()
    if existing:
        existing.product_id = data.product_id
        existing.pdf_name_raw = data.pdf_name
    else:
        existing = PurchaseMatch(
            pdf_name_norm=norm,
            pdf_name_raw=data.pdf_name,
            product_id=data.product_id,
        )
        db.add(existing)
    db.commit()
    return {"ok": True, "id": existing.id}


# ─── TG'de Sipariş Oluştur ───────────────────────────────────────────
@router.post("/create")
async def create_purchase(
    data: CreatePurchaseIn,
    user=Depends(get_current_user),
):
    """Parse edilen ve eşleştirilen veriden TG'de tedarikçi siparişi oluşturur."""
    if user.role != "admin":
        raise HTTPException(403, "Sadece yönetici tedarikçi siparişi oluşturabilir")

    if not data.items:
        raise HTTPException(400, "Ürün listesi boş")

    # Hikrobot dışı tedarikçi şimdilik desteklenmiyor
    if data.supplier.lower() != "hikrobot":
        raise HTTPException(400, f"'{data.supplier}' tedarikçisi henüz desteklenmiyor")

    # TG payload'unu hazırla
    payload = {
        "Name": data.name,
        "OrderDate": datetime.utcnow().strftime("%Y-%m-%dT00:00:00"),
        "Stage": 0,
        "Status": 0,                                # Talep Edildi
        "CustomStageId": URETIM_BEKLENIYOR_STAGE_ID,
        "VatType": 1,                                # KDV Hariç
        "CurrencyName": data.currency,
        "RelatedEntityId": HIKROBOT_COMPANY_ID,
        "AttnId": SUN_ZHIPING_CONTACT_ID,
        "DeliveryAddress": data.delivery_address,
        "BillingAddress": data.billing_address,
        "Description": f"PO No: {data.po_no}" if data.po_no else None,
        "Items": [
            {
                "Product": {"Id": it.tg_product_id},
                "Quantity": it.quantity,
                "Price": it.unit_price,
                "CurrencyName": data.currency,
                "Vat": it.vat or 20.0,
                "Unit": it.unit or "adet",
                "Description": it.description,
                "DiscountType": 0,
                "Discount": 0,
            }
            for it in data.items
        ],
    }

    try:
        result = await teamgram.create_purchase(payload)
    except Exception as e:
        raise HTTPException(502, f"TeamGram'a yazılamadı: {e}")

    if not result.get("Result") and not result.get("Id"):
        raise HTTPException(502, f"TeamGram hatası: {result.get('Message') or result}")

    purchase_id = result.get("Id") or result.get("PurchaseId")
    return {
        "ok": True,
        "tg_purchase_id": purchase_id,
        "tg_url": f"https://www.teamgram.com/aremak/purchases/show?id={purchase_id}" if purchase_id else None,
        "raw": result,
    }
