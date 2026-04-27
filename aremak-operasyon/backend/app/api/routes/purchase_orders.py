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
from app.models.purchase_document import PurchaseDocument
from app.services import pdf_parser, teamgram

import os
import uuid as _uuid
from fastapi.responses import FileResponse

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))), "uploads", "purchase_orders")
os.makedirs(UPLOAD_DIR, exist_ok=True)


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
    order_date: Optional[str] = None    # YYYY-MM-DD; boşsa bugün
    delivery_address: str = DEFAULT_DELIVERY_ADDRESS
    billing_address: str = DEFAULT_DELIVERY_ADDRESS
    currency: str = "USD"
    items: list[PurchaseItemIn]


# ─── Liste (TG'den) ──────────────────────────────────────────────────
@router.get("/list")
async def list_purchase_orders(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Hikrobot'un TG'deki tedarikçi siparişlerini listeler.
    Toplam tutar: kalemlerden hesaplanır (KDV hariç) — TG'nin DiscountedTotal'ı KDV dahil ve TL'ye çevrilmiş."""
    import asyncio

    try:
        data = await teamgram.get_purchases(page=1, pagesize=50, party_id=HIKROBOT_COMPANY_ID)
    except Exception as e:
        raise HTTPException(502, f"TG'den siparişler alınamadı: {e}")

    list_rows = data.get("List") or []

    # Her sipariş için detay çek (parallel) ki kalemlerden KDV hariç toplam çıkarabilelim
    detail_tasks = [teamgram.get_purchase(p.get("Id")) for p in list_rows if p.get("Id")]
    details = await asyncio.gather(*detail_tasks, return_exceptions=True)

    # Lokal PDF kayıtlarını çek
    tg_ids = [p.get("Id") for p in list_rows if p.get("Id")]
    docs = {d.tg_purchase_id: d for d in db.query(PurchaseDocument).filter(PurchaseDocument.tg_purchase_id.in_(tg_ids)).all()}

    items = []
    for p, d in zip(list_rows, details):
        # Detay başarısızsa fallback olarak TG total'ı kullan
        calc_total = None
        item_currency = None
        if isinstance(d, dict):
            tg_items = d.get("Items") or []
            calc_total = sum((it.get("LineTotal") or 0) for it in tg_items)
            if tg_items:
                item_currency = tg_items[0].get("CurrencyName")

        doc = docs.get(p.get("Id"))
        items.append({
            "id": p.get("Id"),
            "name": p.get("Name") or p.get("Displayname"),
            "displayname": p.get("Displayname"),
            "order_date": (p.get("OrderDate") or "")[:10],
            "stage_name": p.get("CustomStageName"),
            "status": p.get("Status"),
            "total": calc_total if calc_total is not None else p.get("DiscountedTotal"),
            "currency": item_currency or p.get("CurrencyName"),
            "supplier": (p.get("RelatedEntity") or {}).get("Name"),
            "modified_date": (p.get("ModifiedDate") or "")[:10],
            "tg_url": f"https://www.teamgram.com/aremak/purchases/show?id={p.get('Id')}",
            "document_url": doc.file_url if doc else None,
            "document_name": doc.original_name if doc else None,
        })
    return {"items": items, "count": len(items)}


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
        "order_date": parsed.get("order_date"),
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


# ─── PDF Belge Yükleme (lokal storage) ───────────────────────────────
@router.post("/{tg_purchase_id}/document")
async def upload_purchase_document(
    tg_purchase_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Tedarikçi siparişine ait Proforma PDF'ini lokal sunucuya kaydeder.
    (TG attachment-type custom field'ı API'dan set edilemediği için lokal saklıyoruz.)"""
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Sadece PDF kabul edilir")

    content = await file.read()

    # Dosya adı: purchase_<tg_id>_<uuid>.pdf
    fname = f"purchase_{tg_purchase_id}_{_uuid.uuid4().hex[:8]}.pdf"
    fpath = os.path.join(UPLOAD_DIR, fname)
    with open(fpath, "wb") as f:
        f.write(content)

    file_url = f"/uploads/purchase_orders/{fname}"

    # DB'de upsert
    existing = db.query(PurchaseDocument).filter(PurchaseDocument.tg_purchase_id == tg_purchase_id).first()
    if existing:
        # Eski dosyayı sil
        try:
            old_path = os.path.join(UPLOAD_DIR, os.path.basename(existing.file_url))
            if os.path.exists(old_path):
                os.remove(old_path)
        except Exception:
            pass
        existing.file_url = file_url
        existing.original_name = file.filename
        existing.content_type = file.content_type or "application/pdf"
        existing.size = len(content)
    else:
        existing = PurchaseDocument(
            tg_purchase_id=tg_purchase_id,
            file_url=file_url,
            original_name=file.filename,
            content_type=file.content_type or "application/pdf",
            size=len(content),
        )
        db.add(existing)
    db.commit()
    return {"ok": True, "file_url": file_url, "original_name": existing.original_name}


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
    order_date_str = (data.order_date or datetime.utcnow().strftime("%Y-%m-%d")) + "T00:00:00"
    payload = {
        "Name": data.name,
        "OrderDate": order_date_str,
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


# ─── Detay (TG'den) — DİKKAT: Bu route en sonda olmalı (catch-all path param) ─
@router.get("/{purchase_id}")
async def get_purchase_order(
    purchase_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Tek bir tedarikçi siparişinin TG detayını döner."""
    try:
        d = await teamgram.get_purchase(purchase_id)
    except Exception as e:
        raise HTTPException(502, f"TG'den sipariş alınamadı: {e}")

    if not d or not d.get("Id"):
        raise HTTPException(404, "Sipariş bulunamadı")

    # Lokal PDF
    doc = db.query(PurchaseDocument).filter(PurchaseDocument.tg_purchase_id == purchase_id).first()

    items = []
    for it in (d.get("Items") or []):
        prod = it.get("Product") or {}
        items.append({
            "item_id": it.get("ItemId"),
            "tg_product_id": prod.get("Id"),
            "brand": prod.get("Brand"),
            "prod_model": prod.get("ProdModel"),
            "displayname": prod.get("Displayname"),
            "sku": prod.get("Sku"),
            "quantity": it.get("Quantity"),
            "unit": it.get("Unit"),
            "unit_price": it.get("Price"),
            "line_total": it.get("LineTotal"),
            "currency": it.get("CurrencyName"),
            "vat": it.get("Vat"),
            "description": it.get("Description"),
        })

    related = d.get("RelatedEntity") or {}
    attn = d.get("Attn") or {}
    owner = d.get("Owner") or {}

    return {
        "id": d.get("Id"),
        "name": d.get("Name"),
        "displayname": d.get("Displayname"),
        "order_date": (d.get("OrderDate") or "")[:10],
        "stage_name": d.get("CustomStageName"),
        "stage_id": d.get("CustomStageId"),
        "status": d.get("Status"),
        "total": d.get("DiscountedTotal"),
        "currency": d.get("CurrencyName"),
        "supplier": {
            "id": related.get("Id"),
            "name": related.get("Name") or related.get("Displayname"),
        },
        "contact": {
            "id": attn.get("Id"),
            "name": attn.get("Displayname") or f"{attn.get('Name') or ''} {attn.get('LastName') or ''}".strip(),
        },
        "owner": {
            "id": owner.get("Id"),
            "name": owner.get("Displayname"),
        },
        "delivery_address": d.get("DeliveryAddress"),
        "billing_address": d.get("BillingAddress"),
        "supplier_address": d.get("SupplierAddress"),
        "description": d.get("Description"),
        "entered_date": d.get("EnteredDate"),
        "modified_date": d.get("ModifiedDate"),
        "items": items,
        "tg_url": f"https://www.teamgram.com/aremak/purchases/show?id={d.get('Id')}",
        "document_url": doc.file_url if doc else None,
        "document_name": doc.original_name if doc else None,
    }
