import asyncio
import httpx
from typing import Optional
from app.core.config import settings

BASE = settings.TEAMGRAM_BASE_URL
DOMAIN = settings.TEAMGRAM_DOMAIN
HEADERS = {"Token": settings.TEAMGRAM_TOKEN}


async def _get(path: str, params: dict = None) -> dict:
    url = f"{BASE}/{path}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url, headers=HEADERS, params=params or {})
        r.raise_for_status()
        return r.json()


async def _get_v1(path: str, params: dict = None) -> dict:
    url = f"{BASE}/v1/{path}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url, headers=HEADERS, params=params or {})
        r.raise_for_status()
        return r.json()


async def get_products(page: int = 1, pagesize: int = 50) -> dict:
    return await _get(f"{DOMAIN}/Products/Index", {"page": page, "pagesize": pagesize})


async def get_product(product_id: int) -> dict:
    return await _get(f"{DOMAIN}/Products/Get", {"id": product_id})


async def get_products_all(page: int = 1, pagesize: int = 100) -> dict:
    return await _get(f"{DOMAIN}/Products/GetAll", {"id": 0, "page": page, "pagesize": pagesize})


async def get_orders(page: int = 1, pagesize: int = 50, status: Optional[str] = None) -> dict:
    """
    status=None   → all orders: open (fid=0) + closed (fid=-1) merged, includes HasInvoice
    status=open   → only open orders (Index fid=0)
    status=closed → only closed orders (Index fid=-1)
    """
    if status == "open":
        return await _get_v1(f"{DOMAIN}/Orders/Index", {"page": page, "pagesize": pagesize, "fid": 0})
    if status == "closed":
        return await _get_v1(f"{DOMAIN}/Orders/Index", {"page": page, "pagesize": pagesize, "fid": -1})
    # All orders: fetch open + closed in parallel (Index returns HasInvoice; GetNew doesn't)
    open_data, closed_data = await asyncio.gather(
        _get_v1(f"{DOMAIN}/Orders/Index", {"page": 1, "pagesize": 200, "fid": 0}),
        _get_v1(f"{DOMAIN}/Orders/Index", {"page": 1, "pagesize": 200, "fid": -1}),
    )
    open_list = open_data.get("List", [])
    closed_list = closed_data.get("List", [])
    all_orders = open_list + closed_list
    all_orders.sort(key=lambda o: o.get("OrderDate", ""), reverse=True)
    total = (open_data.get("OrderCount") or 0) + (closed_data.get("OrderCount") or 0)
    return {"OrderCount": total, "List": all_orders}


async def get_order(order_id: int) -> dict:
    return await _get_v1(f"{DOMAIN}/Orders/Get", {"id": order_id})


async def get_companies(page: int = 1, pagesize: int = 50) -> dict:
    return await _get(f"{DOMAIN}/Companies/Index", {"page": page, "pagesize": pagesize})


async def get_company(company_id: int) -> dict:
    return await _get(f"{DOMAIN}/Companies/Get", {"id": company_id})



async def get_purchases(page: int = 1, pagesize: int = 50) -> dict:
    return await _get(f"{DOMAIN}/Purchases/Index", {"page": page, "pagesize": pagesize})


async def get_product_inventory(product_id: int) -> dict:
    return await _get(f"{DOMAIN}/Products/InventoryOfEntity", {"entityId": product_id})


