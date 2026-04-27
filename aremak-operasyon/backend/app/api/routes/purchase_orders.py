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
from app.models.purchase_receipt_document import PurchaseReceiptDocument
from app.models.archive_purchase import ArchivePurchaseOrder, ArchivePurchaseItem
from app.services import pdf_parser, excel_parser, teamgram

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

    # Lokal PDF + CI Excel kayıtlarını çek
    tg_ids = [p.get("Id") for p in list_rows if p.get("Id")]
    docs = {d.tg_purchase_id: d for d in db.query(PurchaseDocument).filter(PurchaseDocument.tg_purchase_id.in_(tg_ids)).all()}
    receipts = {d.tg_purchase_id: d for d in db.query(PurchaseReceiptDocument).filter(PurchaseReceiptDocument.tg_purchase_id.in_(tg_ids)).all()}

    by_id: dict[int, dict] = {}
    for p, d in zip(list_rows, details):
        # Detay başarısızsa fallback olarak TG total'ı kullan
        calc_total = None
        item_currency = None
        is_split = False
        parent_id = None
        if isinstance(d, dict):
            tg_items = d.get("Items") or []
            calc_total = sum((it.get("LineTotal") or 0) for it in tg_items)
            if tg_items:
                item_currency = tg_items[0].get("CurrencyName")
            is_split = bool(d.get("IsSplit"))
            parent_sale = d.get("ParentSale") or {}
            try:
                parent_id = int(parent_sale.get("Id")) if parent_sale.get("Id") else None
            except (TypeError, ValueError):
                parent_id = None

        doc = docs.get(p.get("Id"))
        rcp = receipts.get(p.get("Id"))
        actual_fulfilment = (d.get("ActualFulfilment") or "")[:10] if isinstance(d, dict) else ""
        scheduled_fulfilment = (d.get("ScheduledFulfilment") or "")[:10] if isinstance(d, dict) else ""
        by_id[p.get("Id")] = {
            "id": p.get("Id"),
            "name": p.get("Name") or p.get("Displayname"),
            "displayname": p.get("Displayname"),
            "order_date": (p.get("OrderDate") or "")[:10],
            "delivery_date": actual_fulfilment or None,
            "scheduled_delivery_date": scheduled_fulfilment or None,
            "stage_name": p.get("CustomStageName"),
            "status": p.get("Status"),
            "total": calc_total if calc_total is not None else p.get("DiscountedTotal"),
            "currency": item_currency or p.get("CurrencyName"),
            "supplier": (p.get("RelatedEntity") or {}).get("Name"),
            "modified_date": (p.get("ModifiedDate") or "")[:10],
            "tg_url": f"https://www.teamgram.com/aremak/purchases/show?id={p.get('Id')}",
            "document_url": doc.file_url if doc else None,
            "document_name": doc.original_name if doc else None,
            "receipt_url": rcp.file_url if rcp else None,
            "receipt_name": rcp.original_name if rcp else None,
            "is_split": is_split,
            "parent_id": parent_id,
            "children": [],
        }

    # Ağaç oluştur — child'ları parent'a ekle, sadece top-level olanları root'ta tut
    roots = []
    for it in by_id.values():
        pid = it.get("parent_id")
        if pid and pid in by_id:
            by_id[pid]["children"].append(it)
        else:
            roots.append(it)

    # Boş children'ları temizle (Ant Design Table boş array'i de + ile gösterir)
    for it in by_id.values():
        if not it["children"]:
            it.pop("children", None)

    # ── Arşiv kayıtlarını ekle ──
    archives = db.query(ArchivePurchaseOrder).order_by(ArchivePurchaseOrder.order_date.desc()).all()
    for a in archives:
        roots.append({
            "id": f"archive-{a.id}",          # archive prefix — TG ID'leriyle çakışmaz
            "archive_id": a.id,
            "is_archive": True,
            "name": a.siparis_no or f"Arşiv #{a.id}",
            "displayname": a.siparis_no,
            "order_date": a.order_date,
            "delivery_date": None,
            "scheduled_delivery_date": None,
            "stage_name": "Teslim Alındı" if a.is_received else "Bekleniyor",
            "status": 1 if a.is_received else 0,
            "total": a.total,
            "currency": a.currency,
            "supplier": a.supplier_name,
            "modified_date": None,
            "tg_url": None,  # Arşivde TG sipariş linki yok (tedarikçi sayfası ayrı detay sayfasında gösteriliyor)
            "document_url": a.local_pdf_url or a.knack_pdf_url,
            "document_name": "Proforma PDF" if (a.local_pdf_url or a.knack_pdf_url) else None,
            "receipt_url": None,
            "receipt_name": None,
            "is_split": False,
            "parent_id": None,
        })

    return {"items": roots, "count": len(roots)}


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


