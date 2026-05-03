"""
Tedarikçi Siparişi Talep Listeleri
  - Tedarikçi başına bir 'open' liste tutulur (yoksa lazy oluşur)
  - Manuel ekleme + kritik stoktan auto-fill
  - TG sipariş yaratıldığında match → liste 'closed'
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, require_role
from app.core.database import get_db
from app.models.product import Product
from app.models.purchase_request import PurchaseRequestList, PurchaseRequestItem
from app.services import teamgram

logger = logging.getLogger(__name__)
router = APIRouter()

# Brand → Supplier (TG party id, name) hardcoded mapping (1.B kararı)
BRAND_SUPPLIER_MAP: dict[str, tuple[int, str]] = {
    "Hikrobot": (28599315, "Hangzhou Hikrobot Intelligent Co., Ltd."),
    "Arducam": (28603911, "Arducam"),
    "TIS": (28603908, "The Imaging Source"),
    # ileride eklenecekler: "Computar": (..., "..."), ...
}


def _supplier_for_brand(brand: Optional[str]) -> Optional[tuple[int, str]]:
    if not brand:
        return None
    return BRAND_SUPPLIER_MAP.get(brand.strip())


def _ensure_open_list(db: Session, tg_supplier_id: int, supplier_name: str, user_id: int) -> PurchaseRequestList:
    """Bir supplier için açık (open) liste varsa döndür, yoksa yarat."""
    lst = (db.query(PurchaseRequestList)
           .filter(PurchaseRequestList.tg_supplier_id == tg_supplier_id,
                   PurchaseRequestList.status == "open")
           .first())
    if lst:
        return lst
    lst = PurchaseRequestList(
        tg_supplier_id=tg_supplier_id,
        supplier_name=supplier_name,
        status="open",
        created_by_id=user_id,
    )
    db.add(lst)
    db.commit()
    db.refresh(lst)
    return lst


def _list_to_dict(lst: PurchaseRequestList, products_incoming: dict[int, float]) -> dict:
    items_out = []
    total_qty = 0.0
    total_value = 0.0
    for it in lst.items:
        prod = it.list.items  # avoid lazy load issue, we'll fetch product lookup outside
        line_total = (it.quantity or 0) * (it.unit_price or 0)
        total_qty += (it.quantity or 0)
        total_value += line_total
        items_out.append({
            "id": it.id,
            "product_id": it.product_id,
            "product_tg_id": it.product_tg_id,
            "brand": it.product_brand,
            "model": it.product_model,
            "sku": it.product_sku,
            "quantity": it.quantity,
            "unit_price": it.unit_price,
            "currency": it.currency,
            "line_total": line_total,
            "source": it.source,
            "notes": it.notes,
            "added_by": (it.added_by.name if it.added_by else None),
            "incoming_qty": products_incoming.get(it.product_tg_id, 0),
        })
    return {
        "id": lst.id,
        "tg_supplier_id": lst.tg_supplier_id,
        "supplier_name": lst.supplier_name,
        "status": lst.status,
        "linked_tg_purchase_id": lst.linked_tg_purchase_id,
        "created_at": lst.created_at.isoformat() if lst.created_at else None,
        "closed_at": lst.closed_at.isoformat() if lst.closed_at else None,
        "created_by": (lst.created_by.name if lst.created_by else None),
        "closed_by": (lst.closed_by.name if lst.closed_by else None),
        "items": items_out,
        "total_quantity": total_qty,
        "total_value": total_value,
    }


# ── Tedarikçi (TG party) yardımcı endpoint'leri ───────────────────────────────

@router.get("/suppliers/search")
async def search_suppliers(q: str = Query(""), current_user=Depends(require_role("admin", "sales"))):
    """TG'de şirket arama (manuel tedarikçi seçimi için).
    Önce BRAND_SUPPLIER_MAP'te ada göre filtrele, sonra TG QuickSearch."""
    out = []
    qn = (q or "").strip().lower()
    # 1. Yerel mapping'te eşleşenler
    for brand, (sid, sname) in BRAND_SUPPLIER_MAP.items():
        if not qn or qn in sname.lower() or qn in brand.lower():
            out.append({"id": sid, "name": sname, "brand_hint": brand, "source": "mapping"})
    # 2. TG QuickSearch (en az 2 char)
    if len(qn) >= 2:
        try:
            data = await teamgram._get(f"aremak/Search/QuickSearch", {"query": q, "getcompany": True})
            for x in (data.get("QuickResults") or [])[:20]:
                t = (x.get("type") or "").lower()
                if t.startswith(("compan", "part")):
                    cid = x.get("id")
                    if cid and not any(o["id"] == cid for o in out):
                        out.append({"id": cid, "name": x.get("name") or "", "source": "tg"})
        except Exception as e:
            logger.warning(f"TG company search hatası: {e}")
    return {"suppliers": out[:30]}


