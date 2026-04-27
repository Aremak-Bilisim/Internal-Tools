from datetime import datetime
from fastapi import APIRouter, Depends, Query, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from typing import Optional
from pydantic import BaseModel
from sqlalchemy.orm import Session
import httpx
from app.core.auth import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models.product import Product
from app.services import teamgram

router = APIRouter()


class CustomFieldUpdate(BaseModel):
    fields: dict  # {str(custom_field_id): value}


@router.get("")
async def list_orders(
    page: int = Query(1, ge=1),
    pagesize: int = Query(50, ge=1, le=200),
    status: Optional[str] = Query(None),  # open | closed | None(all)
    tree: bool = Query(False),
    current_user=Depends(get_current_user),
):
    """
    tree=False (default): Eski davranış — düz List döner.
    tree=True: Her order için ParentSale + IsSplit bilgisi eklenir,
              parent altında children dizisinde döner.
    """
    import asyncio
    data = await teamgram.get_orders(page=page, pagesize=pagesize, status=status)
    if not tree:
        return data

    list_rows = data.get("List") or []
    if not list_rows:
        return {"OrderCount": data.get("OrderCount", 0), "List": []}

    # Her order için detay çek (paralel)
    detail_tasks = [teamgram.get_order(o.get("Id")) for o in list_rows if o.get("Id")]
    details = await asyncio.gather(*detail_tasks, return_exceptions=True)

    by_id = {}
    for o, d in zip(list_rows, details):
        is_split = False
        parent_id = None
        if isinstance(d, dict):
            is_split = bool(d.get("IsSplit"))
            ps = d.get("ParentSale") or {}
            try:
                parent_id = int(ps.get("Id")) if ps.get("Id") else None
            except (TypeError, ValueError):
                parent_id = None
        by_id[o.get("Id")] = {
            **o,
            "is_split": is_split,
            "parent_id": parent_id,
            "children": [],
        }

    roots = []
    for it in by_id.values():
        pid = it.get("parent_id")
        if pid and pid in by_id:
            by_id[pid]["children"].append(it)
        else:
            roots.append(it)
    for it in by_id.values():
        if not it["children"]:
            it.pop("children", None)

    return {"OrderCount": data.get("OrderCount", 0), "List": roots}


@router.get("/{order_id}")
async def get_order(order_id: int, current_user=Depends(get_current_user)):
    return await teamgram.get_order(order_id)


@router.post("/{order_id}/payment-doc")
async def upload_payment_doc(
    order_id: int,
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
):
    content = await file.read()
    try:
        att = await teamgram.upload_payment_document(
            order_id, content, file.filename, file.content_type or "application/octet-stream"
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"url": att["Url"], "filename": att["FileName"]}


@router.put("/{order_id}/custom-fields")
async def update_custom_fields(
    order_id: int,
    data: CustomFieldUpdate,
    current_user=Depends(get_current_user),
):
    int_fields = {int(k): v for k, v in data.fields.items()}
    ok = await teamgram.update_order_custom_fields(order_id, int_fields)
    if not ok:
        raise HTTPException(status_code=502, detail="TeamGram güncellenemedi")
    return {"ok": True}



@router.get("/{order_id}/weblink")
async def get_order_weblink(order_id: int, current_user=Depends(get_current_user)):
    url = await teamgram.get_order_weblink(order_id)
    return {"url": url}


@router.get("/proxy/attachment")
async def proxy_attachment(url: str):
    """TeamGram dosya URL'lerini proxy üzerinden sun (sadece TeamGram domain'i)."""
    from urllib.parse import urlparse
    parsed = urlparse(url)
    if parsed.hostname not in ("api.teamgram.com", "teamgram.com", "cdn.teamgram.com"):
        raise HTTPException(status_code=400, detail="Geçersiz URL")
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
            resp = await client.get(url, headers={"Token": settings.TEAMGRAM_TOKEN})
            resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail="Dosya alınamadı")
    except Exception:
        raise HTTPException(status_code=502, detail="Dosya alınamadı")

    content_type = resp.headers.get("content-type", "application/octet-stream")
    return StreamingResponse(
        iter([resp.content]),
        media_type=content_type,
        headers={"Content-Disposition": "inline"},
    )


@router.post("/{order_id}/clear-invoice-flag")
async def clear_invoice_flag(order_id: int, current_user=Depends(get_current_user)):
    ok = await teamgram.clear_order_has_invoice(order_id)
    if not ok:
        raise HTTPException(status_code=502, detail="TeamGram güncellenemedi")
    return {"ok": True}


# ─── Parçalı Sipariş (Split) ─────────────────────────────────────────
class SplitItemIn(BaseModel):
    tg_product_id: int
    ordered_qty: float
    in_stock_qty: float                 # "Hemen Sevk" parçasına gidecek miktar
    price: float
    currency: str = "USD"
    vat: Optional[float] = 20.0
    unit: Optional[str] = "adet"
    description: Optional[str] = None


