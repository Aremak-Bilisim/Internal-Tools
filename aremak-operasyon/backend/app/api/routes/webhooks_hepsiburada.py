"""
Hepsiburada webhook endpoint'i.

Tek URL altında 4 event tipi gelir (HB tarafında kayıtlı):
  - CreateOrder, Cancel, Deliver, ClaimsPackages

HB POST atar; biz idempotent kaydederiz, event'e göre dispatch ederiz, hep 200 döneriz.
"""
import json
import logging
import secrets
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models.hepsiburada_order import HepsiburadaOrder
from app.models.shipment import ShipmentRequest, ShipmentHistory
from app.models.user import User
from app.models.notification import Notification

logger = logging.getLogger(__name__)
router = APIRouter()

security = HTTPBasic()


def _verify_basic_auth(credentials: Annotated[HTTPBasicCredentials, Depends(security)]):
    expected_user = settings.HEPSIBURADA_WEBHOOK_USER or ""
    expected_pass = settings.HEPSIBURADA_WEBHOOK_PASSWORD or ""
    if not expected_user or not expected_pass:
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


def _detect_event_type(payload: dict) -> str:
    """Payload yapısından event tipini çıkarır. HB tek URL'e farklı event'ler atıyor."""
    # Önce explicit alanlara bak
    for k in ("eventType", "EventType", "event", "type"):
        if payload.get(k):
            return str(payload[k])
    # Heuristik: payload yapısına göre
    if "items" in payload and isinstance(payload["items"], list):
        return "CreateOrder"
    if "cancelDate" in payload or "cancelReasonCode" in payload or "cancelledBy" in payload:
        return "Cancel"
    if "receivedDate" in payload or "receivedBy" in payload:
        return "Deliver"
    if "shippedDate" in payload or "trackingInfoCode" in payload:
        return "Intransit"
    if "undeliveredDate" in payload or "undeliveredReason" in payload:
        return "Undeliver"
    if "claim" in str(payload).lower() or "iadeId" in payload or "claimId" in payload:
        return "ClaimsPackages"
    return "Unknown"


def _extract_order_numbers(payload: dict) -> list[str]:
    """Payload'dan sipariş numaralarını çıkarır (CreateOrder items[].orderNumber)."""
    nums: list[str] = []
    for it in payload.get("items") or []:
        on = it.get("orderNumber") or it.get("OrderNumber")
        if on and str(on) not in nums:
            nums.append(str(on))
    # Tekil event'lerde orderNumber doğrudan da gelebilir
    on = payload.get("orderNumber") or payload.get("OrderNumber")
    if on and str(on) not in nums:
        nums.append(str(on))
    return nums


