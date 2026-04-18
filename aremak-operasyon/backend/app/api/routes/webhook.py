from fastapi import APIRouter, Request
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/teamgram")
async def teamgram_webhook(request: Request):
    """
    TeamGram webhook receiver.
    TeamGram sends events here when records are created/updated.
    Configure at: TeamGram Control Panel > Web hooks
    URL: https://your-domain.com/api/webhook/teamgram
    """
    try:
        payload = await request.json()
        entity_type = payload.get("EntityType", "")
        event = payload.get("Event", "")
        entity_id = payload.get("Id")
        logger.info(f"Webhook: {entity_type} {event} id={entity_id}")
        # TODO: trigger cache invalidation or sync job based on entity type
    except Exception as e:
        logger.error(f"Webhook parse error: {e}")
    return {"ok": True}
