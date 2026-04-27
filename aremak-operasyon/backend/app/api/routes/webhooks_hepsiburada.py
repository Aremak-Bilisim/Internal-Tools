"""
Hepsiburada webhook endpoint'i.

Hepsiburada bizim API'mize Basic Auth ile POST ediyor.
Şu an: payload'i loglar + DB'ye kaydeder, 200 OK döndürür.
İleride: TG'de "Kazanılmış" fırsat yaratır.
"""
import json
import logging
import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models.hepsiburada_order import HepsiburadaOrder

logger = logging.getLogger(__name__)
router = APIRouter()

security = HTTPBasic()


def _verify_basic_auth(credentials: Annotated[HTTPBasicCredentials, Depends(security)]):
    """Basic Auth doğrulama — env'den HEPSIBURADA_WEBHOOK_USER/PASSWORD ile karşılaştır."""
    expected_user = settings.HEPSIBURADA_WEBHOOK_USER or ""
    expected_pass = settings.HEPSIBURADA_WEBHOOK_PASSWORD or ""
    if not expected_user or not expected_pass:
        # Henüz env set edilmediyse webhook devre dışı
        raise HTTPException(status_code=503, detail="Webhook configured değil")
    user_ok = secrets.compare_digest(credentials.username.encode(), expected_user.encode())
    pass_ok = secrets.compare_digest(credentials.password.encode(), expected_pass.encode())
    if not (user_ok and pass_ok):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username


@router.post("/order")
async def hepsiburada_order_webhook(
    request: Request,
    db: Session = Depends(get_db),
    _user: str = Depends(_verify_basic_auth),
):
    """
    Hepsiburada → POST: yeni sipariş bildirimi.
    Hepsiburada'nın gönderdiği payload format'ı henüz test edilmedi — gelen veriyi olduğu gibi saklıyoruz.
    Test ortamından sipariş geldiğinde format'a göre TG fırsat yaratma kısmı eklenecek.
    """
    try:
        body = await request.body()
        try:
            payload = json.loads(body) if body else {}
        except json.JSONDecodeError:
            payload = {"_raw": body.decode("utf-8", errors="replace")}
    except Exception as e:
        logger.warning(f"Hepsiburada webhook body okunamadı: {e}")
        raise HTTPException(400, "Invalid body")

    logger.info(f"Hepsiburada webhook payload: {json.dumps(payload, ensure_ascii=False)[:500]}")

    # Heuristik: external_order_id'yi bilinen yaygın anahtarlardan dene
    external_id = (
        payload.get("orderId")
        or payload.get("OrderId")
        or payload.get("orderNumber")
        or payload.get("OrderNumber")
        or payload.get("id")
        or "unknown"
    )
    order_number = payload.get("orderNumber") or payload.get("OrderNumber") or None
    event_type = payload.get("eventType") or payload.get("EventType") or payload.get("event") or "OrderEvent"

    # Idempotent kayıt — aynı (external_id, event_type) tekrar gelirse upsert
    existing = db.query(HepsiburadaOrder).filter(
        HepsiburadaOrder.external_order_id == str(external_id),
        HepsiburadaOrder.event_type == event_type,
    ).first()
    if existing:
        # Sadece raw'ı güncelle (Hepsiburada retry yapıyorsa)
        existing.raw_payload = json.dumps(payload, ensure_ascii=False)
        db.commit()
        return {"status": "ok", "duplicate": True, "id": existing.id}

    rec = HepsiburadaOrder(
        external_order_id=str(external_id),
        order_number=str(order_number) if order_number else None,
        event_type=event_type,
        raw_payload=json.dumps(payload, ensure_ascii=False),
        processed=False,
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)

    # TODO: TG fırsat yaratma — payload formatı netleştiğinde eklenecek
    # await create_tg_opportunity_from_hepsiburada(payload)

    return {"status": "ok", "id": rec.id}


@router.get("/health")
def hepsiburada_health():
    """Hepsiburada test ortamı için health check (auth gerektirmez)."""
    return {"status": "ok", "service": "hepsiburada-webhook"}
