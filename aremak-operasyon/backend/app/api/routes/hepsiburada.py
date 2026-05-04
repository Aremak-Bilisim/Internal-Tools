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
import json
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
from app.models.hepsiburada_order import HepsiburadaOrder
from app.services import hepsiburada as hb_api
from app.services import parasut, teamgram

logger = logging.getLogger(__name__)
router = APIRouter()

# TG sabitleri
HEPSIBURADA_CHANNEL_ID = 199659
KAZANILDI_CUSTOM_STAGE_ID = 196777   # Inbound pipeline > Teklif Onay (28615009 örneği)
HEPSIBURADA_TAG = "Hepsiburada"


# ──────────────────────────────────────────────────────────────────────────────
# 0. Webhook'tan gelen pending HB siparişleri (Aşama 1 — Admin/Sales onayı)
# ──────────────────────────────────────────────────────────────────────────────


@router.get("/pending-orders")
def list_pending_hb_orders(
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin", "sales")),
):
    """Webhook'tan CreateOrder olarak gelmiş, henüz onaylanmamış siparişler."""
    rows = (db.query(HepsiburadaOrder)
            .filter(HepsiburadaOrder.event_type == "CreateOrder",
                    HepsiburadaOrder.parasut_invoice_id.is_(None))
            .order_by(HepsiburadaOrder.received_at.desc())
            .limit(50).all())
    out = []
    for r in rows:
        try:
            payload = json.loads(r.raw_payload or "{}")
        except Exception:
            payload = {}
        items_summary = []
        for it in (payload.get("items") or []):
            items_summary.append({
                "orderNumber": it.get("orderNumber"),
                "sku": it.get("sku") or it.get("merchantSku"),
                "quantity": it.get("quantity"),
                "customerName": it.get("customerName"),
                "totalPrice": (it.get("totalPrice") or {}).get("amount"),
                "currency": (it.get("totalPrice") or {}).get("currency"),
            })
        out.append({
            "id": r.id,
            "external_order_id": r.external_order_id,
            "order_number": r.order_number,
            "received_at": r.received_at.isoformat() if r.received_at else None,
            "items": items_summary,
        })
    return {"count": len(out), "orders": out}