# ─── Teslim Belgesi (CI Excel) yükle ─────────────────────────────────
@router.post("/{tg_purchase_id}/receipt-document")
async def upload_receipt_document(
    tg_purchase_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Teslim alınan siparişe ait CI Excel'ini lokal sunucuya kaydeder."""
    fname_lower = file.filename.lower()
    if not (fname_lower.endswith(".xlsx") or fname_lower.endswith(".xls")):
        raise HTTPException(400, "Sadece Excel kabul edilir")

    content = await file.read()
    fname = f"receipt_{tg_purchase_id}_{_uuid.uuid4().hex[:8]}.xlsx"
    fpath = os.path.join(UPLOAD_DIR, fname)
    with open(fpath, "wb") as f:
        f.write(content)
    file_url = f"/uploads/purchase_orders/{fname}"

    existing = db.query(PurchaseReceiptDocument).filter(
        PurchaseReceiptDocument.tg_purchase_id == tg_purchase_id
    ).first()
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
        existing.content_type = file.content_type or "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        existing.size = len(content)
    else:
        existing = PurchaseReceiptDocument(
            tg_purchase_id=tg_purchase_id,
            file_url=file_url,
            original_name=file.filename,
            content_type=file.content_type or "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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


# ─── Teslim Onayı: Excel parse ───────────────────────────────────────
@router.post("/{tg_purchase_id}/parse-receipt-excel")
async def parse_receipt_excel(
    tg_purchase_id: int,
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    """Hikrobot CI Excel'inden model_name → toplam adet eşleşmesi çıkarır."""
    if not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Sadece Excel (.xlsx) kabul edilir")
    content = await file.read()
    try:
        parsed = excel_parser.parse_ci_quantities(content)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(400, f"Excel parse edilemedi: {e}")
    return parsed


# ─── Teslim Onayı: Confirm ───────────────────────────────────────────
class ReceiptItemIn(BaseModel):
    tg_product_id: int
    ordered_qty: float
    received_qty: float
    included: bool = True
    price: float
    currency: str = "USD"
    vat: Optional[float] = 20.0
    unit: Optional[str] = "adet"
    description: Optional[str] = None


class ConfirmReceiptIn(BaseModel):
    items: list[ReceiptItemIn]


def _build_tg_item(it: "ReceiptItemIn", quantity: float) -> dict:
    return {
        "Product": {"Id": it.tg_product_id},
        "Quantity": quantity,
        "Price": it.price,
        "CurrencyName": it.currency,
        "Vat": it.vat or 20.0,
        "Unit": it.unit or "adet",
        "Description": it.description,
        "DiscountType": 0,
        "Discount": 0,
    }


@router.post("/{tg_purchase_id}/confirm-receipt")
async def confirm_receipt(
    tg_purchase_id: int,
    data: ConfirmReceiptIn,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Teslim onayı işle:
    - Tam teslim (hepsi seçili + received==ordered): parent'ı Teslim Alındı/Closed yap
    - Parçalı: 2 child sipariş yarat (alınan→Teslim Alındı, kalan→Üretim Bekliyor) + parent sil"""
    if user.role != "admin":
        raise HTTPException(403, "Sadece yönetici teslim onayı oluşturabilir")

    if not data.items:
        raise HTTPException(400, "Kalem listesi boş")

    # Effective received: included değilse 0
    received_items = []
    remaining_items = []
    for it in data.items:
        eff = it.received_qty if it.included else 0
        if eff < 0:
            raise HTTPException(400, "Negatif teslim adedi olamaz")
        if eff > it.ordered_qty:
            raise HTTPException(400, f"Teslim adedi sipariş adedinden fazla olamaz (ürün {it.tg_product_id})")
        if eff > 0:
            received_items.append((it, eff))
        leftover = it.ordered_qty - eff
        if leftover > 0:
            remaining_items.append((it, leftover))

    if not received_items:
        raise HTTPException(400, "Teslim alınmış kalem yok — onay anlamsız")

    # Parent'ı çek (her iki durumda da gerekli)
    try:
        parent = await teamgram.get_purchase(tg_purchase_id)
    except Exception as e:
        raise HTTPException(502, f"Parent çekilemedi: {e}")

    parent_name = parent.get("Name") or f"#{tg_purchase_id}"
    # Base name = mevcut "- Teslim DD.MM.YYYY" suffix'i çıkarılmış hali
    import re as _re
    base_name = _re.sub(r"\s*-\s*Teslim\s+\d{2}\.\d{2}\.\d{4}\s*$", "", parent_name).strip()
    today_str = datetime.utcnow().strftime("%d.%m.%Y")
    delivered_name = f"{base_name} - Teslim {today_str}"

    # ── Tam teslim: parent'ı Edit ile yeniden adlandır + Teslim Alındı yap ──
    if not remaining_items:
        parent["Name"] = delivered_name
        parent["Status"] = 1
        parent["CustomStageId"] = 196789  # Teslim Alındı
        parent["RelatedEntityId"] = (parent.get("RelatedEntity") or {}).get("Id")
        parent["AttnId"] = (parent.get("Attn") or {}).get("Id")
        try:
            await teamgram.edit_purchase(parent)
        except Exception as e:
            raise HTTPException(502, f"Parent güncellenemedi: {e}")
        return {
            "ok": True,
            "mode": "full",
            "tg_purchase_id": tg_purchase_id,
            "received_purchase_id": tg_purchase_id,
            "remaining_purchase_id": None,
        }

    # ── Parçalı: 2 child + parent sil ──
    related_id = (parent.get("RelatedEntity") or {}).get("Id")
    attn_id = (parent.get("Attn") or {}).get("Id")
    delivery = parent.get("DeliveryAddress") or DEFAULT_DELIVERY_ADDRESS
    billing = parent.get("BillingAddress") or DEFAULT_DELIVERY_ADDRESS
    order_date = parent.get("OrderDate") or datetime.utcnow().strftime("%Y-%m-%dT00:00:00")
    description = parent.get("Description")

    # Child A: alınan ("base - Teslim DD.MM.YYYY")
    received_payload = {
        "Name": delivered_name,
        "OrderDate": order_date,
        "Stage": 0,
        "Status": 1,                       # ClosedReceived
        "CustomStageId": 196789,            # Teslim Alındı
        "VatType": 1,
        "RelatedEntityId": related_id,
        "AttnId": attn_id,
        "DeliveryAddress": delivery,
        "BillingAddress": billing,
        "Description": description,
        "Items": [_build_tg_item(it, q) for it, q in received_items],
    }

    # Child B: kalan (orijinal base ad)
    remaining_payload = {
        "Name": base_name,
        "OrderDate": order_date,
        "Stage": 0,
        "Status": 0,                       # OpenRequested
        "CustomStageId": URETIM_BEKLENIYOR_STAGE_ID,
        "VatType": 1,
        "RelatedEntityId": related_id,
        "AttnId": attn_id,
        "DeliveryAddress": delivery,
        "BillingAddress": billing,
        "Description": description,
        "Items": [_build_tg_item(it, q) for it, q in remaining_items],
    }

    try:
        r1 = await teamgram.create_purchase(received_payload, split_order_id=tg_purchase_id)
        r2 = await teamgram.create_purchase(remaining_payload, split_order_id=tg_purchase_id)
    except Exception as e:
        raise HTTPException(502, f"Child sipariş oluşturulamadı: {e}")

    received_id = r1.get("Id")
    remaining_id = r2.get("Id")

    # Parent'ı sil
    try:
        await teamgram.delete_purchase(tg_purchase_id)
    except Exception as e:
        # Parent silinemese bile child'lar yaratıldı — sadece uyarı
        return {
            "ok": True,
            "mode": "partial",
            "received_purchase_id": received_id,
            "remaining_purchase_id": remaining_id,
            "warning": f"Parent silinemedi: {e}",
        }

    # Lokal PurchaseDocument (proforma PDF) varsa parent'ta kalsın + her iki child'a kopyala
    parent_doc = db.query(PurchaseDocument).filter(PurchaseDocument.tg_purchase_id == tg_purchase_id).first()
    if parent_doc:
        for child_id in (received_id, remaining_id):
            if not child_id:
                continue
            existing = db.query(PurchaseDocument).filter(PurchaseDocument.tg_purchase_id == child_id).first()
            if existing:
                continue  # zaten varsa dokunma
            db.add(PurchaseDocument(
                tg_purchase_id=child_id,
                file_url=parent_doc.file_url,
                original_name=parent_doc.original_name,
                content_type=parent_doc.content_type,
                size=parent_doc.size,
            ))
        db.commit()

    return {
        "ok": True,
        "mode": "partial",
        "received_purchase_id": received_id,
        "remaining_purchase_id": remaining_id,
    }


# ─── Arşiv Detayı ────────────────────────────────────────────────────
@router.get("/archive/{archive_id}")
async def get_archive_purchase(
    archive_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Knack arşiv siparişinin detayı."""
    a = db.query(ArchivePurchaseOrder).filter(ArchivePurchaseOrder.id == archive_id).first()
    if not a:
        raise HTTPException(404, "Arşiv sipariş bulunamadı")

    items = []
    for it in a.items:
        prod = db.query(Product).filter(Product.id == it.product_id).first() if it.product_id else None
        items.append({
            "product_id": it.product_id,
            "product_name": it.product_name,
            "matched_displayname": (f"{prod.brand or ''} - {prod.prod_model or ''}".strip(" -")) if prod else None,
            "matched_sku": prod.sku if prod else None,
            "quantity": it.quantity,
            "line_total": it.line_total,
            "currency": a.currency,
        })

    return {
        "id": f"archive-{a.id}",
        "archive_id": a.id,
        "is_archive": True,
        "siparis_no": a.siparis_no,
        "name": a.siparis_no,
        "order_date": a.order_date,
        "supplier": {"id": a.tg_party_id, "name": a.supplier_name},
        "total": a.total,
        "currency": a.currency,
        "is_received": a.is_received,
        "status": 1 if a.is_received else 0,
        "stage_name": "Teslim Alındı" if a.is_received else "Bekleniyor",
        "knack_pdf_url": a.knack_pdf_url,
        "local_pdf_url": a.local_pdf_url,
        "pdf_url": a.local_pdf_url or a.knack_pdf_url,
        "knack_record_id": a.knack_record_id,
        "imported_at": a.imported_at.isoformat() if a.imported_at else None,
        "items": items,
        "tg_url": (
            f"https://www.teamgram.com/aremak/parties/show?id={a.tg_party_id}"
            if a.tg_party_id else None
        ),
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

    # Lokal PDF + CI Excel
    doc = db.query(PurchaseDocument).filter(PurchaseDocument.tg_purchase_id == purchase_id).first()
    rcp = db.query(PurchaseReceiptDocument).filter(PurchaseReceiptDocument.tg_purchase_id == purchase_id).first()

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
        "receipt_url": rcp.file_url if rcp else None,
        "receipt_name": rcp.original_name if rcp else None,
    }
