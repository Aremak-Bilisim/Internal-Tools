from fastapi import APIRouter, Request
from sqlalchemy.orm import Session
from app.core.database import SessionLocal
from app.models.teamgram_company import TeamgramCompany
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


async def _sync_tg_company(tg_id: int):
    """Tek bir TeamGram firmasını DB'ye upsert eder."""
    from app.services import teamgram
    from app.services.tg_sync import _company_to_dict, _upsert
    try:
        c = await teamgram._get(f"{teamgram.DOMAIN}/Companies/Get", {"id": tg_id})
        if not c or not c.get("Id"):
            return
        db = SessionLocal()
        try:
            _upsert(db, _company_to_dict(c))
            db.commit()
            logger.info(f"TeamGram webhook: firma güncellendi tg_id={tg_id}")
        finally:
            db.close()
    except Exception as e:
        logger.error(f"TeamGram webhook sync hatası tg_id={tg_id}: {e}")


def _delete_tg_company(tg_id: int):
    db = SessionLocal()
    try:
        db.query(TeamgramCompany).filter(TeamgramCompany.tg_id == tg_id).delete()
        db.commit()
        logger.info(f"TeamGram webhook: firma silindi tg_id={tg_id}")
    finally:
        db.close()


@router.post("/teamgram")
async def teamgram_webhook(request: Request):
    """TeamGram web kancası.
    Eylem: Yeni / Güncelle → firmayı DB'ye upsert et
    Eylem: Sil → firmayı DB'den sil
    Nesne: Şirket (Company)
    URL: https://operasyon.aremak.com.tr/api/webhook/teamgram
    """
    try:
        # TeamGram webhook payload'ı form-data veya JSON gönderebilir
        content_type = request.headers.get("content-type", "")
        if "json" in content_type:
            payload = await request.json()
        else:
            form = await request.form()
            payload = dict(form)

        logger.info(f"TeamGram webhook payload: {payload}")

        # TeamGram'ın gönderdiği alanlar: EntityType, Event, Id, Url
        entity_type = str(payload.get("EntityType", "") or payload.get("entityType", "")).lower()
        event = str(payload.get("Event", "") or payload.get("event", "")).lower()
        tg_id_raw = payload.get("Id") or payload.get("id")

        if not tg_id_raw:
            return {"ok": True}

        tg_id = int(tg_id_raw)

        # Sadece şirket eventlerini işle
        if "compan" not in entity_type and "şirket" not in entity_type and entity_type not in ("company", "companies", ""):
            logger.info(f"TeamGram webhook: şirket değil, atlandı ({entity_type})")
            return {"ok": True}

        if "sil" in event or "delete" in event:
            _delete_tg_company(tg_id)
        else:
            # Yeni veya Güncelle
            await _sync_tg_company(tg_id)

    except Exception as e:
        logger.error(f"TeamGram webhook hatası: {e}")

    return {"ok": True}
