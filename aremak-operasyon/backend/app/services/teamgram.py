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


async def get_orders(page: int = 1, pagesize: int = 50, fid: Optional[int] = None) -> dict:
    params = {"page": page, "pagesize": pagesize}
    if fid is not None:
        params["fid"] = fid
    return await _get_v1(f"{DOMAIN}/Orders/Index", params)


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


async def get_metadata() -> dict:
    return await _get(f"{DOMAIN}/ScheduledRequests/MetaData")