class CreateSupplierBody(BaseModel):
    name: str
    tax_no: Optional[str] = None
    tax_office: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None


@router.post("/suppliers")
async def create_supplier(
    body: CreateSupplierBody,
    current_user=Depends(require_role("admin", "sales")),
):
    """TG'de yeni tedarikçi şirket yarat. Returns {id, name}."""
    if not body.name.strip():
        raise HTTPException(400, "İsim gerekli")
    payload = {
        "Name": body.name.strip(),
        "TaxNo": body.tax_no or None,
        "TaxOffice": body.tax_office or None,
        "BasicRelationTypes": ["Vendor"],
        "ContactInfoList": [
            *([{"Type": "Email", "SubType": "Business", "Value": body.email}] if body.email else []),
            *([{"Type": "Phone", "SubType": "Work", "Value": body.phone}] if body.phone else []),
            *([{"Type": "Address", "SubType": "Business", "Value": body.address}] if body.address else []),
        ],
    }
    try:
        res = await teamgram.create_company(payload)
    except Exception as e:
        raise HTTPException(502, f"TG'de tedarikçi oluşturulamadı: {e}")
    if not res.get("Result") or not res.get("Id"):
        raise HTTPException(502, f"TG yanıtı: {res}")
    return {"id": res["Id"], "name": body.name.strip()}


@router.get("/lists")
async def list_request_lists(
    status: str = Query("open"),
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin", "sales")),
):
    """Default: tüm 'open' listeler. ?status=closed | all  desteği."""
    q = db.query(PurchaseRequestList)
    if status != "all":
        q = q.filter(PurchaseRequestList.status == status)
    lists = q.order_by(PurchaseRequestList.created_at.desc()).all()

    # Tedarikçi sipariş adetlerini bir kerede çek
    incoming_map = {}
    try:
        page = 1
        open_ids = []
        while True:
            data = await teamgram.get_purchases(page=page, pagesize=50)
            for p in data.get("List") or []:
                if p.get("Status") == 0:
                    open_ids.append(p["Id"])
            if page >= 5 or len(data.get("List") or []) < 50:
                break
            page += 1
        import asyncio as _a
        sem = _a.Semaphore(3)
        async def _fetch(pid):
            async with sem:
                try: return await teamgram.get_purchase(pid)
                except: return None
        results = await _a.gather(*[_fetch(p) for p in open_ids])
        for r in results:
            if not r: continue
            for it in r.get("Items") or []:
                pid = (it.get("Product") or {}).get("Id")
                qty = float(it.get("Quantity") or 0)
                if pid and qty > 0:
                    incoming_map[pid] = incoming_map.get(pid, 0) + qty
    except Exception as e:
        logger.warning(f"Incoming map alinamadi: {e}")

    return {"lists": [_list_to_dict(l, incoming_map) for l in lists]}


# ── Manuel ekleme ─────────────────────────────────────────────────────────────

class AddItemBody(BaseModel):
    product_id: int
    quantity: float
    unit_price: Optional[float] = None
    currency: Optional[str] = None
    notes: Optional[str] = None
    # Manuel tedarikçi override (brand mapping yerine)
    tg_supplier_id: Optional[int] = None
    supplier_name: Optional[str] = None