@router.post("/approve/{hb_order_id}")
async def approve_hb_order(
    hb_order_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin", "sales")),
):
    """Aşama 1: Admin/Sales onayı.
      1) HB'den siparişin fresh detayını çek (validation)
      2) Paraşüt'te müşteri (yoksa) + e-arşiv fatura yarat
      3) HB'de paket oluştur (lineItem id ile)
      4) Kayıtla işaretle, sevk sorumlusu (warehouse) bildirim
    """
    hb_rec = db.query(HepsiburadaOrder).filter(HepsiburadaOrder.id == hb_order_id).first()
    if not hb_rec:
        raise HTTPException(404, "Hepsiburada kaydı bulunamadı")
    if hb_rec.parasut_invoice_id:
        raise HTTPException(400, f"Bu sipariş zaten onaylanmış (Paraşüt fatura: {hb_rec.parasut_invoice_id})")

    try:
        payload = json.loads(hb_rec.raw_payload or "{}")
    except Exception:
        raise HTTPException(400, "Webhook payload parse edilemedi")
    items = payload.get("items") or []
    if not items:
        raise HTTPException(400, "Webhook payload'unda items[] yok")

    # Çoklu kalem siparişlerinde tek fatura — items[0]'dan customer/invoice info al
    first = items[0]
    inv_block = first.get("invoice") or {}
    addr_block = inv_block.get("address") or {}
    customer_name = inv_block.get("name") or addr_block.get("name") or first.get("customerName") or "Hepsiburada Müşterisi"
    tax_no = (inv_block.get("taxNumber") or inv_block.get("turkishIdentityNumber") or "11111111111").strip()
    tax_office = inv_block.get("taxOffice") or ""
    email = addr_block.get("email") or ""
    phone = addr_block.get("phoneNumber") or addr_block.get("alternatePhoneNumber") or ""
    address = addr_block.get("address") or ""
    city = addr_block.get("city") or ""
    district = addr_block.get("town") or addr_block.get("district") or ""
    order_number = first.get("orderNumber") or hb_rec.order_number
    today = first.get("orderDate") or _today_iso()
    if "T" in today:
        today = today.split("T")[0]

    # 1) HB'den fresh detay (opsiyonel — yoksa devam et, hata loglanır)
    try:
        await hb_api.get_order(order_number)
    except Exception as e:
        logger.warning(f"HB get_order({order_number}) hatası, devam ediliyor: {e}")

    # 2) Paraşüt cari + fatura
    # SKU eşleşmesi: HB items[].sku veya merchantSku → lokal Product.sku → Product.parasut_id
    pa_items = []
    unmatched = []
    for it in items:
        sku = (it.get("sku") or it.get("merchantSku") or "").strip()
        prod = None
        if sku:
            prod = (db.query(Product)
                    .filter((Product.sku == sku))
                    .first())
        # Paraşüt product_id zorunlu değil ama tercih edilir
        parasut_pid = prod.parasut_id if (prod and prod.parasut_id) else None
        unit = (it.get("unitPrice") or {}).get("amount") or it.get("unitPrice")
        qty = it.get("quantity") or 1
        pa_items.append({
            "product_id": parasut_pid,
            "quantity": qty,
            "unit_price": unit,
            "vat_rate": it.get("vatRate") or 20,
            "description": prod.prod_model if prod else (it.get("productName") or sku or "Hepsiburada ürünü"),
        })
        if not parasut_pid:
            unmatched.append(sku or "?")

    if unmatched:
        # Paraşüt fatura için product_id zorunlu değil — uyarı bırak ama devam et
        logger.warning(f"HB approve: Paraşüt'te eşleşmemiş SKU'lar (description ile gidecek): {unmatched}")

    try:
        contact_id = await parasut.create_or_get_contact(
            name=customer_name, tax_number=tax_no, tax_office=tax_office,
            email=email, phone=phone, address=address, city=city, district=district,
            contact_type="person", account_type="customer",
        )
    except Exception as e:
        raise HTTPException(502, f"Paraşüt cari oluşturma hatası: {e}")

    description = f"Hepsiburada - {order_number}"
    try:
        inv_res = await parasut.create_sales_invoice_for_hepsiburada(
            contact_id=contact_id, description=description,
            items=pa_items, issue_date=today,
            billing_address=address, city=city, district=district,
            tax_number=tax_no, tax_office=tax_office, currency="TRL",
            tag="Hepsiburada",
        )
    except Exception as e:
        raise HTTPException(502, f"Paraşüt fatura oluşturma hatası: {e}")
    parasut_invoice_id = inv_res.get("data", {}).get("id")
    if not parasut_invoice_id:
        raise HTTPException(502, f"Paraşüt fatura yanıtı beklenmiyor: {inv_res}")

    # 3) HB'de paket oluştur
    line_item_ids = [str(it.get("id")) for it in items if it.get("id")]
    package_number = None
    try:
        if line_item_ids:
            pkg_res = await hb_api.create_package(line_item_ids)
            # HB response'undan paket numarası — schema doğrulanacak
            if isinstance(pkg_res, list) and pkg_res:
                package_number = pkg_res[0].get("packageNumber") or pkg_res[0].get("PackageNumber")
            elif isinstance(pkg_res, dict):
                package_number = pkg_res.get("packageNumber") or pkg_res.get("PackageNumber")
    except Exception as e:
        # Paket oluşturma kritik değil — fatura zaten oluştu; admin manuel paketleyebilir
        logger.error(f"HB create_package hatası ({line_item_ids}): {e}")

    # 4) Kayıt + bildirim
    from datetime import datetime as _dt
    hb_rec.parasut_invoice_id = str(parasut_invoice_id)
    hb_rec.package_number = package_number
    hb_rec.approved_by_id = current_user.id
    hb_rec.processed = True
    hb_rec.processed_at = _dt.utcnow()
    db.commit()

    # Sevk sorumlusu + admin'e bildirim
    warehouses = db.query(User).filter(User.role == "warehouse", User.is_active == True).all()
    admins = db.query(User).filter(User.role == "admin", User.is_active == True).all()
    msg = (f"Hepsiburada {order_number} — Paraşüt fatura yaratıldı. "
           f"Sevkiyatlar > 'Hepsiburada Sevki Oluştur' ile devam edebilirsiniz.")
    for u in warehouses + admins:
        db.add(Notification(user_id=u.id, title=f"HB Onaylandı: {order_number}", message=msg))
    db.commit()

    return {
        "ok": True,
        "hb_order_id": hb_rec.id,
        "parasut_invoice_id": parasut_invoice_id,
        "package_number": package_number,
        "unmatched_skus": unmatched,
    }


