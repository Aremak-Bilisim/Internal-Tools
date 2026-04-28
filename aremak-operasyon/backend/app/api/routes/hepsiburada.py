"""Hepsiburada sipariş → sevk akışı.

Akış:
1. Paraşüt'te 'Hepsiburada' tag'li / description prefix'li onaylanmış fatura
2. Bu uygulamada 'Hepsiburada Sevki Oluştur' butonu fatura listesi açar
3. Fatura seçilir → SKU eşleşmesi kontrol edilir
4. TG'de Hepsiburada'ya bağlı fırsat (Status=ClosedWon, Channel=Hepsiburada) +
   Müşteri Siparişi (Status=ClosedFulfilled) yaratılır
5. Lokal DB'de Shipment kaydı (stage=preparing, shipping_doc_type=Fatura)
6. Sevk sorumlusu (warehouse) detay sayfasından kargo fişi + foto + sevk
"""
from typing import Optional
import httpx
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, require_role
from app.core.config import settings
from app.core.database import get_db
from app.models.product import Product
from app.models.shipment import ShipmentRequest, ShipmentHistory
from app.models.user import User
from app.models.notification import Notification
from app.services import parasut, teamgram

logger = logging.getLogger(__name__)
router = APIRouter()

# TG sabitleri
HEPSIBURADA_CHANNEL_ID = 199659
KAZANILDI_CUSTOM_STAGE_ID = 196777   # Inbound pipeline > Teklif Onay (28615009 örneği)
HEPSIBURADA_TAG = "Hepsiburada"


