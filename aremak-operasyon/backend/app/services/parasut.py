import time
import httpx
from typing import Optional
from app.core.config import settings

BASE = "https://api.parasut.com"
COMPANY = settings.PARASUT_COMPANY_ID

_token_cache: dict = {}          # {access_token, expires_at, refresh_token}
_invoice_cache: dict = {}        # {data: [...], fetched_at: float}
INVOICE_CACHE_TTL = 1800         # 30 minutes


async def _get_token() -> str:
    now = time.time()
    if _token_cache.get("access_token") and _token_cache.get("expires_at", 0) > now + 60:
        return _token_cache["access_token"]

    # Try refresh first if we have a refresh token
    if _token_cache.get("refresh_token"):
        tok = await _refresh_token(_token_cache["refresh_token"])
        if tok:
            return tok

    return await _password_grant()


async def _password_grant() -> str:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            f"{BASE}/oauth/token",
            data={
                "grant_type": "password",
                "client_id": settings.PARASUT_CLIENT_ID,
                "client_secret": settings.PARASUT_CLIENT_SECRET,
                "username": settings.PARASUT_USERNAME,
                "password": settings.PARASUT_PASSWORD,
                "redirect_uri": "urn:ietf:wg:oauth:2.0:oob",
            },
        )
        r.raise_for_status()
        d = r.json()
        _token_cache["access_token"] = d["access_token"]
        _token_cache["refresh_token"] = d.get("refresh_token")
        _token_cache["expires_at"] = time.time() + d.get("expires_in", 7200)
        return d["access_token"]


async def _refresh_token(refresh_token: str) -> Optional[str]:
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{BASE}/oauth/token",
                data={
                    "grant_type": "refresh_token",
                    "client_id": settings.PARASUT_CLIENT_ID,
                    "client_secret": settings.PARASUT_CLIENT_SECRET,
                    "refresh_token": refresh_token,
                },
            )
            r.raise_for_status()
            d = r.json()
            _token_cache["access_token"] = d["access_token"]
            _token_cache["refresh_token"] = d.get("refresh_token")
            _token_cache["expires_at"] = time.time() + d.get("expires_in", 7200)
            return d["access_token"]
    except Exception:
        return None


async def _api_get(path: str, params: dict = None) -> dict:
    token = await _get_token()
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            f"{BASE}/v4/{COMPANY}/{path}",
            headers={"Authorization": f"Bearer {token}"},
            params=params or {},
        )
        r.raise_for_status()
        return r.json()


def _normalize(name: str) -> str:
    import re
    if not name:
        return ""
    return re.sub(r'\s+', ' ', name.strip().lower())


async def get_invoices() -> list:
    """Return cached sales invoices list, refresh if stale."""
    now = time.time()
    if _invoice_cache.get("data") and _invoice_cache.get("fetched_at", 0) + INVOICE_CACHE_TTL > now:
        return _invoice_cache["data"]

    invoices = await _fetch_all_invoices()
    _invoice_cache["data"] = invoices
    _invoice_cache["fetched_at"] = now
    return invoices


async def _fetch_all_invoices() -> list:
    """Fetch all sales invoices (up to 200 most recent) with contact info."""
    all_invoices = []
    page = 1
    while True:
        data = await _api_get(
            "sales_invoices",
            {
                "include": "contact",
                "sort": "-issue_date",
                "page[number]": page,
                "page[size]": 25,
                "filter[item_type]": "invoice",
            },
        )
        items = data.get("data", [])
        included = {
            f"{i['type']}/{i['id']}": i
            for i in data.get("included", [])
        }
        for inv in items:
            attrs = inv.get("attributes", {})
            contact_rel = inv.get("relationships", {}).get("contact", {}).get("data")
            contact_name = ""
            if contact_rel:
                key = f"{contact_rel['type']}/{contact_rel['id']}"
                contact_obj = included.get(key, {})
                contact_attrs = contact_obj.get("attributes", {})
                contact_name = contact_attrs.get("name", "") or contact_attrs.get("short_name", "")

            all_invoices.append({
                "id": inv["id"],
                "invoice_no": attrs.get("invoice_no") or attrs.get("invoice_id", ""),
                "issue_date": attrs.get("issue_date", ""),
                "net_total": attrs.get("net_total", ""),
                "gross_total": attrs.get("gross_total", ""),
                "currency": attrs.get("currency", "TRL"),
                "contact_name": contact_name,
                "contact_name_normalized": _normalize(contact_name),
                "url": f"https://uygulama.parasut.com/{COMPANY}/satislar/{inv['id']}",
            })

        meta = data.get("meta", {})
        if page >= meta.get("total_pages", 1) or page >= 8:  # max 200 invoices
            break
        page += 1

    return all_invoices


def build_invoice_map(invoices: list) -> dict:
    """Map normalized contact name → most recent invoice."""
    result: dict = {}
    for inv in invoices:
        key = inv["contact_name_normalized"]
        if not key:
            continue
        if key not in result or inv["issue_date"] > result[key]["issue_date"]:
            result[key] = inv
    return result


async def get_invoice_pdf_url(invoice_id: str) -> Optional[str]:
    """Get temporary PDF URL for an invoice (valid ~1 hour)."""
    token = await _get_token()
    async with httpx.AsyncClient(timeout=30) as client:
        # Get invoice with active e-document
        r = await client.get(
            f"{BASE}/v4/{COMPANY}/sales_invoices/{invoice_id}",
            headers={"Authorization": f"Bearer {token}"},
            params={"include": "active_e_document"},
        )
        r.raise_for_status()
        data = r.json()

    included = data.get("included", [])
    if not included:
        return None

    e_doc = included[0]
    e_doc_type = e_doc["type"]   # "e_archives" or "e_invoices"
    e_doc_id = e_doc["id"]

    token = await _get_token()
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            f"{BASE}/v4/{COMPANY}/{e_doc_type}/{e_doc_id}/pdf",
            headers={"Authorization": f"Bearer {token}"},
        )
        if r.status_code == 204:
            return None
        r.raise_for_status()
        pdf_data = r.json()

    return pdf_data.get("data", {}).get("attributes", {}).get("url")


async def invalidate_cache():
    _invoice_cache.clear()
