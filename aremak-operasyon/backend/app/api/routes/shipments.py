import asyncio
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel
from app.core.database import get_db
from app.core.auth import get_current_user, require_role
from app.models.shipment import ShipmentRequest, ShipmentHistory
from app.models.user import User
from app.services import email as email_svc
from app.services import teamgram
from app.services import parasut

logger = logging.getLogger(__name__)

router = APIRouter()

STAGE_TRANSITIONS = {
    "draft":                    {"next": "pending_admin",           "roles": ["admin", "sales"]},
    "pending_admin":            {"next": "preparing",               "roles": ["admin"]},
    "preparing":                {"next": "pending_waybill_approval","roles": ["warehouse"]},
    "pending_waybill_approval": {"next": "ready_to_ship",           "roles": ["admin"]},
    "ready_to_ship":            {"next": "shipped",                 "roles": ["warehouse"]},
}

STAGE_LABELS = {
    "draft":                    "Taslak",
    "pending_admin":            "Admin Onayı Bekleniyor",
    "preparing":                "Hazırlanıyor",
    "pending_waybill_approval": "İrsaliye Onayı Bekleniyor",
    "ready_to_ship":            "Sevke Hazır",
    "shipped":                  "Sevk Edildi",
}


class ShipmentCreate(BaseModel):
    tg_order_id: Optional[int] = None
    tg_order_name: Optional[str] = None
    customer_name: str
    delivery_type: Optional[str] = None     # Ofis Teslim | Kargo
    cargo_company: Optional[str] = None
    delivery_address: Optional[str] = None
    delivery_district: Optional[str] = None
    delivery_city: Optional[str] = None
    delivery_zip: Optional[str] = None
    notes: Optional[str] = None
    invoice_url: Optional[str] = None
    invoice_no: Optional[str] = None
    invoice_note: Optional[str] = None
    waybill_note: Optional[str] = None
    recipient_name: Optional[str] = None
    recipient_phone: Optional[str] = None
    planned_ship_date: Optional[str] = None
    shipping_doc_type: Optional[str] = None
    items: list = []
    assigned_to_id: Optional[int] = None


class StageAdvance(BaseModel):
    note: Optional[str] = None
    cargo_tracking_no: Optional[str] = None
    cargo_photo_urls: Optional[list] = None