def _today_iso():
    from datetime import datetime as _dt
    return _dt.utcnow().strftime("%Y-%m-%d")


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
    # Description ilk kelimesi 'Hepsiburada' (case-insensitive) +
    # 28.04.2026 ve sonrası faturalar
    HB_START_DATE = "2026-04-28"
    cands = [
        inv for inv in invoices
        if (inv.get("description") or "").strip().lower().startswith("hepsiburada")
        and (inv.get("issue_date") or "") >= HB_START_DATE
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
    # HB teslimat adresi — Paraşüt fatura adresi'nden farklı, webhook payload'unda
    hb_shipping = None
    hb_rec = (db.query(HepsiburadaOrder)
              .filter(HepsiburadaOrder.parasut_invoice_id == str(invoice_id))
              .order_by(HepsiburadaOrder.id.desc())
              .first())
    if hb_rec:
        try:
            payload = json.loads(hb_rec.raw_payload or "{}")
            for it in payload.get("items") or []:
                sa = it.get("shippingAddress") or {}
                if sa:
                    hb_shipping = {
                        "address": sa.get("address") or sa.get("addressDetail") or "",
                        "name": sa.get("name") or "",
                        "email": sa.get("email") or "",
                        "phone": sa.get("phoneNumber") or sa.get("alternatePhoneNumber") or "",
                        "city": sa.get("city") or "",
                        "district": sa.get("town") or sa.get("district") or "",
                        "neighborhood": sa.get("district") or "",  # mahalle
                        "country_code": sa.get("countryCode") or "TR",
                    }
                    break
        except Exception as e:
            logger.warning(f"HB shipping address parse hatası: {e}")

    return {
        "invoice": full["invoice"],
        "contact": full["contact"],
        "hb_shipping_address": hb_shipping,
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
        # KDV dahil birim fiyat (Paraşüt'te unit_price KDV hariç)
        unit_excl = float(it.get("unit_price") or 0)
        vat_rate = float(it.get("vat_rate") or 20)
        unit_incl = round(unit_excl * (1 + vat_rate / 100.0), 2)
        tg_items.append({
            "Product": {"Id": prod.tg_id},
            "Quantity": it.get("quantity") or 0,
            "Price": unit_incl,
            "CurrencyName": _currency_name(it.get("currency") or inv.get("currency")),
            "Vat": vat_rate,
            "Unit": "adet",
            "Description": it.get("product_name") or "",
            "DiscountType": 0,
            "Discount": 0,
        })
    if unmatched:
        raise HTTPException(422, {"error": "SKU eşleşmedi", "unmatched": unmatched})

    # 1. TG'de cari bul/oluştur.
    # Hepsiburada B2C carilerinde Paraşüt tax_number genelde dummy "11111111111"
    # → VKN match güvenilmez, bu durumda TG mirror'da ISIM ile arıyoruz.
    # Gerçek VKN'lerde normal VKN match akışı.
    tax_no = (contact.get("tax_number") or "").strip()
    company_name = contact.get("name") or "Hepsiburada Müşterisi"
    DUMMY_VKN = {"11111111111", "00000000000", "1111111111", "0000000000"}
    is_dummy = tax_no in DUMMY_VKN or not tax_no
    if is_dummy:
        company_match = await teamgram.search_company_by_name(company_name)
    else:
        company_match = await teamgram.search_company_by_tax_no(tax_no)
    if company_match:
        tg_company_id = company_match["Id"]
    else:
        comp_payload = {
            "Name": company_name,
            "TaxNo": (tax_no if not is_dummy else None),
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
    # Parasut: gross_total = KDV haric subtotal, net_total = KDV dahil grand total
    # Opp Amount KDV haric (siparis kart tutariyla esit olsun)
    inv_excl = inv.get("gross_total") or 0
    opp_payload = {
        "Name": opp_name,
        "RelatedEntityId": tg_company_id,
        "Status": "ClosedWon",
        "CustomStageId": KAZANILDI_CUSTOM_STAGE_ID,
        "Amount": str(inv_excl),
        "CurrencyName": _currency_name(inv.get("currency")),
        "RealizedAmount": str(inv_excl),
        "RealizedCurrencyName": _currency_name(inv.get("currency")),
        "Tags": [HEPSIBURADA_TAG],
    }
    o_res = await teamgram.create_opportunity(opp_payload)
    if not o_res.get("Result") or not o_res.get("Id"):
        raise HTTPException(502, f"TG'de fırsat oluşturulamadı: {o_res}")
    tg_opp_id = o_res["Id"]

    # 3. TG sipariş (RelatedEntityIds ile fırsata bağla)
    from datetime import datetime as _dt
    today_iso = _dt.utcnow().strftime("%Y-%m-%dT00:00:00")
    delivery_addr = " ".join(filter(None, [
        data.delivery_address, data.delivery_district, data.delivery_city, data.delivery_zip,
    ])).strip() or contact.get("address") or company_name
    order_payload = {
        "OrderDate": today_iso,
        "ScheduledFulfilment": today_iso,
        "Name": opp_name,
        "RelatedEntityId": tg_company_id,
        "RelatedEntityIds": str(tg_opp_id),
        "Status": "ClosedFulfilled",
        "Stage": 0,
        "CurrencyName": _currency_name(inv.get("currency")),
        "DeliveryAddress": delivery_addr,
        "BillingAddress": delivery_addr,
        "VatType": 2,   # VatInclusive — Items.Price KDV dahil
        "Items": tg_items,
        "Tags": [HEPSIBURADA_TAG],
    }
    ord_res = await teamgram.create_order(order_payload)
    if not ord_res.get("Result") or not ord_res.get("Id"):
        raise HTTPException(502, f"TG'de sipariş oluşturulamadı: {ord_res}")
    tg_order_id = ord_res["Id"]

    # 3a. Order'i opp'a bagla (Create sirasinda RelatedEntityIds bazen tutmuyor — Edit ile pekistiriyoruz)
    # KRITIK: VatType=2 (VatInclusive) ise TG Get response'unda Price KDV-haric base donuyor.
    # Bunu Edit'e oldugu gibi geri postlarsak TG bir kez daha /1.2 uygulayarak fiyatlari yariya
    # indiriyor. O yuzden VatInclusive ise Price * (1+vat/100) ile tekrar dahile cevirip postluyoruz.
    try:
        ord_full = await teamgram.get_order_full(tg_order_id)
        cur_vat_type = ord_full.get("VatType") or 0
        edit_items = []
        for it in (ord_full.get("Items") or []):
            base_price = float(it.get("Price") or 0)
            vat_r = float(it.get("Vat") or 0)
            send_price = round(base_price * (1 + vat_r / 100.0), 2) if cur_vat_type == 2 else base_price
            edit_items.append({
                "Product": {"Id": (it.get("Product") or {}).get("Id")},
                "Quantity": it.get("Quantity") or 0,
                "Price": send_price,
                "CurrencyName": it.get("CurrencyName") or "TL",
                "Vat": vat_r or 20,
                "Unit": it.get("Unit") or "adet",
                "Description": it.get("Description") or "",
                "DiscountType": 0, "Discount": 0,
            })
        edit_payload = {
            "Id": tg_order_id,
            "Name": ord_full.get("Name"),
            "OrderDate": ord_full.get("OrderDate"),
            "ScheduledFulfilment": ord_full.get("ScheduledFulfilment"),
            "RelatedEntityId": (ord_full.get("RelatedEntity") or {}).get("Id"),
            "RelatedEntityIds": str(tg_opp_id),
            "Status": "ClosedFulfilled",
            "Stage": ord_full.get("Stage", 0),
            "CustomStageId": ord_full.get("CustomStageId"),
            "CurrencyName": ord_full.get("CurrencyName") or "TL",
            "DeliveryAddress": ord_full.get("DeliveryAddress") or "",
            "BillingAddress": ord_full.get("BillingAddress") or "",
            "Description": ord_full.get("Description") or "",
            "Tags": ord_full.get("Tags") or [],
            "OwnerId": (ord_full.get("Owner") or {}).get("Id") or 0,
            "Items": edit_items,
            "CustomFieldDatas": [],
            "VatType": cur_vat_type,
        }
        await teamgram.edit_order(edit_payload)
    except Exception as e:
        logger.warning(f"Order'i opp'a baglarken hata (kritik degil): {e}")

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
