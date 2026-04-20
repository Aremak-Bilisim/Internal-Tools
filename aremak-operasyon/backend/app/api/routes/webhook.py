from fastapi import APIRouter, Request
from app.core.database import SessionLocal
from app.models.teamgram_company import TeamgramCompany
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


def _delete_tg_company(tg_id: int):
    db = SessionLocal()
    try:
        deleted = db.query(TeamgramCompany).filter(TeamgramCompany.tg_id == tg_id).delete()
        db.commit()
        if deleted:
            logger.info(f"TeamGram webhook: firma DB'den silindi tg_id={tg_id}")
    finally:
        db.close()


def _upsert_from_payload(data: dict):
    """Webhook payload'ındaki Data nesnesini doğrudan DB'ye yaz."""
    from app.services.tg_sync import _company_to_dict, _upsert
    db = SessionLocal()
    try:
        _upsert(db, _company_to_dict(data))
        db.commit()
        logger.info(f"TeamGram webhook: firma güncellendi tg_id={data.get('Id')}")
    finally:
        db.close()


@router.post("/teamgram")
async def teamgram_webhook(request: Request):
    """
    TeamGram web kancası.
    Payload yapısı:
      { "Data": { ...firma... }, "EventAction": "New"|"Update"|"Delete", "EventEntity": "Party" }
    """
    try:
        content_type = request.headers.get("content-type", "")
        if "json" in content_type:
            payload = await request.json()
        else:
            form = await request.form()
            payload = dict(form)

        logger.info(f"TeamGram webhook: EventAction={payload.get('EventAction')} EventEntity={payload.get('EventEntity')}")

        event_entity = str(payload.get("EventEntity") or "").lower()
        event_action = str(payload.get("EventAction") or "").lower()
        data = payload.get("Data") or {}
        tg_id = data.get("Id")

        if not tg_id:
            return {"ok": True}

        # Sadece şirket (Party) olaylarını işle
        if event_entity and event_entity != "party":
            logger.info(f"TeamGram webhook: şirket değil, atlandı (entity={event_entity})")
            return {"ok": True}

        if event_action == "delete":
            _delete_tg_company(tg_id)
        else:
            # New, Update veya bilinmeyen → Data'yı doğrudan upsert et
            _upsert_from_payload(data)

    except Exception as e:
        logger.error(f"TeamGram webhook hatası: {e}")

    return {"ok": True}