def _save_payload(db: Session, external_id: str, order_number: Optional[str], event_type: str, payload: dict) -> HepsiburadaOrder:
    """Idempotent: aynı (external_id, event_type) tekrarsa upsert."""
    existing = db.query(HepsiburadaOrder).filter(
        HepsiburadaOrder.external_order_id == str(external_id),
        HepsiburadaOrder.event_type == event_type,
    ).first()
    raw = json.dumps(payload, ensure_ascii=False)
    if existing:
        existing.raw_payload = raw
        db.commit()
        return existing
    rec = HepsiburadaOrder(
        external_order_id=str(external_id),
        order_number=str(order_number) if order_number else None,
        event_type=event_type,
        raw_payload=raw,
        processed=False,
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


def _notify_admins(db: Session, title: str, message: str):
    try:
        admins = db.query(User).filter(User.role == "admin", User.is_active == True).all()
        sales_users = db.query(User).filter(User.role == "sales", User.is_active == True).all()
        for u in admins + sales_users:
            db.add(Notification(user_id=u.id, title=title, message=message))
        db.commit()
    except Exception as e:
        logger.error(f"HB webhook bildirim hatası: {e}")


def _handle_create_order(db: Session, payload: dict):
    """Yeni HB siparişi: kayıtla + admin/sales'e bildirim. Otomatik sevk yaratma yok
    (kullanıcı manuel olarak 'Hepsiburada Sevki Oluştur' wizard'ından devam edecek).
    """
    order_numbers = _extract_order_numbers(payload)
    if not order_numbers:
        logger.warning(f"HB CreateOrder: orderNumber çıkarılamadı, payload: {json.dumps(payload, ensure_ascii=False)[:300]}")
        return
    for on in order_numbers:
        msg = f"Hepsiburada sipariş {on} geldi. Sevkiyatlar > 'Hepsiburada Sevki Oluştur' ile devam edin."
        _notify_admins(db, f"Yeni HB Siparişi: {on}", msg)


def _handle_cancel(db: Session, payload: dict):
    """HB iptal: lokal Shipment'i bul, henüz sevk edilmediyse iptal_edildi'ye al."""
    on = payload.get("orderNumber") or payload.get("OrderNumber")
    if not on:
        return
    pattern = f"%Hepsiburada%{on}%"
    s = db.query(ShipmentRequest).filter(
        ShipmentRequest.tg_order_name.like(pattern),
        ~ShipmentRequest.stage.in_(("shipped", "iptal_edildi")),
    ).first()
    if not s:
        logger.info(f"HB Cancel {on}: ilgili lokal Shipment bulunamadı (henüz oluşturulmamış olabilir)")
        return
    old = s.stage
    s.stage = "iptal_edildi"
    db.add(ShipmentHistory(
        shipment_id=s.id, stage_from=old, stage_to="iptal_edildi",
        note=f"[HB-WEBHOOK] İptal — sebep: {payload.get('cancelReasonCode') or payload.get('cancelledBy') or 'belirtilmemiş'}",
        user_id=None,
    ))
    db.commit()
    _notify_admins(db, f"HB İptal: {on}", f"Sevk talebi #{s.id} iptal edildi.")


def _handle_deliver(db: Session, payload: dict):
    """HB teslim: lokal Shipment varsa stage'i shipped'e çek (idempotent)."""
    on = payload.get("orderNumber") or payload.get("OrderNumber") or payload.get("packageNumber")
    if not on:
        return
    s = db.query(ShipmentRequest).filter(
        ShipmentRequest.tg_order_name.like(f"%Hepsiburada%{on}%"),
    ).first()
    if not s:
        logger.info(f"HB Deliver {on}: ilgili lokal Shipment bulunamadı")
        return
    if s.stage == "shipped":
        return  # idempotent
    old = s.stage
    s.stage = "shipped"
    db.add(ShipmentHistory(
        shipment_id=s.id, stage_from=old, stage_to="shipped",
        note=f"[HB-WEBHOOK] Teslim edildi — receivedBy: {payload.get('receivedBy') or '-'}",
        user_id=None,
    ))
    db.commit()


@router.post("/order")
async def hepsiburada_order_webhook(
    request: Request,
    db: Session = Depends(get_db),
    _user: str = Depends(_verify_basic_auth),
):
    """Tek URL altında tüm HB event'leri (CreateOrder, Cancel, Deliver, ClaimsPackages).
    Daima 200 döner (HB retry etmesin); işleme hatası logger'a yazılır."""
    try:
        body = await request.body()
        try:
            payload = json.loads(body) if body else {}
        except json.JSONDecodeError:
            payload = {"_raw": body.decode("utf-8", errors="replace")}
    except Exception as e:
        logger.warning(f"HB webhook body okunamadı: {e}")
        # 400 dönmek yerine 200 dönüp logla — HB retry zorlamasın
        return {"status": "error", "detail": "body parse failed"}

    event_type = _detect_event_type(payload)
    # Külli external_id seçimi
    order_numbers = _extract_order_numbers(payload)
    primary_on = order_numbers[0] if order_numbers else None
    external_id = (
        payload.get("orderId") or payload.get("OrderId")
        or primary_on
        or payload.get("packageNumber") or payload.get("id")
        or "unknown"
    )

    logger.info(f"HB webhook event={event_type} order_number={primary_on} payload_size={len(body)}b")
    rec = _save_payload(db, str(external_id), primary_on, event_type, payload)

    # Dispatch
    try:
        if event_type == "CreateOrder":
            _handle_create_order(db, payload)
        elif event_type == "Cancel":
            _handle_cancel(db, payload)
        elif event_type == "Deliver":
            _handle_deliver(db, payload)
        # ClaimsPackages, Intransit, Undeliver vs: şimdilik sadece kayıt
        rec.processed = True
        db.commit()
    except Exception as e:
        logger.exception(f"HB webhook dispatch hatası ({event_type}): {e}")
        rec.error = str(e)[:500]
        db.commit()

    return {"status": "ok", "event": event_type, "id": rec.id}


@router.get("/health")
def hepsiburada_health():
    """HB test ortamı için health check (auth gerektirmez)."""
    return {"status": "ok", "service": "hepsiburada-webhook"}
