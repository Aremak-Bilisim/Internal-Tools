import asyncio
import logging
import os
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import BaseModel
from app.core.database import get_db
from app.core.auth import get_current_user, require_role
from app.models.shipment import ShipmentRequest, ShipmentHistory
from app.models.user import User
from app.models.notification import Notification
from app.services import email as email_svc
from app.services import teamgram
from app.services import parasut

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "..", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

logger = logging.getLogger(__name__)

router = APIRouter()

STAGE_TRANSITIONS = {
    "pending_admin":              {"next": "parasut_review",            "roles": ["admin"]},
    "parasut_review":             {"next": "pending_parasut_approval",  "roles": ["warehouse"]},
    "pending_parasut_approval":   {"next": "preparing",                 "roles": ["admin"]},
    "preparing":                  {"next": "shipped",                   "roles": ["warehouse"]},
    "revizyon_bekleniyor":        {"next": "pending_admin",             "roles": ["sales", "admin"]},
}

STAGE_LABELS = {
    "pending_admin":              "Yönetici Onayı Bekleniyor",
    "parasut_review":             "Paraşüt Kontrolü Yapılıyor",
    "pending_parasut_approval":   "Paraşüt Onayı Bekleniyor",
    "preparing":                  "Sevk İçin Hazırlanıyor",
    "shipped":                    "Sevk Edildi",
    "revizyon_bekleniyor":        "Revizyon Bekleniyor",
    "iptal_edildi":               "İptal Edildi",
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
        "irsaliye_id": s.irsaliye_id,
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
        "cargo_pdf_url": s.cargo_pdf_url,
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
        stage="pending_admin",
    )
    db.add(s)
    db.commit()
    db.refresh(s)

    # Creation history entry
    creation_note = data.notes or ""
    history = ShipmentHistory(
        shipment_id=s.id,
        stage_from=None,
        stage_to="pending_admin",
        note=f"[CREATED] {creation_note}".strip(),
        user_id=current_user.id,
    )
    db.add(history)
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

    # 1. Notify admins (shipment created directly as pending_admin)
    admins = db.query(User).filter(User.role == "admin", User.is_active == True).all()
    admin_list = [(email_svc._notif_email(u), u.name) for u in admins]
    try:
        email_svc.send_pending_admin(shipment, admin_list, note=shipment.get("notes") or "")
    except Exception as e:
        logger.error(f"Admin email failed: {e}")
    try:
        order_name = shipment.get("tg_order_name") or shipment.get("customer_name")
        for u in admins:
            db.add(Notification(user_id=u.id, title=f"Yeni Sevk Talebi: {order_name}",
                                message=shipment.get("notes") or "Onayınızı bekliyor.",
                                shipment_id=shipment.get("id")))
        db.commit()
    except Exception as e:
        logger.error(f"Admin in-app notification failed: {e}")

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
                result = asyncio.run(parasut.create_irsaliye_from_invoice(
                    invoice_id,
                    issue_date=planned_date,
                    delivery_address=addr,
                    delivery_district=dist,
                    delivery_city=city,
                    delivery_zip=zipp,
                    delivery_type=dlv_type,
                    cargo_company=cargo_co,
                ))
                irsaliye_id = result.get("data", {}).get("id")
                if irsaliye_id:
                    db.query(ShipmentRequest).filter(
                        ShipmentRequest.id == shipment["id"]
                    ).update({"irsaliye_id": irsaliye_id})
                    db.commit()
                logger.info(f"İrsaliye created for invoice {invoice_id}: {irsaliye_id}")
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
    history_list = [
        {
            "stage_from": h.stage_from,
            "stage_to": h.stage_to,
            "note": h.note,
            "user": h.user.name if h.user else None,
            "created_at": h.created_at.isoformat() if h.created_at else None,
        }
        for h in s.history
    ]
    result["history"] = history_list
    # Son revizyon notunu ayrıca ekle (frontend'de banner için)
    revision_entry = next(
        (h for h in reversed(s.history) if h.stage_to == "revizyon_bekleniyor"),
        None,
    )
    result["revision_note"] = (
        revision_entry.note.replace("[REVIZYON]", "").strip() if revision_entry else None
    )
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
    new_stage = transition["next"]
    s.stage = new_stage

    if data.cargo_tracking_no:
        s.cargo_tracking_no = data.cargo_tracking_no
    if data.cargo_photo_urls:
        s.cargo_photo_urls = (s.cargo_photo_urls or []) + data.cargo_photo_urls

    history = ShipmentHistory(
        shipment_id=s.id,
        stage_from=old_stage,
        stage_to=new_stage,
        note=data.note,
        user_id=current_user.id,
    )
    db.add(history)
    db.commit()
    db.refresh(s)

    # Email + in-app notifications
    shipment_dict = _shipment_to_dict(s)
    admins = db.query(User).filter(User.role == "admin", User.is_active == True).all()
    warehouse_users = db.query(User).filter(User.role == "warehouse", User.is_active == True).all()
    sales_users = db.query(User).filter(User.role == "sales", User.is_active == True).all()

    admin_list = [(email_svc._notif_email(u), u.name) for u in admins]
    warehouse_list = [(email_svc._notif_email(u), u.name) for u in warehouse_users]
    sales_list = [(email_svc._notif_email(u), u.name) for u in sales_users]

    order_name = s.tg_order_name or s.customer_name
    note = data.note or ""

    def _create_notifs(users, title, message):
        try:
            for u in users:
                db.add(Notification(user_id=u.id, title=title, message=message, shipment_id=s.id))
            db.commit()
        except Exception as e:
            logger.error(f"In-app notification failed: {e}")

    if new_stage == "pending_admin":
        try:
            email_svc.send_pending_admin(shipment_dict, admin_list, note)
        except Exception as e:
            logger.error(f"Email failed ({new_stage}): {e}")
        if old_stage == "revizyon_bekleniyor":
            _create_notifs(admins, f"Revize Edildi — Onay Bekliyor: {order_name}", f"{current_user.name} revizyonu tamamladı. {note}".strip())
        else:
            _create_notifs(admins, f"Yeni Sevk Talebi: {order_name}", note or "Onayınızı bekliyor.")
    elif new_stage == "parasut_review":
        try:
            email_svc.send_approved_to_warehouse(shipment_dict, warehouse_list, note, actor_name=current_user.name)
        except Exception as e:
            logger.error(f"Email failed ({new_stage}): {e}")
        _create_notifs(warehouse_users, f"Paraşüt Kontrolü: {order_name}", f"{current_user.name} onayladı. {note}".strip())
    elif new_stage == "pending_parasut_approval":
        try:
            email_svc.send_waybill_approval_request(shipment_dict, admin_list, note, actor_name=current_user.name)
        except Exception as e:
            logger.error(f"Email failed ({new_stage}): {e}")
        _create_notifs(admins, f"Paraşüt Belgesi Onayı: {order_name}", f"{current_user.name} kontrolü tamamladı. {note}".strip())
    elif new_stage == "preparing":
        try:
            email_svc.send_ready_to_ship(shipment_dict, warehouse_list, note, actor_name=current_user.name)
        except Exception as e:
            logger.error(f"Email failed ({new_stage}): {e}")
        _create_notifs(warehouse_users, f"Sevke Hazırla: {order_name}", f"{current_user.name} Paraşüt'ü onayladı. {note}".strip())
    elif new_stage == "shipped":
        try:
            email_svc.send_shipped(shipment_dict, admin_list, sales_list, note)
        except Exception as e:
            logger.error(f"Email failed ({new_stage}): {e}")
        _create_notifs(admins + sales_users, f"Sevk Edildi: {order_name}", note or "Ürün sevk edildi.")

    # TeamGram sync: sevk edilince sipariş aşamasını güncelle
    if new_stage == "shipped" and s.tg_order_id:
        try:
            asyncio.run(teamgram.update_order_status(s.tg_order_id, status=1, stage_name="Sevk edildi"))
        except Exception as e:
            logger.warning(f"TeamGram status update failed for order {s.tg_order_id}: {e}")

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


