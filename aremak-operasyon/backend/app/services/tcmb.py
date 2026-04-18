import httpx
import xml.etree.ElementTree as ET
from datetime import date, timedelta

_cache: dict = {}  # date_str → {USD: rate, EUR: rate, ...}


async def get_rates(for_date: date) -> dict:
    """Return TCMB ForexSelling rates for the given date (or nearest prior business day)."""
    for delta in range(7):
        d = for_date - timedelta(days=delta)
        key = d.strftime("%Y-%m-%d")
        if key in _cache:
            return _cache[key]
        rates = await _fetch(d)
        if rates:
            _cache[key] = rates
            return rates
    return {}


async def _fetch(d: date) -> dict:
    ym = d.strftime("%Y%m")
    dmy = d.strftime("%d%m%Y")
    url = f"https://www.tcmb.gov.tr/kurlar/{ym}/{dmy}.xml"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url)
            if r.status_code != 200:
                return {}
        root = ET.fromstring(r.text)
        rates = {}
        for cur in root.findall("Currency"):
            code = cur.get("CurrencyCode", "")
            unit_el = cur.find("Unit")
            sell_el = cur.find("ForexSelling")
            if code and unit_el is not None and sell_el is not None:
                try:
                    unit = int(unit_el.text or "1")
                    sell = float(sell_el.text.replace(",", "."))
                    rates[code] = sell / unit
                except (ValueError, AttributeError):
                    pass
        return rates
    except Exception:
        return {}
