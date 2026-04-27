import asyncio
import httpx
import time
from typing import Optional
from app.core.config import settings

BASE = settings.TEAMGRAM_BASE_URL
DOMAIN = settings.TEAMGRAM_DOMAIN
HEADERS = {"Token": settings.TEAMGRAM_TOKEN}

# VKN → company dict cache (1 saat TTL)
_vkn_cache: dict = {}   # {"index": {vkn: company_dict}, "fetched_at": float}
_VKN_CACHE_TTL = 3600   # 1 saat


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


async def _post(path: str, payload: dict) -> dict:
    """TeamGram'a POST isteği gönderir. path örnek: '{DOMAIN}/Companies/Create'"""
    url = f"{BASE}/{path}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(url, headers=HEADERS, json=payload)
        r.raise_for_status()
        return r.json()


async def _post_v1(path: str, payload: dict) -> dict:
    """TeamGram v1 API'ye POST isteği gönderir."""
    url = f"{BASE}/v1/{path}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(url, headers=HEADERS, json=payload)
        r.raise_for_status()
        return r.json()


async def get_products(page: int = 1, pagesize: int = 50) -> dict:
    return await _get(f"{DOMAIN}/Products/Index", {"page": page, "pagesize": pagesize})


async def get_product(product_id: int) -> dict:
    return await _get(f"{DOMAIN}/Products/Get", {"id": product_id})


async def get_products_all(page: int = 1, pagesize: int = 100) -> dict:
    return await _get(f"{DOMAIN}/Products/GetAll", {"id": 0, "page": page, "pagesize": pagesize})


async def create_product(payload: dict) -> dict:
    """TeamGram'da yeni ürün oluştur. Returns {Result, Id}."""
    url = f"{BASE}/{DOMAIN}/Products/Create"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(url, headers=HEADERS, json=payload)
        r.raise_for_status()
        return r.json()


async def get_product_edit_payload(product_id: int) -> dict:
    """Products/Edit GET → mevcut ürünün tam edit payload'ını döndürür."""
    url = f"{BASE}/{DOMAIN}/Products/Edit"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url, headers=HEADERS, params={"id": product_id})
        r.raise_for_status()
        return r.json()


async def edit_product(payload: dict) -> dict:
    """TeamGram'da ürün güncelle. payload içinde Id zorunlu."""
    url = f"{BASE}/{DOMAIN}/Products/Edit"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(url, headers=HEADERS, json=payload)
        r.raise_for_status()
        return r.json()


async def delete_product(product_id: int) -> dict:
    """TeamGram'da ürün sil. Returns {Result}."""
    url = f"{BASE}/{DOMAIN}/Products/Delete"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(url, headers=HEADERS, json={"Id": product_id})
        r.raise_for_status()
        return r.json()


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


async def _build_vkn_index() -> dict:
    """Tüm firmaları GetAll ile çekip VKN→firma index'i oluşturur. Cache'e kaydedilir."""
    index = {}
    page = 1
    pagesize = 100
    while True:
        r = await _get(f"{DOMAIN}/Companies/GetAll", {"page": page, "pagesize": pagesize})
        companies = r.get("companies", [])
        if not companies:
            break
        for c in companies:
            tax_no = (c.get("TaxNo") or "").strip()
            if tax_no:
                contacts = c.get("Contactinfos", [])
                address_info = next((x for x in contacts if x.get("ContactinfoType", {}).get("Name") == "Address"), None)
                phone = next((x.get("Value") for x in contacts if x.get("ContactinfoType", {}).get("Name") == "Phone"), None)
                email = next((x.get("Value") for x in contacts if x.get("ContactinfoType", {}).get("Name") == "Email"), None)
                index[tax_no] = {
                    "id": c["Id"],
                    "name": c.get("Name"),
                    "tax_no": tax_no,
                    "tax_office": c.get("TaxOffice"),
                    "address": address_info.get("Value") if address_info else None,
                    "city": c.get("CityName") or (address_info.get("CityName") if address_info else None),
                    "district": c.get("StateName") or (address_info.get("StateName") if address_info else None),
                    "phone": phone,
                    "email": email,
                }
        total = r.get("count", 0)
        if page * pagesize >= total:
            break
        page += 1
    return index


