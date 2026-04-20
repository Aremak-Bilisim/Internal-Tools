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


async def _sync_or_delete(tg_id: int):
    """
    Companies/Get ile firmayı kontrol et:
    - Varsa → DB'ye upsert et
    - Yoksa → DB'den sil
    """
    from app.services import teamgram
    from app.services.tg_sync import _company_to_dict, _upsert
    try:
        c = await teamgram._get(f"{teamgram.DOMAIN}/Companies/Get", {"id": tg_id})
        if c and c.get("Id"):
            db = SessionLocal()
            try:
                _upsert(db, _company_to_dict(c))
                db.commit()
                logger.info(f"TeamGram webhook: firma güncellendi tg_id={tg_id}")
            finally:
                db.close()
        else:
            _delete_tg_company(tg_id)
    except Exception as e:
        logger.error(f"TeamGram webhook sync hatası tg_id={tg_id}: {e}")


@router.post("/teamgram")
async def teamgram_webhook(request: Request):
    """TeamGram web kancası — Yeni/Güncelle/Sil olaylarını işler."""
    try:
        content_type = request.headers.get("content-type", "")
        if "json" in content_type:
            payload = await request.json()
        else:
            form = await request.form()
            payload = dict(form)

        logger.info(f"TeamGram webhook payload: {payload}")

        tg_id_raw = payload.get("Id") or payload.get("id")
        if not tg_id_raw:
            return {"ok": True}

        tg_id = int(tg_id_raw)

        # Entity type kontrolü — sadece şirket olaylarını işle
        entity_type = str(
            payload.get("EntityType") or payload.get("entityType") or ""
        ).lower()

        if entity_type and "compan" not in entity_type and "şirket" not in entity_type:
            logger.info(f"TeamGram webhook: şirket değil, atlandı (entity_type={entity_type})")
            return {"ok": True}

        # Event tipinden bağımsız: Companies/Get ile doğrula, sonuca göre upsert/sil
        await _sync_or_delete(tg_id)

    except Exception as e:
        logger.error(f"TeamGram webhook hatası: {e}")

    return {"ok": True}
