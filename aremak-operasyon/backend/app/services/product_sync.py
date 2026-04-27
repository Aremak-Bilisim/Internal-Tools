"""Ürün senkronizasyon servisi.

- full_sync(): Tüm ürünler GetAll ile çekilir, DB'ye upsert edilir.
- start_background_sync(): Startup'ta çalışır, sonra 6 saatte bir yeniler.
"""

import asyncio
import logging
from typing import Optional

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.product import Product
from app.services import teamgram

logger = logging.getLogger(__name__)

FULL_SYNC_INTERVAL = 6 * 3600    # 6 saat — TG ürün sync
PARASUT_SYNC_INTERVAL = 24 * 3600  # 24 saat — Paraşüt eşleştirme
_syncing = False


def _currency_name_to_id(name: Optional[str]) -> Optional[int]:
    mapping = {"TL": 1, "TRY": 1, "USD": 2, "EUR": 3}
    return mapping.get((name or "").upper())


def _currency_id_to_name(cid: Optional[int]) -> Optional[str]:
    mapping = {1: "TL", 2: "USD", 3: "EUR"}
    return mapping.get(cid)


CF_DATASHEET = 193440  # Datasheet (Web adresi)
CF_SHELF = 193563      # Raf


def _product_to_dict(p: dict, parent_map: dict) -> dict:
    """TeamGram product dict → DB dict. parent_map: {cat_id: (parent_id, parent_name)}"""
    cat = p.get("Category") or {}
    cat_id = cat.get("Id")
    cat_name = cat.get("Name")
    parent_id, parent_name = parent_map.get(cat_id, (None, None))

    cfs = {cf["CustomFieldId"]: cf.get("Value") for cf in (p.get("CustomFieldDatas") or [])}

    def _cf_label(raw):
        """Select tipi CF'lerin Value'su JSON ({"Id":..., "Value":"label"})."""
        if raw is None:
            return None
        s = str(raw).strip()
        if not s:
            return None
        if s.startswith("{"):
            try:
                import json as _json
                obj = _json.loads(s)
                if isinstance(obj, dict):
                    return obj.get("Value") or obj.get("Label") or None
            except Exception:
                pass
        return s

    return {
        "tg_id": p["Id"],
        "brand": p.get("Brand"),
        "prod_model": p.get("ProdModel"),
        "sku": p.get("Sku"),
        "price": p.get("Price"),
        "currency_name": p.get("CurrencyName"),
        "purchase_price": p.get("PurchasePrice"),
        "purchase_currency_name": p.get("PurchaseCurrencyName"),
        "category_id": cat_id,
        "category_name": cat_name,
        "parent_category_id": parent_id,
        "parent_category_name": parent_name,
        "unit": p.get("Unit"),
        "vat": p.get("Vat"),
        "no_inventory": bool(p.get("NoInventory")),
        "inventory": p.get("Inventory") or 0.0,
        "critical_inventory": p.get("CriticalInventory") or 0,
        "details": p.get("Details"),
        "not_available": bool(p.get("NotAvaliable")),
        "datasheet_url": cfs.get(CF_DATASHEET) or None,
        "shelf": _cf_label(cfs.get(CF_SHELF)),
    }


def _upsert(db: Session, data: dict):
    tg_id = data["tg_id"]
    obj = db.query(Product).filter(Product.tg_id == tg_id).first()
    if obj:
        for k, v in data.items():
            setattr(obj, k, v)
    else:
        obj = Product(**data)
        db.add(obj)


async def _build_parent_map() -> dict:
    """MetaData'dan {cat_id: (parent_id, parent_name)} haritası oluşturur."""
    try:
        meta = await teamgram.get_metadata()
        cats = meta.get("Categories", [])
        parent_cats = {c["Id"]: c["Name"] for c in cats if c.get("Level") == 0}
        result = {}
        for c in cats:
            if c.get("Level") == 1:
                pid = c.get("ParentId")
                result[c["Id"]] = (pid, parent_cats.get(pid))
        return result
    except Exception as e:
        logger.warning(f"Kategori haritası oluşturulamadı: {e}")
        return {}


async def full_sync():
    global _syncing
    if _syncing:
        logger.info("Ürün sync zaten çalışıyor, atlandı.")
        return
    _syncing = True
    logger.info("Ürün full sync başladı...")
    page, pagesize, count = 1, 100, 0
    db = SessionLocal()
    try:
        parent_map = await _build_parent_map()
        while True:
            r = await teamgram.get_products_all(page=page, pagesize=pagesize)
            products = r.get("products", [])
            if not products:
                break
            for p in products:
                _upsert(db, _product_to_dict(p, parent_map))
                count += 1
            db.commit()
            total = r.get("count", 0)
            if page * pagesize >= total:
                break
            page += 1
        logger.info(f"Ürün full sync tamamlandı: {count} ürün")
    except Exception as e:
        logger.error(f"Ürün full sync hatası: {e}")
        db.rollback()
    finally:
        _syncing = False
        db.close()


async def sync_one(tg_id: int):
    """Tek ürünü TG'den çekip DB'yi güncelle."""
    db = SessionLocal()
    try:
        parent_map = await _build_parent_map()
        p = await teamgram.get_product(tg_id)
        if p and p.get("Id"):
            _upsert(db, _product_to_dict(p, parent_map))
            db.commit()
    except Exception as e:
        logger.error(f"Tekil ürün sync hatası ({tg_id}): {e}")
        db.rollback()
    finally:
        db.close()


async def sync_parasut_match():
    """Paraşüt'teki tüm ürünleri çekip SKU üzerinden lokal products tablosuyla eşleştirir.
    Eşleşen ürünlere parasut_id yazar, eşleşmeyenleri temizler."""
    from app.services.parasut import get_all_products as get_parasut_products
    logger.info("Paraşüt ürün eşleştirme başladı...")
    try:
        parasut_products = await get_parasut_products()
    except Exception as e:
        logger.error(f"Paraşüt ürün listesi alınamadı: {e}")
        return

    # SKU → parasut_id haritası (boş kodları atla)
    sku_map = {p["code"]: p["id"] for p in parasut_products if p["code"]}
    logger.info(f"Paraşüt'te {len(sku_map)} stok kodlu ürün bulundu")

    db = SessionLocal()
    try:
        local_products = db.query(Product).all()
        updated = 0
        for lp in local_products:
            new_pid = sku_map.get(lp.sku) if lp.sku else None
            if lp.parasut_id != new_pid:
                lp.parasut_id = new_pid
                updated += 1
        db.commit()
        logger.info(f"Paraşüt eşleştirme tamamlandı: {updated} ürün güncellendi")
    except Exception as e:
        logger.error(f"Paraşüt eşleştirme DB hatası: {e}")
        db.rollback()
    finally:
        db.close()


async def start_background_sync():
    """Backend başlarken çağrılır. TG full sync + Paraşüt eşleştirme yapar, sonra döngüde tekrar çalışır."""
    await full_sync()
    await sync_parasut_match()

    elapsed_tg = 0
    elapsed_parasut = 0
    while True:
        sleep_interval = min(FULL_SYNC_INTERVAL, PARASUT_SYNC_INTERVAL)
        await asyncio.sleep(sleep_interval)
        elapsed_tg += sleep_interval
        elapsed_parasut += sleep_interval

        if elapsed_tg >= FULL_SYNC_INTERVAL:
            await full_sync()
            elapsed_tg = 0

        if elapsed_parasut >= PARASUT_SYNC_INTERVAL:
            await sync_parasut_match()
            elapsed_parasut = 0