class SplitOrderIn(BaseModel):
    items: list[SplitItemIn]


def _build_order_item(it, qty: float) -> dict:
    return {
        "Product": {"Id": it.tg_product_id},
        "Quantity": qty,
        "Price": it.price,
        "CurrencyName": it.currency,
        "Vat": it.vat or 20.0,
        "Unit": it.unit or "adet",
        "Description": it.description,
        "DiscountType": 0,
        "Discount": 0,
    }


@router.post("/{order_id}/split")
async def split_order(
    order_id: int,
    data: SplitOrderIn,
    current_user=Depends(get_current_user),
):
    """
    Müşteri siparişini ikiye böl:
      - Hemen Sevk child: in_stock_qty > 0 olan kalemler (durum: Açık)
      - Tedarik Bekliyor child: ordered - in_stock > 0 olan kalemler (durum: Açık, Stage: Tedarik Bekliyor)
    Parent IsSplit=True olarak kalır.
    """
    if not data.items:
        raise HTTPException(400, "Kalem listesi boş")

    in_stock_items: list[tuple[SplitItemIn, float]] = []
    waiting_items: list[tuple[SplitItemIn, float]] = []

    for it in data.items:
        if it.in_stock_qty < 0 or it.in_stock_qty > it.ordered_qty:
            raise HTTPException(400, f"Geçersiz adet (ürün {it.tg_product_id}): in_stock={it.in_stock_qty} ordered={it.ordered_qty}")
        if it.in_stock_qty > 0:
            in_stock_items.append((it, it.in_stock_qty))
        leftover = it.ordered_qty - it.in_stock_qty
        if leftover > 0:
            waiting_items.append((it, leftover))

    if not in_stock_items and not waiting_items:
        raise HTTPException(400, "Hiç adet belirtilmemiş")
    if not in_stock_items or not waiting_items:
        raise HTTPException(400, "Parçalı sipariş için hem 'Hemen Sevk' hem 'Tedarik Bekliyor' kısmı dolu olmalı")

    try:
        parent = await teamgram.get_order(order_id)
    except Exception as e:
        raise HTTPException(502, f"Parent sipariş çekilemedi: {e}")

    parent_name = parent.get("Name") or f"#{order_id}"
    sched = parent.get("ScheduledFulfilment") or datetime.utcnow().strftime("%Y-%m-%dT00:00:00")
    related_id = (parent.get("RelatedEntity") or {}).get("Id")
    attn_id = (parent.get("Attn") or {}).get("Id") if parent.get("Attn") else 0
    delivery = parent.get("DeliveryAddress") or ""
    billing = parent.get("BillingAddress") or ""
    currency = parent.get("CurrencyName") or "USD"
    vat_type = parent.get("VatType", 1)

    common = {
        "OrderDate": parent.get("OrderDate") or datetime.utcnow().strftime("%Y-%m-%dT00:00:00"),
        "ScheduledFulfilment": sched,
        "Stage": 0,
        "Status": 0,
        "VatType": vat_type,
        "RelatedEntityId": related_id,
        "AttnId": attn_id,
        "DeliveryAddress": delivery,
        "BillingAddress": billing,
        "CurrencyName": currency,
    }

    in_stock_payload = {
        **common,
        "Name": f"{parent_name} - Hemen Sevk",
        "Items": [_build_order_item(it, q) for it, q in in_stock_items],
    }
    waiting_payload = {
        **common,
        "Name": f"{parent_name} - Tedarik Bekliyor",
        "Items": [_build_order_item(it, q) for it, q in waiting_items],
    }

    try:
        r1 = await teamgram.create_order(in_stock_payload, split_order_id=order_id)
        r2 = await teamgram.create_order(waiting_payload, split_order_id=order_id)
    except Exception as e:
        raise HTTPException(502, f"Split sipariş oluşturulamadı: {e}")

    if not (r1.get("Result") or r1.get("Id")):
        raise HTTPException(502, f"Hemen Sevk oluşturulamadı: {r1.get('Message')}")
    if not (r2.get("Result") or r2.get("Id")):
        raise HTTPException(502, f"Tedarik Bekliyor oluşturulamadı: {r2.get('Message')}")

    return {
        "ok": True,
        "in_stock_order_id": r1.get("Id"),
        "in_stock_url": r1.get("Url"),
        "waiting_order_id": r2.get("Id"),
        "waiting_url": r2.get("Url"),
    }


# ─── Ürün Stok Bilgisi (split sırasında otomatik öneri için) ─────────
@router.get("/products/{tg_product_id}/stock")
def product_stock(
    tg_product_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Lokal products tablosundan stok bilgisi döner."""
    p = db.query(Product).filter(Product.tg_id == tg_product_id).first()
    if not p:
        return {"tg_product_id": tg_product_id, "inventory": None, "found": False}
    return {
        "tg_product_id": tg_product_id,
        "inventory": float(p.inventory or 0),
        "found": True,
    }
