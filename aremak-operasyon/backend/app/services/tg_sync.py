"""TeamGram şirket senkronizasyon servisi.

- full_sync(): Tüm firmalar GetAll ile çekilir, DB'ye upsert edilir.
- incremental_sync(): GetUpdated ile son sync'ten bu yana değişenler güncellenir.
- start_background_sync(): Startup'ta full sync çalıştırır, sonra saatte 1 incremental.
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.teamgram_company import TeamgramCompany
from app.services import teamgram

logger = logging.getLogger(__name__)

_last_full_sync: Optional[datetime] = None
FULL_SYNC_INTERVAL = 24 * 3600   # 24 saat
INCREMENTAL_INTERVAL = 3600      # 1 saat


# TeamGram'ın döndürdüğü adres tipi adlarının tam listesi (Türkçe dahil)
_ADDRESS_TYPE_NAMES = {
    "Address", "address",
    "Adres", "adres",
    "İş", "iş", "Iş", "ış",   # Türkçe büyük/küçük harf varyantları
    "Work", "work",
    "Business", "business",
    "Ev", "ev",
    "Home", "home",
}


def _company_to_dict(c: dict) -> dict:
    contacts = c.get("Contactinfos", [])

    # Adres tipi kontaklarını bul — "Address", "İş", "Ev" vb. hepsini kabul et
    addr_contacts = [
        x for x in contacts
        if (x.get("ContactinfoType", {}).get("Name") or "") in _ADDRESS_TYPE_NAMES
    ]
    addr_with_value = [x for x in addr_contacts if x.get("Value")]
    if addr_with_value:
        address_info = sorted(addr_with_value, key=lambda x: x.get("ValuesOrder", 0), reverse=True)[0]
    else:
        address_info = addr_contacts[0] if addr_contacts else None

    # Adres değeri: Contactinfos'tan veya top-level Address alanından
    address_value = None
    if address_info and address_info.get("Value"):
        address_value = address_info["Value"]
    elif c.get("Address"):
        address_value = c["Address"]

    phone = next((x.get("Value") for x in contacts if x.get("ContactinfoType", {}).get("Name") == "Phone"), None)
    email = next((x.get("Value") for x in contacts if x.get("ContactinfoType", {}).get("Name") == "Email"), None)

    # City/district: önce top-level, sonra tüm adres kayıtlarından ilk bulduğu
    city = c.get("CityName")
    district = c.get("StateName")
    for x in addr_contacts:
        if not city:
            city = x.get("CityName")
        if not district:
            district = x.get("StateName")
        if city and district:
            break

    return {
        "tg_id": c["Id"],
        "name": c.get("Name"),
        "tax_no": (c.get("TaxNo") or "").strip() or None,
        "tax_office": c.get("TaxOffice") or None,
        "address": address_value,
        "city": city,
        "district": district,
        "phone": phone,
        "email": email,
    }


def _upsert(db: Session, company_data: dict):
    tg_id = company_data["tg_id"]
    obj = db.query(TeamgramCompany).filter(TeamgramCompany.tg_id == tg_id).first()
    if obj:
        for k, v in company_data.items():
            setattr(obj, k, v)
    else:
        obj = TeamgramCompany(**company_data)
        db.add(obj)


async def full_sync():
    global _last_full_sync
    logger.info("TeamGram full sync başladı...")
    page, pagesize, count = 1, 100, 0
    db = SessionLocal()
    try:
        while True:
            r = await teamgram._get(f"{teamgram.DOMAIN}/Companies/GetAll", {"page": page, "pagesize": pagesize})
            companies = r.get("companies", [])
            if not companies:
                break
            for c in companies:
                _upsert(db, _company_to_dict(c))
                count += 1
            db.commit()
            total = r.get("count", 0)
            if page * pagesize >= total:
                break
            page += 1
        _last_full_sync = datetime.now(timezone.utc)
        logger.info(f"TeamGram full sync tamamlandı: {count} firma")
    except Exception as e:
        logger.error(f"TeamGram full sync hatası: {e}")
        db.rollback()
    finally:
        db.close()


async def incremental_sync(since: Optional[datetime] = None):
    global _last_full_sync
    from_date = since or _last_full_sync
    if not from_date:
        await full_sync()
        return
    from_str = from_date.strftime("%Y-%m-%d")
    logger.info(f"TeamGram incremental sync: {from_str} tarihinden itibaren...")
    page, pagesize, count = 1, 100, 0
    db = SessionLocal()
    try:
        while True:
            r = await teamgram._get(
                f"{teamgram.DOMAIN}/Companies/GetUpdated",
                {"fromDate": from_str, "page": page, "pagesize": pagesize}
            )
            companies = r.get("companies", [])
            if not companies:
                break
            for c in companies:
                _upsert(db, _company_to_dict(c))
                count += 1
            db.commit()
            total = r.get("count", 0)
            if page * pagesize >= total:
                break
            page += 1
        _last_full_sync = datetime.now(timezone.utc)
        logger.info(f"TeamGram incremental sync tamamlandı: {count} firma güncellendi")
    except Exception as e:
        logger.error(f"TeamGram incremental sync hatası: {e}")
        db.rollback()
    finally:
        db.close()


async def start_background_sync():
    """Backend başlarken çağrılır. Full sync yapar, sonra döngüde incremental çalıştırır."""
    # İlk full sync
    db = SessionLocal()
    try:
        count = db.query(TeamgramCompany).count()
    finally:
        db.close()

    if count == 0:
        await full_sync()
    else:
        # DB dolu, incremental ile güncelle
        await incremental_sync()

    # Arkaplan döngüsü
    elapsed_since_full = 0
    while True:
        await asyncio.sleep(INCREMENTAL_INTERVAL)
        elapsed_since_full += INCREMENTAL_INTERVAL
        if elapsed_since_full >= FULL_SYNC_INTERVAL:
            await full_sync()
            elapsed_since_full = 0
        else:
            await incremental_sync()