# ──────────────────────────────────────────────────────────────────────────────
# 1. Pending fatura listesi
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/pending-invoices")
async def list_pending_hepsiburada_invoices(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Paraşüt'te 'Hepsiburada' description prefix'li, henüz lokal sevk
    talebine bağlanmamış faturaları döndürür."""
    invoices = await parasut.get_invoices()  # cache TTL 30 dk
    # Description ilk kelimesi 'Hepsiburada' (case-insensitive)
    cands = [
        inv for inv in invoices
        if (inv.get("description") or "").strip().lower().startswith("hepsiburada")
    ]
    # Lokal'de zaten bağlanmış olanları çıkar
    used_urls = {
        s.invoice_url for s in db.query(ShipmentRequest.invoice_url).filter(
            ShipmentRequest.invoice_url.isnot(None)
        ).all()
    }
    pending = [inv for inv in cands if inv.get("url") not in used_urls]
    return {"count": len(pending), "invoices": pending}


# ──────────────────────────────────────────────────────────────────────────────
# 2. SKU eşleştirme önizlemesi
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/preview/{invoice_id}")
async def preview_invoice(
    invoice_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Faturayı + line_items + contact bilgisini + SKU eşleşme durumunu döner.
    SKU eşleşmeyenler unmatched_skus[] listesinde döner — frontend manuel atama formu çıkarır."""
    full = await _fetch_invoice_full(invoice_id)
    if not full:
        raise HTTPException(404, "Fatura bulunamadı")

    items = full["line_items"]
    matched = []
    unmatched = []
    for it in items:
        code = (it.get("product_code") or "").strip()
        prod = None
        if code:
            prod = db.query(Product).filter(Product.sku == code).first()
        if prod and prod.tg_id:
            matched.append({**it, "tg_product_id": prod.tg_id, "product_id": prod.id})
        else:
            unmatched.append(it)
    return {
        "invoice": full["invoice"],
        "contact": full["contact"],
        "line_items": items,
        "matched_count": len(matched),
        "unmatched_count": len(unmatched),
        "unmatched_skus": [it.get("product_code") for it in unmatched],
        "all_matched": len(unmatched) == 0,
    }


# ──────────────────────────────────────────────────────────────────────────────
# 3. Sevki oluştur (orkestratör)
# ──────────────────────────────────────────────────────────────────────────────

class HepsiburadaCreateShipment(BaseModel):
    invoice_id: str
    delivery_type: Optional[str] = "Kargo"
    cargo_company: Optional[str] = None
    delivery_address: Optional[str] = None
    delivery_city: Optional[str] = None
    delivery_district: Optional[str] = None
    delivery_zip: Optional[str] = None
    recipient_name: Optional[str] = None
    recipient_phone: Optional[str] = None
    notes: Optional[str] = None
    # Manuel SKU atamaları: {parasut_product_code: local_product_id}
    sku_overrides: dict = {}


@router.post("/create-shipment")
async def create_hepsiburada_shipment(
    data: HepsiburadaCreateShipment,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin", "sales", "warehouse")),
):
    """Tek atışla:
      - Paraşüt fatura ve cari bilgilerini al
      - TG'de cariyi bul/oluştur (Hepsiburada channel)
      - TG'de fırsat oluştur (Status=ClosedWon)
      - TG'de sipariş oluştur (Items SKU eşleşmiş ürünlerden)
      - Lokal Shipment kaydı (stage=preparing)
    """
    full = await _fetch_invoice_full(data.invoice_id)
    if not full:
        raise HTTPException(404, "Fatura bulunamadı")
    inv = full["invoice"]
    contact = full["contact"]
    line_items = full["line_items"]

    # SKU eşleştirme — sku_overrides ile manuel atamaları uygula
    tg_items = []
    unmatched = []
    for it in line_items:
        code = (it.get("product_code") or "").strip()
        prod = None
        if code in (data.sku_overrides or {}):
            prod = db.query(Product).filter(Product.id == data.sku_overrides[code]).first()
        elif code:
            prod = db.query(Product).filter(Product.sku == code).first()
        if not prod or not prod.tg_id:
            unmatched.append(code or it.get("product_name") or "?")
            continue
        tg_items.append({
            "Product": {"Id": prod.tg_id},
            "Quantity": it.get("quantity") or 0,
            "Price": it.get("unit_price") or 0,
            "CurrencyName": _currency_name(it.get("currency") or inv.get("currency")),
            "Vat": float(it.get("vat_rate") or 20),
            "Unit": "adet",
            "Description": it.get("product_name") or "",
            "DiscountType": 0,
            "Discount": 0,
        })
    if unmatched:
        raise HTTPException(422, {"error": "SKU eşleşmedi", "unmatched": unmatched})

    # 1. TG'de cari bul/oluştur
    tax_no = (contact.get("tax_number") or "").strip()
    company_name = contact.get("name") or "Hepsiburada Müşterisi"
    company_match = await teamgram.search_company_by_tax_no(tax_no) if tax_no else None
    if company_match:
        tg_company_id = company_match["Id"]
    else:
        comp_payload = {
            "Name": company_name,
            "TaxNo": tax_no or None,
            "TaxOffice": contact.get("tax_office") or None,
            "Tags": [HEPSIBURADA_TAG],
            "Channel": HEPSIBURADA_CHANNEL_ID,
            "BasicRelationTypes": ["Customer"],
        }
        c_res = await teamgram.create_company(comp_payload)
        if not c_res.get("Result") or not c_res.get("Id"):
            raise HTTPException(502, f"TG'de şirket oluşturulamadı: {c_res}")
        tg_company_id = c_res["Id"]

    # 2. TG fırsat
    opp_name = inv.get("description") or f"Hepsiburada - {inv.get('invoice_no')}"
    opp_payload = {
        "Name": opp_name,
        "RelatedEntityId": tg_company_id,
        "Status": "ClosedWon",
        "CustomStageId": KAZANILDI_CUSTOM_STAGE_ID,
        "Amount": str(inv.get("gross_total") or 0),
        "CurrencyName": _currency_name(inv.get("currency")),
        "RealizedAmount": str(inv.get("gross_total") or 0),
        "RealizedCurrencyName": _currency_name(inv.get("currency")),
        "Tags": [HEPSIBURADA_TAG],
    }
    o_res = await teamgram.create_opportunity(opp_payload)
    if not o_res.get("Result") or not o_res.get("Id"):
        raise HTTPException(502, f"TG'de fırsat oluşturulamadı: {o_res}")
    tg_opp_id = o_res["Id"]

    # 3. TG sipariş (RelatedEntityIds ile fırsata bağla)
    from datetime import datetime as _dt
    order_payload = {
        "OrderDate": _dt.utcnow().strftime("%Y-%m-%dT00:00:00"),
        "Name": opp_name,
        "RelatedEntityId": tg_company_id,
        "RelatedEntityIds": str(tg_opp_id),
        "Status": "ClosedFulfilled",
        "Stage": 0,
        "CurrencyName": _currency_name(inv.get("currency")),
        "Items": tg_items,
        "Tags": [HEPSIBURADA_TAG],
    }
    ord_res = await teamgram.create_order(order_payload)
    if not ord_res.get("Result") or not ord_res.get("Id"):
        raise HTTPException(502, f"TG'de sipariş oluşturulamadı: {ord_res}")
    tg_order_id = ord_res["Id"]

    # 4. Lokal Shipment kaydı (stage=preparing — admin/parasut adımları atlanır)
    s = ShipmentRequest(
        tg_order_id=tg_order_id,
        tg_order_name=opp_name,
        customer_name=company_name,
        delivery_type=data.delivery_type,
        cargo_company=data.cargo_company,
        delivery_address=data.delivery_address,
        delivery_city=data.delivery_city,
        delivery_district=data.delivery_district,
        delivery_zip=data.delivery_zip,
        recipient_name=data.recipient_name,
        recipient_phone=data.recipient_phone,
        notes=data.notes,
        invoice_url=inv.get("url"),
        invoice_no=inv.get("invoice_no"),
        shipping_doc_type="Fatura",
        items=[{"product_name": i.get("product_name"), "quantity": i.get("quantity")} for i in line_items],
        created_by_id=current_user.id,
        stage="preparing",
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    db.add(ShipmentHistory(
        shipment_id=s.id,
        stage_from=None,
        stage_to="preparing",
        note=f"[HEPSIBURADA] TG opp={tg_opp_id}, order={tg_order_id}",
        user_id=current_user.id,
    ))
    db.commit()

    # Warehouse'a bildirim
    warehouses = db.query(User).filter(User.role == "warehouse", User.is_active == True).all()
    for u in warehouses:
        db.add(Notification(
            user_id=u.id,
            title=f"Hepsiburada Sevki: {opp_name}",
            message="Sevke hazırlanıyor — kargo fişi + foto yüklemen gerekiyor.",
            shipment_id=s.id,
        ))
    db.commit()

    return {"shipment_id": s.id, "tg_order_id": tg_order_id, "tg_opportunity_id": tg_opp_id}


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

CURRENCY_MAP = {"TRL": "TL", "TRY": "TL", "TL": "TL", "USD": "USD", "EUR": "EUR"}


def _currency_name(c: str) -> str:
    return CURRENCY_MAP.get((c or "TL").upper(), "TL")


async def _fetch_invoice_full(invoice_id: str) -> Optional[dict]:
    """Paraşüt'ten fatura + contact + line_items'ı tek istekte alır."""
    token = await parasut._get_token()
    url = f"{parasut.BASE}/v4/{parasut.COMPANY}/sales_invoices/{invoice_id}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            url,
            headers={"Authorization": f"Bearer {token}"},
            params={"include": "contact,details,details.product"},
        )
        if not r.is_success:
            return None
        data = r.json()

    inv = data["data"]
    attrs = inv.get("attributes", {})
    included = {f"{i['type']}/{i['id']}": i for i in data.get("included", [])}

    # Contact
    contact = {}
    c_rel = inv.get("relationships", {}).get("contact", {}).get("data")
    if c_rel:
        c = included.get(f"{c_rel['type']}/{c_rel['id']}", {})
        c_attrs = c.get("attributes", {})
        contact = {
            "id": c.get("id"),
            "name": c_attrs.get("name") or c_attrs.get("short_name") or "",
            "tax_number": c_attrs.get("tax_number") or "",
            "tax_office": c_attrs.get("tax_office") or "",
            "email": c_attrs.get("email") or "",
            "phone": c_attrs.get("phone") or "",
            "address": c_attrs.get("address") or "",
            "city": c_attrs.get("city") or "",
            "district": c_attrs.get("district") or "",
        }

    # Line items
    line_items = []
    for d_ref in inv.get("relationships", {}).get("details", {}).get("data", []):
        det = included.get(f"{d_ref['type']}/{d_ref['id']}", {})
        d_attrs = det.get("attributes", {})
        product_name = d_attrs.get("description", "")
        product_code = ""
        prod_rel = det.get("relationships", {}).get("product", {}).get("data")
        if prod_rel:
            prod = included.get(f"{prod_rel['type']}/{prod_rel['id']}", {})
            p_attrs = prod.get("attributes", {})
            product_name = p_attrs.get("name") or product_name
            product_code = p_attrs.get("code") or ""
        line_items.append({
            "product_name": product_name,
            "product_code": product_code,
            "quantity": float(d_attrs.get("quantity") or 0),
            "unit_price": float(d_attrs.get("unit_price") or 0),
            "currency": d_attrs.get("currency") or "",
            "vat_rate": d_attrs.get("vat_rate") or 0,
        })

    return {
        "invoice": {
            "id": inv["id"],
            "invoice_no": attrs.get("invoice_no") or attrs.get("invoice_id", ""),
            "description": attrs.get("description") or "",
            "issue_date": attrs.get("issue_date") or "",
            "gross_total": attrs.get("gross_total") or 0,
            "net_total": attrs.get("net_total") or 0,
            "currency": attrs.get("currency") or "TRL",
            "url": f"https://uygulama.parasut.com/{parasut.COMPANY}/satislar/{inv['id']}",
        },
        "contact": contact,
        "line_items": line_items,
    }
