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


async def get_order_weblink(order_id: int) -> str:
    return f"https://www.teamgram.com/{DOMAIN}/orders/show?id={order_id}&tab=1"


async def get_metadata() -> dict:
    return await _get(f"{DOMAIN}/ScheduledRequests/MetaData")