@router.post("/items")
def add_item(
    body: AddItemBody,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin", "sales")),
):
    """Manuel ürün ekleme. Brand'den supplier bulunur, açık liste lazy oluşur."""
    p = db.query(Product).filter(Product.id == body.product_id).first()
    if not p:
        raise HTTPException(404, "Ürün bulunamadı")
    # Tedarikçi seçimi: body'de override varsa onu kullan, yoksa brand mapping
    if body.tg_supplier_id:
        sup_id = body.tg_supplier_id
        sup_name = body.supplier_name or "Tedarikçi"
    else:
        sup = _supplier_for_brand(p.brand)
        if not sup:
            raise HTTPException(400, f"'{p.brand or '?'}' markası için tedarikçi eşlemesi tanımlı değil. Manuel tedarikçi seçin.")
        sup_id, sup_name = sup
    lst = _ensure_open_list(db, sup_id, sup_name, current_user.id)

    # Aynı liste içinde aynı ürün varsa adet topla
    existing = (db.query(PurchaseRequestItem)
                .filter(PurchaseRequestItem.list_id == lst.id,
                        PurchaseRequestItem.product_id == p.id)
                .first())
    if existing:
        existing.quantity = (existing.quantity or 0) + (body.quantity or 0)
        if body.unit_price is not None:
            existing.unit_price = body.unit_price
        if body.notes:
            existing.notes = (existing.notes or "") + " | " + body.notes
        db.commit()
        return {"ok": True, "item_id": existing.id, "merged": True}

    rec = PurchaseRequestItem(
        list_id=lst.id,
        product_id=p.id,
        product_tg_id=p.tg_id,
        product_brand=p.brand,
        product_model=p.prod_model,
        product_sku=p.sku,
        quantity=body.quantity,
        unit_price=body.unit_price if body.unit_price is not None else p.purchase_price,
        currency=body.currency or p.purchase_currency_name,
        source="manual",
        notes=body.notes,
        added_by_id=current_user.id,
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return {"ok": True, "item_id": rec.id}


class UpdateItemBody(BaseModel):
    quantity: Optional[float] = None
    unit_price: Optional[float] = None
    notes: Optional[str] = None


@router.patch("/items/{item_id}")
def update_item(
    item_id: int,
    body: UpdateItemBody,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin", "sales")),
):
    it = db.query(PurchaseRequestItem).filter(PurchaseRequestItem.id == item_id).first()
    if not it:
        raise HTTPException(404, "Kalem bulunamadı")
    if it.list and it.list.status != "open":
        raise HTTPException(400, "Liste kapalı, düzenlenemez")
    if body.quantity is not None: it.quantity = body.quantity
    if body.unit_price is not None: it.unit_price = body.unit_price
    if body.notes is not None: it.notes = body.notes
    db.commit()
    return {"ok": True}


@router.delete("/items/{item_id}")
def delete_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin", "sales")),
):
    it = db.query(PurchaseRequestItem).filter(PurchaseRequestItem.id == item_id).first()
    if not it:
        raise HTTPException(404, "Kalem bulunamadı")
    if it.list and it.list.status != "open":
        raise HTTPException(400, "Liste kapalı, silinemez")
    db.delete(it)
    db.commit()
    return {"ok": True}


# ── Auto-fill (kritik stok) ───────────────────────────────────────────────────

