import time
import httpx
import logging
from typing import Optional
from app.core.config import settings

logger = logging.getLogger(__name__)

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
    # Replace Turkish İ before .lower() to avoid i+combining-dot-above (U+0307)
    name = name.replace('İ', 'i').replace('I', 'ı')
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
            contact_tax_number = ""
            if contact_rel:
                key = f"{contact_rel['type']}/{contact_rel['id']}"
                contact_obj = included.get(key, {})
                contact_attrs = contact_obj.get("attributes", {})
                contact_name = contact_attrs.get("name", "") or contact_attrs.get("short_name", "")
                contact_tax_number = contact_attrs.get("tax_number", "") or ""

            all_invoices.append({
                "id": inv["id"],
                "description": attrs.get("description", "") or "",
                "invoice_no": attrs.get("invoice_no") or attrs.get("invoice_id", ""),
                "issue_date": attrs.get("issue_date", ""),
                "net_total": attrs.get("net_total", ""),
                "gross_total": attrs.get("gross_total", ""),
                "currency": attrs.get("currency", "TRL"),
                "contact_name": contact_name,
                "contact_name_normalized": _normalize(contact_name),
                "contact_tax_number": contact_tax_number,
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


async def get_invoice_details(invoice_id: str) -> Optional[dict]:
    """Tek fatura için özet bilgileri döner."""
    token = await _get_token()
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            f"{BASE}/v4/{COMPANY}/sales_invoices/{invoice_id}",
            headers={"Authorization": f"Bearer {token}"},
            params={"include": "contact"},
        )
        if not r.is_success:
            return None
        data = r.json()

    inv = data["data"]
    attrs = inv.get("attributes", {})
    included = {f"{i['type']}/{i['id']}": i for i in data.get("included", [])}
    contact_rel = inv.get("relationships", {}).get("contact", {}).get("data")
    contact_name = ""
    if contact_rel:
        c = included.get(f"{contact_rel['type']}/{contact_rel['id']}", {})
        contact_name = c.get("attributes", {}).get("name", "")

    return {
        "id": inv["id"],
        "invoice_no": attrs.get("invoice_no") or attrs.get("invoice_id", ""),
        "description": attrs.get("description", ""),
        "issue_date": attrs.get("issue_date", ""),
        "gross_total": attrs.get("gross_total", ""),
        "net_total": attrs.get("net_total", ""),
        "currency": attrs.get("currency", "TRL"),
        "contact_name": contact_name,
        "url": f"https://uygulama.parasut.com/{COMPANY}/satislar/{inv['id']}",
    }


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


async def get_irsaliye_pdf_url(irsaliye_id: str) -> Optional[str]:
    """Shipment document (irsaliye) için geçici PDF URL döner."""
    token = await _get_token()
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            f"{BASE}/v4/{COMPANY}/shipment_documents/{irsaliye_id}/pdf",
            headers={"Authorization": f"Bearer {token}"},
        )
        if r.status_code == 204 or not r.is_success:
            return None
        data = r.json()
    return data.get("data", {}).get("attributes", {}).get("url")


async def get_irsaliye_info(irsaliye_id: str) -> Optional[dict]:
    """Shipment document bilgilerini döner (numara, tarih, url)."""
    token = await _get_token()
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            f"{BASE}/v4/{COMPANY}/shipment_documents/{irsaliye_id}",
            headers={"Authorization": f"Bearer {token}"},
            params={"include": "contact"},
        )
        if not r.is_success:
            return None
        data = r.json()
        attrs = data["data"]["attributes"]
        included = {f"{i['type']}/{i['id']}": i for i in data.get("included", [])}
        contact_rel = data["data"].get("relationships", {}).get("contact", {}).get("data")
        contact_name = ""
        if contact_rel:
            c = included.get(f"{contact_rel['type']}/{contact_rel['id']}", {})
            contact_name = c.get("attributes", {}).get("name", "")
    return {
        "id": irsaliye_id,
        "irsaliye_no": attrs.get("despatch_no"),
        "description": attrs.get("description"),
        "issue_date": attrs.get("issue_date"),
        "shipment_date": attrs.get("shipment_date"),
        "contact_name": contact_name,
        "url": f"https://uygulama.parasut.com/{COMPANY}/irsaliyeler/{irsaliye_id}",
    }


WAREHOUSE_ID = "1000081985"  # Ana Depo


async def _api_patch(path: str, payload: dict) -> dict:
    token = await _get_token()
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.patch(
            f"{BASE}/v4/{COMPANY}/{path}",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/vnd.api+json"},
            json=payload,
        )
        r.raise_for_status()
        return r.json() if r.content else {}


async def _api_post(path: str, payload: dict) -> dict:
    token = await _get_token()
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            f"{BASE}/v4/{COMPANY}/{path}",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/vnd.api+json"},
            json=payload,
        )
        r.raise_for_status()
        return r.json() if r.content else {}