async def get_companies_by_vkn(vkn: str, company_name: Optional[str] = None) -> list:
    """VKN ile TeamGram'da firma arar. İlk çağrıda cache oluşturulur (~20-30 sn),
    sonraki sorgular cache'den anında döner (1 saat TTL)."""
    global _vkn_cache
    vkn = vkn.strip()

    now = time.time()
    if not _vkn_cache.get("index") or now - _vkn_cache.get("fetched_at", 0) > _VKN_CACHE_TTL:
        index = await _build_vkn_index()
        _vkn_cache = {"index": index, "fetched_at": now}

    match = _vkn_cache["index"].get(vkn)
    return [match] if match else []



async def get_purchases(page: int = 1, pagesize: int = 50, party_id: Optional[int] = None) -> dict:
    """Tedarikçi siparişleri listesi. party_id verilirse sadece o tedarikçinin siparişleri."""
    params = {"page": page, "pagesize": pagesize}
    if party_id:
        params["fid_party"] = party_id
    return await _get(f"{DOMAIN}/Purchases/Index", params)


async def get_purchase(purchase_id: int) -> dict:
    """Tek bir tedarikçi siparişinin detayı."""
    return await _get(f"{DOMAIN}/Purchases/Get", {"id": purchase_id})


async def create_purchase(payload: dict) -> dict:
    """
    Yeni tedarikçi siparişi oluşturur.
    DİKKAT: TG, ASCII-escape'li JSON'da Türkçe karakteri '?' yapıyor.
    Bu yüzden manuel UTF-8 byte gönderiyoruz + charset=utf-8 header.
    """
    import json as _json
    url = f"{BASE}/{DOMAIN}/Purchases/Create"
    body = _json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {**HEADERS, "Content-Type": "application/json; charset=utf-8"}
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(url, headers=headers, content=body)
        r.raise_for_status()
        return r.json()


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

    Attachment-type custom fields (193472 gibi) Orders/Edit ile gönderilince
    TeamGram tarafından temizlenebilir. Bu yüzden bu alanları, field_updates'de
    açıkça belirtilmedikçe Edit payload'ından çıkarıyoruz.
    """
    ATTACHMENT_CF_IDS = {193472}

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

    # Attachment alanlarını field_updates'de yoksa payload'dan çıkar
    cfd = [f for f in cfd if f["CustomFieldId"] not in ATTACHMENT_CF_IDS or f["CustomFieldId"] in field_updates]
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


async def get_proposals_for_opportunity(opportunity_id: int) -> dict:
    """
    Bir fırsata bağlı teklifleri çeker.
    Proposals/Index?ofid=opportunity_id ile fırsat ID'si geçilince
    yalnızca o fırsata ait teklifler gelir.
    """
    data = await _get(f"{DOMAIN}/Proposals/Index", {"ofid": opportunity_id, "page": 1, "pagesize": 50})
    return {"List": data.get("List") or []}


async def get_proposal(proposal_id: int) -> dict:
    """Teklifin tam detayını çeker — Items dahil."""
    return await _get(f"{DOMAIN}/Proposals/Get", {"id": proposal_id})


async def get_opportunities() -> dict:
    """
    Tüm fırsatları sayfalı çekip Inbound pipeline / Numune-Demo aşamasına göre filtreler.
    bfilterby_status_openactive bazı aktif fırsatları dışarıda bıraktığı için kullanılmıyor.
    """
    all_items = []
    page = 1
    while True:
        data = await _get(f"{DOMAIN}/Opportunities/Index", {"page": page, "pagesize": 100})
        items = data.get("Opportunities") or []
        all_items.extend(items)
        total = data.get("OpportunityCount") or 0
        if len(all_items) >= total or not items:
            break
        page += 1

    filtered = [
        o for o in all_items
        if (o.get("CustomPipelineName") or "").lower() == "inbound"
        and (o.get("CustomStage") or "") == "Numune/Demo Alım Süreci"
    ]
    return {"List": filtered, "Count": len(filtered)}


async def get_opportunity(opportunity_id: int) -> dict:
    return await _get(f"{DOMAIN}/Opportunities/Get", {"id": opportunity_id})


async def inventory_adjustment(product_id: int, quantity: float, reason: int = 10, desc: str = None) -> dict:
    """
    Adjust product inventory in TeamGram.
    reason=10 → InventoryUsed (numune çıkışı için)
    Field names: nInvAdj_ prefix zorunlu.
    """
    payload = {
        "nInvAdj_ProductId": product_id,
        "nInvAdj_Quantity": quantity,
        "nInvAdj_Reason": reason,
        "nInvAdj_Indate": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    if desc:
        payload["nInvAdj_Desc"] = desc
    return await _post(f"{DOMAIN}/Products/InventoryAdjustment", payload)