async def upload_payment_document(order_id: int, file_content: bytes, filename: str, content_type: str) -> dict:
    """
    Upload a file to TeamGram as an order attachment, then set it as the
    Ödeme Belgesi custom field (193472) on the order.
    Returns the attachment dict on success.
    """
    import io
    from urllib.parse import urlparse, parse_qs

    # 1. Upload file to TeamGram
    url = f"{BASE}/{DOMAIN}/attachment/postattachment"
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(
            url,
            headers={"Token": HEADERS["Token"]},
            files={"file": (filename, io.BytesIO(file_content), content_type)},
            data={"entityId": str(order_id)},
        )
        r.raise_for_status()
        result = r.json()

    if not result.get("Result"):
        raise ValueError("TeamGram dosya yüklenemedi")

    att = result["Attachments"][0]
    att_url = att["Url"]

    # Extract KeyName from URL (?key=aremak/UUID.ext)
    qs = parse_qs(urlparse(att_url).query)
    key_name = qs.get("key", [""])[0]

    attachment = {
        "Id": att["Id"],
        "KeyName": key_name,
        "FileName": att["FileName"],
        "ContentType": content_type,
        "Orientation": 0,
        "ContentSize": att.get("ContentSize", 0),
        "Description": None,
        "Url": att_url,
    }

    # 2. Update order custom field 193472 with attachment JSON
    import json as _json
    await update_order_custom_fields(order_id, {193472: _json.dumps([attachment])})

    return attachment


async def update_order_custom_fields(order_id: int, field_updates: dict) -> bool:
    """
    field_updates: {custom_field_id: value_string}
    Fetches the full order, patches CustomFieldDatas, then POSTs back.
    """
    order = await get_order(order_id)
    order["RelatedEntityId"] = order.get("RelatedEntity", {}).get("Id")

    cfd = order.get("CustomFieldDatas") or []
    existing_ids = {f["CustomFieldId"] for f in cfd}
    for cf_id, value in field_updates.items():
        for f in cfd:
            if f["CustomFieldId"] == cf_id:
                f["Value"] = value
                break
        else:
            if cf_id not in existing_ids:
                cfd.append({"CustomFieldId": cf_id, "Value": value})
    order["CustomFieldDatas"] = cfd

    url = f"{BASE}/v1/{DOMAIN}/Orders/Edit"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(url, headers=HEADERS, json=order)
    if r.content:
        try:
            return r.json().get("Result") is True
        except Exception:
            pass
    return r.status_code < 300


async def update_order_status(order_id: int, status: int, stage_name: Optional[str] = None) -> bool:
    """
    Update TeamGram order Status (0=Açık, 1=Tamamlandı, 2=İptal).
    Optionally also set the pipeline stage by display name (e.g. "Hazırlanıyor").
    """
    order = await get_order(order_id)
    order["RelatedEntityId"] = order.get("RelatedEntity", {}).get("Id")
    order["Status"] = status

    if stage_name:
        # Find matching pipeline stage ID by name
        stage_id = await _find_stage_id(stage_name)
        if stage_id:
            order["CustomStageId"] = stage_id

    url = f"{BASE}/v1/{DOMAIN}/Orders/Edit"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(url, headers=HEADERS, json=order)
    if r.content:
        try:
            return r.json().get("Result") is True
        except Exception:
            pass
    return r.status_code < 300


async def _find_stage_id(stage_name: str) -> Optional[int]:
    """Look up order pipeline stage ID by name from metadata CustomStagesOrder."""
    try:
        meta = await get_metadata()
        stages = meta.get("CustomStagesOrder", [])
        name_lower = stage_name.strip().lower()
        for s in stages:
            if (s.get("Name") or "").strip().lower() == name_lower:
                return s.get("Id")
    except Exception:
        pass
    return None


async def clear_order_has_invoice(order_id: int) -> bool:
    """Attempt to set HasInvoice=False on a TeamGram order (best-effort)."""
    try:
        order = await get_order(order_id)
        order["RelatedEntityId"] = order.get("RelatedEntity", {}).get("Id")
        order["HasInvoice"] = False
        url = f"{BASE}/v1/{DOMAIN}/Orders/Edit"
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(url, headers=HEADERS, json=order)
    except Exception:
        pass
    return True  # best-effort; TeamGram may ignore this field


async def get_order_weblink(order_id: int) -> str:
    return f"https://www.teamgram.com/{DOMAIN}/orders/show?id={order_id}&tab=1"


async def get_metadata() -> dict:
    return await _get(f"{DOMAIN}/ScheduledRequests/MetaData")