def _shipment_to_dict(s: ShipmentRequest) -> dict:
    return {
        "id": s.id,
        "tg_order_id": s.tg_order_id,
        "tg_order_name": s.tg_order_name,
        "customer_name": s.customer_name,
        "delivery_type": s.delivery_type,
        "cargo_company": s.cargo_company,
        "delivery_address": s.delivery_address,
        "delivery_district": s.delivery_district,
        "delivery_city": s.delivery_city,
        "delivery_zip": s.delivery_zip,
        "notes": s.notes,
        "invoice_url": s.invoice_url,
        "invoice_no": s.invoice_no,
        "invoice_note": s.invoice_note,
        "waybill_note": s.waybill_note,
        "recipient_name": s.recipient_name,
        "recipient_phone": s.recipient_phone,
        "planned_ship_date": s.planned_ship_date,
        "shipping_doc_type": s.shipping_doc_type,
        "items": s.items or [],
        "stage": s.stage,
        "stage_label": STAGE_LABELS.get(s.stage, s.stage),
        "created_by": {"id": s.created_by.id, "name": s.created_by.name} if s.created_by else None,
        "assigned_to": {"id": s.assigned_to.id, "name": s.assigned_to.name} if s.assigned_to else None,
        "cargo_photo_urls": s.cargo_photo_urls or [],
        "cargo_tracking_no": s.cargo_tracking_no,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


@router.get("")
def list_shipments(
    stage: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    q = db.query(ShipmentRequest)
    if stage:
        q = q.filter(ShipmentRequest.stage == stage)
    # Sales users only see their own shipments
    if current_user.role == "sales":
        q = q.filter(ShipmentRequest.created_by_id == current_user.id)
    shipments = q.order_by(ShipmentRequest.created_at.desc()).all()
    return [_shipment_to_dict(s) for s in shipments]


@router.post("")
def create_shipment(
    data: ShipmentCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin", "sales")),
):
    import datetime as _dt
    with open("debug_shipment.log", "a", encoding="utf-8") as _f:
        _f.write(
            f"[{_dt.datetime.now()}] create_shipment: "
            f"addr={data.delivery_address!r} "
            f"district={data.delivery_district!r} "
            f"city={data.delivery_city!r} "
            f"zip={data.delivery_zip!r} "
            f"doc_type={data.shipping_doc_type!r}\n"
        )
    s = ShipmentRequest(
        tg_order_id=data.tg_order_id,
        tg_order_name=data.tg_order_name,
        customer_name=data.customer_name,
        delivery_type=data.delivery_type,
        cargo_company=data.cargo_company,
        delivery_address=data.delivery_address,
        delivery_district=data.delivery_district,
        delivery_city=data.delivery_city,
        delivery_zip=data.delivery_zip,
        notes=data.notes,
        invoice_url=data.invoice_url,
        invoice_no=data.invoice_no,
        invoice_note=data.invoice_note,
        waybill_note=data.waybill_note,
        recipient_name=data.recipient_name,
        recipient_phone=data.recipient_phone,
        planned_ship_date=data.planned_ship_date,
        shipping_doc_type=data.shipping_doc_type,
        items=data.items,
        assigned_to_id=data.assigned_to_id,
        created_by_id=current_user.id,
        stage="draft",
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    result = _shipment_to_dict(s)

    # Post-creation side effects — hataları topla, response'a ekle
    warnings = _post_create_effects(db, result, data.tg_order_id)
    result["warnings"] = warnings

    return result


def _post_create_effects(db: Session, shipment: dict, tg_order_id: Optional[int]) -> list:
    """Email notification + TeamGram update + Paraşüt irsaliye after shipment creation.
    Returns list of warning strings for any non-fatal failures."""
    warnings = []

    # 1. Send email to all warehouse users
    warehouse_users = db.query(User).filter(User.role == "warehouse", User.is_active == True).all()
    for u in warehouse_users:
        try:
            email_svc.send_shipment_notification(shipment, u.email, u.name)
        except Exception as e:
            logger.error(f"Email to {u.email} failed: {e}")

    # 2. Update TeamGram order: Status=1 (Tamamlandı), stage=Hazırlanıyor
    if tg_order_id:
        try:
            asyncio.run(teamgram.update_order_status(tg_order_id, status=1, stage_name="Hazırlanıyor"))
        except Exception as e:
            logger.error(f"TeamGram status update failed: {e}")

    # 3. Paraşüt irsaliye — only when shipping_doc_type includes İrsaliye
    doc_type = shipment.get("shipping_doc_type") or ""
    invoice_url = shipment.get("invoice_url") or ""
    if "İrsaliye" in doc_type:
        if not invoice_url:
            msg = "Gönderim belgesi İrsaliye seçildi ancak bu siparişe eşleşen Paraşüt faturası bulunamadı. İrsaliye oluşturulamadı."
            logger.warning(msg)
            warnings.append(msg)
        else:
            invoice_id = invoice_url.rstrip("/").split("/")[-1]
            planned_date = shipment.get("planned_ship_date") or None
            addr = shipment.get("delivery_address")
            dist = shipment.get("delivery_district")
            city = shipment.get("delivery_city")
            zipp = shipment.get("delivery_zip")
            dlv_type = shipment.get("delivery_type")
            cargo_co = shipment.get("cargo_company")
            import datetime as _dt2
            with open("debug_shipment.log", "a", encoding="utf-8") as _f2:
                _f2.write(
                    f"[{_dt2.datetime.now()}] irsaliye_params: "
                    f"invoice={invoice_id} date={planned_date} "
                    f"addr={addr!r} dist={dist!r} city={city!r} zip={zipp!r} "
                    f"delivery_type={dlv_type!r} cargo_company={cargo_co!r}\n"
                )
            try:
                asyncio.run(parasut.create_irsaliye_from_invoice(
                    invoice_id,
                    issue_date=planned_date,
                    delivery_address=addr,
                    delivery_district=dist,
                    delivery_city=city,
                    delivery_zip=zipp,
                    delivery_type=dlv_type,
                    cargo_company=cargo_co,
                ))
                logger.info(f"İrsaliye created for invoice {invoice_id}")
            except Exception as e:
                msg = f"Paraşüt'te irsaliye oluşturulamadı: {e}"
                logger.error(f"Paraşüt irsaliye failed for invoice {invoice_id}: {e}")
                warnings.append(msg)

    return warnings


@router.get("/{shipment_id}")
def get_shipment(shipment_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    s = db.query(ShipmentRequest).filter(ShipmentRequest.id == shipment_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Sevk talebi bulunamadı")
    result = _shipment_to_dict(s)
    result["history"] = [
        {
            "stage_from": h.stage_from,
            "stage_to": h.stage_to,
            "note": h.note,
            "user": h.user.name if h.user else None,
            "created_at": h.created_at.isoformat() if h.created_at else None,
        }
        for h in s.history
    ]
    return result


@router.post("/{shipment_id}/advance")
def advance_stage(
    shipment_id: int,
    data: StageAdvance,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    s = db.query(ShipmentRequest).filter(ShipmentRequest.id == shipment_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Sevk talebi bulunamadı")

    transition = STAGE_TRANSITIONS.get(s.stage)
    if not transition:
        raise HTTPException(status_code=400, detail="Bu talep zaten tamamlandı")

    if current_user.role not in transition["roles"]:
        raise HTTPException(status_code=403, detail=f"Bu aşamayı geçmek için yetkiniz yok")

    old_stage = s.stage
    s.stage = transition["next"]

    if data.cargo_tracking_no:
        s.cargo_tracking_no = data.cargo_tracking_no
    if data.cargo_photo_urls:
        s.cargo_photo_urls = (s.cargo_photo_urls or []) + data.cargo_photo_urls

    history = ShipmentHistory(
        shipment_id=s.id,
        stage_from=old_stage,
        stage_to=s.stage,
        note=data.note,
        user_id=current_user.id,
    )
    db.add(history)
    db.commit()
    db.refresh(s)
    return _shipment_to_dict(s)


@router.delete("/{shipment_id}/invoice")
def delete_shipment_invoice(
    shipment_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin", "sales")),
):
    s = db.query(ShipmentRequest).filter(ShipmentRequest.id == shipment_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Sevk talebi bulunamadı")

    invoice_url = s.invoice_url or ""
    invoice_id = invoice_url.rstrip("/").split("/")[-1] if invoice_url else None
    tg_order_id = s.tg_order_id

    # Clear invoice fields on shipment
    s.invoice_url = None
    s.invoice_no = None
    s.invoice_note = None
    db.commit()

    # Non-blocking: delete from Paraşüt + clear TeamGram HasInvoice + refresh cache
    if invoice_id and invoice_id.isdigit():
        try:
            asyncio.run(parasut.delete_invoice(invoice_id))
        except Exception as e:
            logger.warning(f"Paraşüt invoice delete failed for {invoice_id}: {e}")
    try:
        asyncio.run(parasut.invalidate_cache())
    except Exception:
        pass
    if tg_order_id:
        try:
            asyncio.run(teamgram.clear_order_has_invoice(tg_order_id))
        except Exception as e:
            logger.warning(f"TeamGram HasInvoice clear failed for order {tg_order_id}: {e}")

    db.refresh(s)
    return _shipment_to_dict(s)


@router.post("/{shipment_id}/reject")
def reject_shipment(
    shipment_id: int,
    data: StageAdvance,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin")),
):
    s = db.query(ShipmentRequest).filter(ShipmentRequest.id == shipment_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Sevk talebi bulunamadı")

    old_stage = s.stage
    s.stage = "draft"

    history = ShipmentHistory(
        shipment_id=s.id,
        stage_from=old_stage,
        stage_to="draft",
        note=f"[RED] {data.note or 'Reddedildi'}",
        user_id=current_user.id,
    )
    db.add(history)
    db.commit()
    db.refresh(s)
    return _shipment_to_dict(s)
