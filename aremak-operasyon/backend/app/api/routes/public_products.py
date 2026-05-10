"""Public ürün lookup endpoint'leri — 3rd party agent (kamera seçici vb.) için.

Auth: X-API-Key header. settings.CAMERA_AGENT_API_KEY ile karşılaştırılır.
JWT/cookie kullanmaz; service-to-service.

Read-only. Local DB'den okur (TG mirror) — TG'ye gitmez. Inventory en kötü
6 saatlik (product_sync.FULL_SYNC_INTERVAL). Response top-level
'data_synced_at' (en eski sync zamanı) ile freshness sinyali döner.
"""
from typing import List, Optional
from datetime import timezone
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.database import get_db
from app.models.product import Product

router = APIRouter()

MAX_BATCH_SIZE = 100  # makul üst sınır; kamera shortlist'i 10-20 civarı


def verify_api_key(x_api_key: Optional[str] = Header(None, alias="X-API-Key")):
    """Service-to-service API key kontrolü."""
    if not settings.CAMERA_AGENT_API_KEY:
        # Anahtar config'te tanımlı değilse public endpoint'leri kapat
        raise HTTPException(status_code=503, detail="Public API anahtarı yapılandırılmamış")
    if not x_api_key or x_api_key != settings.CAMERA_AGENT_API_KEY:
        raise HTTPException(status_code=401, detail="Geçersiz API anahtarı")


class BatchLookupIn(BaseModel):
    skus: List[str] = Field(..., min_length=1, max_length=MAX_BATCH_SIZE,
                             description="Sorgulanacak SKU'lar (exact match)")
    include_inactive: bool = Field(False,
                                    description="Pasif (not_available=true) ürünleri de dahil et")


def _product_to_dict(p: Product) -> dict:
    """Public response — yalnızca dış uygulamaya gerekli alanlar."""
    return {
        "found": True,
        "sku": p.sku,
        "tg_id": p.tg_id,
        "brand": p.brand,
        "model": p.prod_model,
        "category": p.category_name,
        "parent_category": p.parent_category_name,
        "stock_qty": float(p.inventory or 0),
        "is_critical_stock": (p.inventory or 0) <= (p.critical_inventory or 0)
                              if p.critical_inventory else False,
        "is_active": not bool(p.not_available),
        "no_inventory_tracking": bool(p.no_inventory),
        "price": p.price,
        "currency": p.currency_name,
        "purchase_price": p.purchase_price,
        "purchase_currency": p.purchase_currency_name,
        "unit": p.unit,
        "vat": p.vat,
        "datasheet_url": p.datasheet_url,
        "shelf": p.shelf,
        "synced_at": p.synced_at.astimezone(timezone.utc).isoformat() if p.synced_at else None,
    }


@router.post("/products/batch-lookup", dependencies=[Depends(verify_api_key)])
def batch_lookup(data: BatchLookupIn, db: Session = Depends(get_db)):
    """Birden fazla SKU'yu tek sorguda local DB'den çeker.

    Response yapısı:
      {
        "data_synced_at": ISO8601 (en eski sync — worst-case freshness),
        "count": int,
        "found_count": int,
        "items": [
          {"sku": ..., "found": true, "stock_qty": N, "model": ..., ...},
          {"sku": ..., "found": false}
        ]
      }
    Pending (onay bekleyen) ürünler default'ta gizli.
    """
    # Boş/whitespace SKU'ları temizle, dedupe et (sıra korunur)
    clean_skus, seen = [], set()
    for s in data.skus:
        s = (s or "").strip()
        if s and s not in seen:
            seen.add(s)
            clean_skus.append(s)
    if not clean_skus:
        raise HTTPException(status_code=400, detail="Geçerli SKU yok")

    q = db.query(Product).filter(Product.sku.in_(clean_skus))
    q = q.filter(Product.pending_approval.is_(False))  # onay bekleyenleri her zaman gizle
    if not data.include_inactive:
        q = q.filter(Product.not_available.is_(False))
    rows = q.all()

    by_sku = {p.sku: p for p in rows}

    items = []
    oldest_sync = None
    for sku in clean_skus:
        p = by_sku.get(sku)
        if p:
            items.append(_product_to_dict(p))
            if p.synced_at:
                if oldest_sync is None or p.synced_at < oldest_sync:
                    oldest_sync = p.synced_at
        else:
            items.append({"sku": sku, "found": False})

    return {
        "data_synced_at": oldest_sync.astimezone(timezone.utc).isoformat() if oldest_sync else None,
        "count": len(items),
        "found_count": len(rows),
        "items": items,
    }
