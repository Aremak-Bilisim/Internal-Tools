"""
Hepsiburada Marketplace REST API client (SIT/PROD).

Auth: Basic (Merchant_ID:secret_key) + User-Agent header zorunlu.
Base URL: SIT için https://oms-external-sit.hepsiburada.com (settings'ten okunur).

Doc: https://developers.hepsiburada.com/hepsiburada/reference/

Sadece bizim akışta kullanılan endpoint'ler:
  - GET    /orders/merchantid/{mid}/ordernumber/{order_no}        → sipariş detayı
  - GET    /orders/merchantid/{mid}                                → ödemesi tamamlanmış (Paketlenecek) liste
  - GET    /lineitems/merchantid/{mid}/packageablewith/{lineId}    → aynı pakete konulabilir kalemler
  - POST   /packages/merchantid/{mid}                              → paket oluştur (kalem listesi gönder)
  - GET    /packages/merchantid/{mid}/packagenumber/{pkg}          → paket bilgisi (kargo barkod, tracking)
  - POST   /lineitems/merchantid/{mid}/.../faturalink              → fatura linki gönder
"""
import base64
import logging
from typing import Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


def _auth_headers() -> dict:
    if not settings.HEPSIBURADA_MERCHANT_ID or not settings.HEPSIBURADA_SECRET_KEY:
        raise RuntimeError("HEPSIBURADA_MERCHANT_ID/SECRET_KEY env'de set edilmemiş")
    creds = f"{settings.HEPSIBURADA_MERCHANT_ID}:{settings.HEPSIBURADA_SECRET_KEY}"
    b64 = base64.b64encode(creds.encode("utf-8")).decode("ascii")
    return {
        "Authorization": f"Basic {b64}",
        "User-Agent": settings.HEPSIBURADA_USER_AGENT or "aremak-operasyon",
        "Accept": "application/json",
    }


def _mid() -> str:
    return settings.HEPSIBURADA_MERCHANT_ID


def _base() -> str:
    return settings.HEPSIBURADA_API_BASE_URL.rstrip("/")


# ── ORDER ─────────────────────────────────────────────────────────────────────

async def get_order(order_number: str) -> Optional[dict]:
    """Tek bir HB siparişin detayını çeker (merchantid + ordernumber)."""
    url = f"{_base()}/orders/merchantid/{_mid()}/ordernumber/{order_number}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url, headers=_auth_headers())
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()


async def list_pending_orders(offset: int = 0, limit: int = 50) -> dict:
    """Ödemesi tamamlanmış (Paketlenecek) siparişleri listeler."""
    url = f"{_base()}/orders/merchantid/{_mid()}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url, headers=_auth_headers(),
                             params={"offset": offset, "limit": limit})
        r.raise_for_status()
        return r.json()


async def list_packageable_with(line_item_id: str) -> dict:
    """Bir sipariş kalemiyle aynı pakete konulabilecek diğer kalemler."""
    url = f"{_base()}/lineitems/merchantid/{_mid()}/packageablewith/{line_item_id}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url, headers=_auth_headers())
        r.raise_for_status()
        return r.json()


# ── PACKAGE ───────────────────────────────────────────────────────────────────

async def create_package(line_item_ids: list[str]) -> dict:
    """Paket oluştur (HB tarafında). line_item_ids: items[].id listesidir.
    Response: paket numarası + kargo bilgisi."""
    url = f"{_base()}/packages/merchantid/{_mid()}"
    payload = [{"lineItemId": lid} for lid in line_item_ids]
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(url, headers={**_auth_headers(), "Content-Type": "application/json"},
                              json=payload)
        r.raise_for_status()
        return r.json()


async def get_package(package_number: str) -> Optional[dict]:
    """Paket bilgisi (kargo barkodu, tracking URL, durum)."""
    url = f"{_base()}/packages/merchantid/{_mid()}/packagenumber/{package_number}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url, headers=_auth_headers())
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()


# ── INVOICE LINK ──────────────────────────────────────────────────────────────

async def send_invoice_link(line_item_id: str, invoice_url: str, invoice_number: str = "") -> dict:
    """E-Arşiv fatura linkini HB'ye gönder (müşteri HB üzerinden görüntüleyecek).

    HB doc'a göre endpoint pattern (oms-external):
        POST /lineitems/merchantid/{mid}/id/{line_item_id}/faturalink
    Body: {"invoiceLink": "...", "invoiceNumber": "..."}
    """
    url = f"{_base()}/lineitems/merchantid/{_mid()}/id/{line_item_id}/faturalink"
    payload = {"invoiceLink": invoice_url}
    if invoice_number:
        payload["invoiceNumber"] = invoice_number
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(url, headers={**_auth_headers(), "Content-Type": "application/json"},
                              json=payload)
        r.raise_for_status()
        return r.json() if r.text else {"ok": True}
