from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel
from app.core.database import get_db
from app.core.auth import get_current_user, require_role
from app.models.shipment import ShipmentRequest, ShipmentHistory

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
    s = ShipmentRequest(
        tg_order_id=data.tg_order_id,
        tg_order_name=data.tg_order_name,
        customer_name=data.customer_name,
        delivery_type=data.delivery_type,
        cargo_company=data.cargo_company,
        delivery_address=data.delivery_address,
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
    return _shipment_to_dict(s)


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