@router.post("/{shipment_id}/upload/cargo-pdf")
def upload_cargo_pdf(
    shipment_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_role("warehouse", "admin")),
):
    s = db.query(ShipmentRequest).filter(ShipmentRequest.id == shipment_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Sevk talebi bulunamadı")
    ext = os.path.splitext(file.filename or "")[1] or ".pdf"
    filename = f"cargo_pdf_{shipment_id}_{uuid.uuid4().hex[:8]}{ext}"
    path = os.path.join(UPLOAD_DIR, filename)
    with open(path, "wb") as f:
        f.write(file.file.read())
    s.cargo_pdf_url = f"/uploads/{filename}"
    db.commit()
    db.refresh(s)
    return _shipment_to_dict(s)


@router.post("/{shipment_id}/upload/cargo-photos")
def upload_cargo_photos(
    shipment_id: int,
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_role("warehouse", "admin")),
):
    s = db.query(ShipmentRequest).filter(ShipmentRequest.id == shipment_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Sevk talebi bulunamadı")
    urls = list(s.cargo_photo_urls or [])
    for file in files:
        ext = os.path.splitext(file.filename or "")[1] or ".jpg"
        filename = f"cargo_photo_{shipment_id}_{uuid.uuid4().hex[:8]}{ext}"
        path = os.path.join(UPLOAD_DIR, filename)
        with open(path, "wb") as f:
            f.write(file.file.read())
        urls.append(f"/uploads/{filename}")
    s.cargo_photo_urls = urls
    db.commit()
    db.refresh(s)
    return _shipment_to_dict(s)


@router.put("/{shipment_id}")
def update_shipment(
    shipment_id: int,
    data: ShipmentCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin", "sales")),
):
    """Revizyon aşamasında talebi güncelle."""
    s = db.query(ShipmentRequest).filter(ShipmentRequest.id == shipment_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Sevk talebi bulunamadı")
    if s.stage not in ("draft", "revizyon_bekleniyor"):
        raise HTTPException(status_code=400, detail="Bu aşamada talep güncellenemez")
    if current_user.role == "sales" and s.created_by_id != current_user.id:
        raise HTTPException(status_code=403, detail="Yalnızca kendi talebinizi güncelleyebilirsiniz")

    s.delivery_type = data.delivery_type
    s.cargo_company = data.cargo_company
    s.delivery_address = data.delivery_address
    s.delivery_district = data.delivery_district
    s.delivery_city = data.delivery_city
    s.delivery_zip = data.delivery_zip
    s.recipient_name = data.recipient_name
    s.recipient_phone = data.recipient_phone
    s.planned_ship_date = data.planned_ship_date
    s.shipping_doc_type = data.shipping_doc_type
    s.notes = data.notes
    s.invoice_note = data.invoice_note
    s.waybill_note = data.waybill_note
    if data.items is not None:
        s.items = data.items

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
    if s.stage in ("shipped", "iptal_edildi"):
        raise HTTPException(status_code=400, detail="Bu talep artık iptal edilemez")

    old_stage = s.stage
    s.stage = "iptal_edildi"

    history = ShipmentHistory(
        shipment_id=s.id,
        stage_from=old_stage,
        stage_to="iptal_edildi",
        note=f"[IPTAL] {data.note or 'İptal edildi'}",
        user_id=current_user.id,
    )
    db.add(history)
    db.commit()
    db.refresh(s)

    # Notify creator
    shipment_dict = _shipment_to_dict(s)
    order_name = s.tg_order_name or s.customer_name
    note = data.note or ""
    if s.created_by:
        creator_list = [(email_svc._notif_email(s.created_by), s.created_by.name)]
        try:
            email_svc.send_cancelled(shipment_dict, creator_list, note, actor_name=current_user.name)
        except Exception as e:
            logger.error(f"Email failed (iptal_edildi): {e}")
        try:
            db.add(Notification(
                user_id=s.created_by.id,
                title=f"Sevk Talebi İptal Edildi: {order_name}",
                message=f"{current_user.name} talebi iptal etti. {note}".strip(),
                shipment_id=s.id,
            ))
            db.commit()
        except Exception as e:
            logger.error(f"In-app notification failed (iptal_edildi): {e}")

    return _shipment_to_dict(s)


@router.post("/{shipment_id}/request-revision")
def request_revision(
    shipment_id: int,
    data: StageAdvance,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin")),
):
    s = db.query(ShipmentRequest).filter(ShipmentRequest.id == shipment_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Sevk talebi bulunamadı")
    if s.stage not in ("pending_admin", "pending_parasut_approval"):
        raise HTTPException(status_code=400, detail="Revizyon talebi bu aşamada yapılamaz")

    old_stage = s.stage
    s.stage = "revizyon_bekleniyor"

    history = ShipmentHistory(
        shipment_id=s.id,
        stage_from=old_stage,
        stage_to="revizyon_bekleniyor",
        note=f"[REVIZYON] {data.note or ''}".strip(),
        user_id=current_user.id,
    )
    db.add(history)
    db.commit()
    db.refresh(s)

    # Notify creator
    shipment_dict = _shipment_to_dict(s)
    order_name = s.tg_order_name or s.customer_name
    revision_note = data.note or ""
    if s.created_by:
        creator_list = [(email_svc._notif_email(s.created_by), s.created_by.name)]
        try:
            email_svc.send_revision_requested(shipment_dict, creator_list, revision_note, actor_name=current_user.name)
        except Exception as e:
            logger.error(f"Email failed (revizyon_bekleniyor): {e}")
        try:
            db.add(Notification(
                user_id=s.created_by.id,
                title=f"Revizyon Gerekiyor: {order_name}",
                message=f"{current_user.name} revizyon istedi. {revision_note}".strip(),
                shipment_id=s.id,
            ))
            db.commit()
        except Exception as e:
            logger.error(f"In-app notification failed (revizyon_bekleniyor): {e}")

    return _shipment_to_dict(s)