async def delete_invoice(invoice_id: str) -> bool:
    """Delete (cancel/void) a sales invoice from Paraşüt."""
    token = await _get_token()
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.delete(
            f"{BASE}/v4/{COMPANY}/sales_invoices/{invoice_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
    return r.status_code < 300


def _extract_zip(address: str) -> Optional[str]:
    """Try to find a 5-digit Turkish postal code in the address string."""
    import re
    if not address:
        return None
    m = re.search(r'\b(\d{5})\b', address)
    return m.group(1) if m else None


def _strip_html(text: str) -> str:
    """HTML tag ve entity'leri temizler. <br> → boşluk, diğer taglar → boşluk."""
    import re
    if not text:
        return text
    text = re.sub(r'<br\s*/?>', ' ', text, flags=re.IGNORECASE)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = text.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&nbsp;', ' ')
    text = re.sub(r'[ \t]+', ' ', text)
    return text.strip()


# Kargo şirketi adı → (carrier_legal_name, carrier_tax_number)
CARGO_COMPANY_MAP = {
    "yurtiçi kargo":  ("YURTİÇİ KARGO SERVİSİ ANONİM ŞİRKETİ", "9860008925"),
    "yurtici kargo":  ("YURTİÇİ KARGO SERVİSİ ANONİM ŞİRKETİ", "9860008925"),
    "mng kargo":      ("MNG KARGO SERVİSİ ANONİM ŞİRKETİ", "6150171568"),
    "aras kargo":     ("ARAS KARGO SERVİS DAĞITIM SANAYİ VE TİCARET ANONİM ŞİRKETİ", "1490078198"),
    "ptt kargo":      ("POSTA VE TELGRAF TEŞKİLATI ANONİM ŞİRKETİ", "5920024812"),
    "dhl":            ("DHL EXPRESS TURKEY TAŞIMACILIK LIMITED ŞİRKETİ", "3490054308"),
    "fedex":          ("FEDERAL EXPRESS CORPORATION TÜRKİYE ŞUBE", ""),
    "ups":            ("UNITED PARCEL SERVICE INC. TÜRKİYE ŞUBE", ""),
    "sürat kargo":    ("SÜRAT KARGO VE LOJİSTİK ANONİM ŞİRKETİ", "4690065236"),
    "surat kargo":    ("SÜRAT KARGO VE LOJİSTİK ANONİM ŞİRKETİ", "4690065236"),
}


async def create_irsaliye_from_invoice(
    invoice_id: str,
    issue_date: Optional[str] = None,
    delivery_address: Optional[str] = None,
    delivery_district: Optional[str] = None,
    delivery_city: Optional[str] = None,
    delivery_zip: Optional[str] = None,
    delivery_type: Optional[str] = None,    # "Kargo" | "Ofis Teslim"
    cargo_company: Optional[str] = None,    # "Yurtiçi Kargo" vb.
) -> dict:
    """
    1. Fetch invoice to get contact + line items with products.
    2. PATCH invoice to set shipment_included=false (stok çıkışı yapılmasın).
    3. POST shipment_document linked to invoice with stock_movements.

    - Kargo: carrier_legal_name + carrier_tax_number (CARGO_COMPANY_MAP)
    - Ofis Teslim / Taşıyıcı: carrier_license_plate = XXXXXXXX
    - issue_date: today (creation date)
    - shipment_date: planned_ship_date + T23:59:59 (always >= issue_date midnight)
    """
    import datetime

    today = datetime.date.today()
    now_utc = datetime.datetime.utcnow()
    if not issue_date:
        issue_date = today.isoformat()

    # Düzenleme tarihi saati: irsaliyenin oluşturulduğu an (UTC)
    issue_datetime_utc = now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    issue_time_utc = now_utc.strftime("%H:%M:%S")

    # Fiili sevk tarihi: planlanan tarih, saat 12:00 UTC (= 15:00 TR saati)
    # → issue_date ile aynı gün, düzenleme tarihinden sonra
    try:
        ship_date = datetime.date.fromisoformat(issue_date)
    except Exception:
        ship_date = today
    if ship_date < today:
        ship_date = today
    # T12:00:00 UTC = 15:00 TR → planlanan günde kalır, gece yarısından sonra
    shipment_datetime = f"{ship_date.isoformat()}T12:00:00Z"

    token = await _get_token()
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            f"{BASE}/v4/{COMPANY}/sales_invoices/{invoice_id}",
            headers={"Authorization": f"Bearer {token}"},
            params={"include": "contact,details,details.product"},
        )
        r.raise_for_status()
        data = r.json()

    inv = data["data"]
    contact_id = inv["relationships"]["contact"]["data"]["id"]
    included = {f"{i['type']}/{i['id']}": i for i in data.get("included", [])}

    # Step 1: set shipment_included=false on invoice (stok çıkışı yapılmasın)
    if inv["attributes"].get("shipment_included") is not False:
        try:
            await _api_patch(
                f"sales_invoices/{invoice_id}",
                {"data": {"id": str(invoice_id), "type": "sales_invoices", "attributes": {"shipment_included": False}}},
            )
        except Exception:
            pass  # May fail on e-signed invoices; continue anyway

    # Step 2: build stock movements from invoice details
    stock_movements = []
    for d_ref in inv["relationships"].get("details", {}).get("data", []):
        d = included.get(f"{d_ref['type']}/{d_ref['id']}", {})
        d_attrs = d.get("attributes", {})
        qty = float(d_attrs.get("quantity") or 0)
        if qty <= 0:
            continue
        prod_data = d.get("relationships", {}).get("product", {}).get("data")
        if not prod_data:
            continue
        stock_movements.append({
            "type": "stock_movements",
            "attributes": {"quantity": qty, "inflow": False, "date": issue_date},
            "relationships": {
                "product": {"data": {"type": "products", "id": prod_data["id"]}},
                "warehouse": {"data": {"type": "warehouses", "id": WAREHOUSE_ID}},
            },
        })

    # Step 3: irsaliye adı = fatura açıklaması veya fatura no
    inv_attrs = inv.get("attributes", {})
    irsaliye_desc = (
        inv_attrs.get("description")
        or inv_attrs.get("invoice_no")
        or inv_attrs.get("invoice_id")
        or ""
    )

    # Step 4: build payload with correct Paraşüt field names
    # HTML temizle (TeamGram'dan <br> vb. gelebilir)
    delivery_address  = _strip_html(delivery_address)
    delivery_district = _strip_html(delivery_district)
    delivery_city     = _strip_html(delivery_city)

    # Posta kodu: explicit parametre → adresten regex → "00000"
    dest_zip = delivery_zip or _extract_zip(delivery_address) or "00000"

    # Sevkiyat yöntemi: Kargo → carrier_legal_name + carrier_tax_number
    #                   Ofis Teslim → carrier_license_plate = XXXXXXXX
    carrier_legal_name = None
    carrier_tax_number = None
    carrier_license_plate = None

    if delivery_type == "Kargo" and cargo_company:
        key = cargo_company.lower().strip()
        mapped = CARGO_COMPANY_MAP.get(key)
        if mapped:
            carrier_legal_name, carrier_tax_number = mapped
        else:
            # Bilinmeyen kargo: adı olduğu gibi gönder
            carrier_legal_name = cargo_company
    elif delivery_type == "Ofis Teslim":
        carrier_license_plate = "XXXXXXXX"
        # Not: drivers_info (şoför adı/TCKN) Paraşüt API'si üzerinden
        # set edilemiyor — e-irsaliye imzalama sürecinde GİB tarafından dolduruluyor.
        # Ofis teslimde varış adresi = çıkış adresi (depo)
        delivery_address  = "Beştepe Mah. Nergis Sok. No:7/2"
        delivery_district = "Yenimahalle"
        delivery_city     = "Ankara"
        dest_zip          = "06560"

    attrs: dict = {
        "inflow": False,
        "issue_date": issue_date,
        "issue_time": issue_time_utc,
        "issue_datetime": issue_datetime_utc,
        "shipment_date": shipment_datetime,
        "description": irsaliye_desc,
        # Sevkiyat (varış) adresi
        "address":     (delivery_address or "").strip() or None,
        "district":    (delivery_district or "").strip() or None,
        "city":        (delivery_city or "").strip() or None,
        "postal_code": dest_zip,
        # Çıkış adresi (sabit depo adresi)
        "company_address":     "Beştepe Mah. Nergis Sok. No:7/2",
        "company_district":    "Yenimahalle",
        "company_city":        "Ankara",
        "company_postal_code": "06560",
        # Sevkiyat yöntemi
        "carrier_legal_name":    carrier_legal_name,
        "carrier_tax_number":    carrier_tax_number,
        "carrier_license_plate": carrier_license_plate,
    }
    # None değerleri çıkar (Paraşüt boş string yerine null bekler)
    attrs = {k: v for k, v in attrs.items() if v is not None}

    payload = {
        "data": {
            "type": "shipment_documents",
            "attributes": attrs,
            "relationships": {
                "contact": {"data": {"type": "contacts", "id": contact_id}},
                "invoices": {"data": [{"type": "sales_invoices", "id": str(invoice_id)}]},
                "stock_movements": {"data": stock_movements},
            },
        }
    }

    import datetime as _dt
    with open("debug_shipment.log", "a", encoding="utf-8") as _f:
        _f.write(f"[{_dt.datetime.now()}] parasut_attrs: {attrs}\n")
    return await _api_post("shipment_documents", payload)