@router.post("/auto-fill-critical-stock")
async def auto_fill_critical_stock(
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin", "sales")),
):
    """Kritik stok altındaki ürünleri açık listelere ekle (idempotent — zaten ekliyse atla).

    needed = critical_inventory - inventory + reserved - incoming
       reserved = max(Inventory - InventoryNow, 0)  (TG)
       incoming = açık tedarikçi siparişlerindeki ürün adeti
    needed >= 1 ise eklenir.
    """
    # incoming map (open purchase orders)
    incoming_map = {}
    try:
        page = 1
        open_ids = []
        while True:
            data = await teamgram.get_purchases(page=page, pagesize=50)
            for p in data.get("List") or []:
                if p.get("Status") == 0:
                    open_ids.append(p["Id"])
            if page >= 5 or len(data.get("List") or []) < 50:
                break
            page += 1
        import asyncio as _a
        sem = _a.Semaphore(3)
        async def _fp(pid):
            async with sem:
                try: return await teamgram.get_purchase(pid)
                except: return None
        results = await _a.gather(*[_fp(p) for p in open_ids])
        for r in results:
            if not r: continue
            for it in r.get("Items") or []:
                pid = (it.get("Product") or {}).get("Id")
                qty = float(it.get("Quantity") or 0)
                if pid and qty > 0:
                    incoming_map[pid] = incoming_map.get(pid, 0) + qty
    except Exception as e:
        logger.warning(f"incoming map: {e}")

    # Kritik stok adayları
    candidates = (db.query(Product)
                  .filter(Product.critical_inventory > 0,
                          Product.not_available == False,  # noqa
                          Product.no_inventory == False)   # noqa
                  .all())

    added = 0
    skipped_no_supplier = 0
    skipped_already = 0
    skipped_below_threshold = 0

    for p in candidates:
        # reserved = Inventory - InventoryNow (TG'den fresh)
        reserved = 0.0
        try:
            inv = await teamgram._get(f"aremak/Products/InventoryOfEntity",
                                      {"entityId": p.tg_id, "pagesize": 1}) if p.tg_id else None
            if inv:
                reserved = max(float(inv.get("Inventory") or 0) - float(inv.get("InventoryNow") or 0), 0)
        except Exception:
            reserved = 0.0

        incoming = incoming_map.get(p.tg_id, 0)
        needed = (p.critical_inventory or 0) - (p.inventory or 0) + reserved - incoming
        if needed < 1:
            skipped_below_threshold += 1
            continue

        sup = _supplier_for_brand(p.brand)
        if not sup:
            skipped_no_supplier += 1
            continue
        sup_id, sup_name = sup
        lst = _ensure_open_list(db, sup_id, sup_name, current_user.id)

        # idempotent: bu ürün açık listede zaten varsa atla (adet güncelleme yok)
        existing = (db.query(PurchaseRequestItem)
                    .filter(PurchaseRequestItem.list_id == lst.id,
                            PurchaseRequestItem.product_id == p.id)
                    .first())
        if existing:
            skipped_already += 1
            continue

        db.add(PurchaseRequestItem(
            list_id=lst.id,
            product_id=p.id,
            product_tg_id=p.tg_id,
            product_brand=p.brand,
            product_model=p.prod_model,
            product_sku=p.sku,
            quantity=round(needed, 2),
            unit_price=p.purchase_price,
            currency=p.purchase_currency_name,
            source="auto_critical_stock",
            added_by_id=current_user.id,
        ))
        added += 1

    db.commit()
    return {
        "added": added,
        "skipped_already": skipped_already,
        "skipped_no_supplier": skipped_no_supplier,
        "skipped_below_threshold": skipped_below_threshold,
    }


# ── Close (yeni TG sipariş ile eşleştir) ─────────────────────────────────────

class CloseListBody(BaseModel):
    tg_purchase_id: int


@router.post("/lists/{list_id}/close")
def close_list(
    list_id: int,
    body: CloseListBody,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin", "sales")),
):
    """Listeyi kapat — TG tedarikçi sipariş ID'siyle eşleştir."""
    from datetime import datetime as _dt
    lst = db.query(PurchaseRequestList).filter(PurchaseRequestList.id == list_id).first()
    if not lst:
        raise HTTPException(404, "Liste bulunamadı")
    if lst.status != "open":
        raise HTTPException(400, "Liste zaten kapalı")
    lst.status = "closed"
    lst.linked_tg_purchase_id = body.tg_purchase_id
    lst.closed_by_id = current_user.id
    lst.closed_at = _dt.utcnow()
    db.commit()
    return {"ok": True}


@router.post("/lists/{list_id}/cancel")
def cancel_list(
    list_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin", "sales")),
):
    from datetime import datetime as _dt
    lst = db.query(PurchaseRequestList).filter(PurchaseRequestList.id == list_id).first()
    if not lst:
        raise HTTPException(404, "Liste bulunamadı")
    if lst.status != "open":
        raise HTTPException(400, "Liste zaten kapalı/iptal")
    lst.status = "cancelled"
    lst.closed_by_id = current_user.id
    lst.closed_at = _dt.utcnow()
    db.commit()
    return {"ok": True}
