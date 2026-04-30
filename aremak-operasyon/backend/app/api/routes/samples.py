import asyncio
import logging
import os
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel
from app.core.database import get_db
from app.core.auth import get_current_user, require_role
from app.models.sample import SampleRequest, SampleHistory
from app.models.user import User
from app.models.notification import Notification
from app.models.product import Product
from app.services import teamgram, parasut

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "..", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

logger = logging.getLogger(__name__)

router = APIRouter()

STAGE_TRANSITIONS = {
    "pending_admin":       {"next": "preparing",       "roles": ["admin"]},
    "preparing":           {"next": "shipped",          "roles": ["warehouse"]},
    "revizyon_bekleniyor": {"next": "pending_admin",    "roles": ["sales", "admin"]},
}

STAGE_LABELS = {
    "pending_admin":       "Yönetici Onayı Bekleniyor",
    "preparing":           "Sevk İçin Hazırlanıyor",
    "shipped":             "Sevk Edildi",
    "revizyon_bekleniyor": "Revizyon Bekleniyor",
    "iptal_edildi":        "İptal Edildi",
}


class SampleCreate(BaseModel):
    tg_opportunity_id: Optional[int] = None
    tg_opportunity_name: Optional[str] = None
    customer_name: str
    delivery_type: Optional[str] = None
    cargo_company: Optional[str] = None
    delivery_address: Optional[str] = None
    delivery_district: Optional[str] = None
    delivery_city: Optional[str] = None
    delivery_zip: Optional[str] = None
    notes: Optional[str] = None
    waybill_note: Optional[str] = None
    recipient_name: Optional[str] = None
    recipient_phone: Optional[str] = None
    planned_ship_date: Optional[str] = None
    items: list = []
    assigned_to_id: Optional[int] = None


class SampleUpdate(BaseModel):
    delivery_type: Optional[str] = None
    cargo_company: Optional[str] = None
    delivery_address: Optional[str] = None
    delivery_district: Optional[str] = None
    delivery_city: Optional[str] = None
    delivery_zip: Optional[str] = None
    notes: Optional[str] = None
    waybill_note: Optional[str] = None
    recipient_name: Optional[str] = None
    recipient_phone: Optional[str] = None
    planned_ship_date: Optional[str] = None
    items: Optional[list] = None
    assigned_to_id: Optional[int] = None


class StageAdvance(BaseModel):
    note: Optional[str] = None
    cargo_tracking_no: Optional[str] = None
    cargo_photo_urls: Optional[list] = None


def _sample_to_dict(s: SampleRequest) -> dict:
    return {
        "id": s.id,
        "tg_opportunity_id": s.tg_opportunity_id,
        "tg_opportunity_name": s.tg_opportunity_name,
        "customer_name": s.customer_name,
        "delivery_type": s.delivery_type,
        "cargo_company": s.cargo_company,
        "delivery_address": s.delivery_address,
        "delivery_district": s.delivery_district,
        "delivery_city": s.delivery_city,
        "delivery_zip": s.delivery_zip,
        "notes": s.notes,
        "waybill_note": s.waybill_note,
        "recipient_name": s.recipient_name,
        "recipient_phone": s.recipient_phone,
        "planned_ship_date": s.planned_ship_date,
        "items": s.items or [],
        "stage": s.stage,
        "stage_label": STAGE_LABELS.get(s.stage, s.stage),
        "irsaliye_id": s.irsaliye_id,
        "created_by": {"id": s.created_by.id, "name": s.created_by.name} if s.created_by else None,
        "assigned_to": {"id": s.assigned_to.id, "name": s.assigned_to.name} if s.assigned_to else None,
        "cargo_photo_urls": s.cargo_photo_urls or [],
        "cargo_pdf_url": s.cargo_pdf_url,
        "cargo_tracking_no": s.cargo_tracking_no,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
        "history": [
            {
                "id": h.id,
                "stage_from": h.stage_from,
                "stage_to": h.stage_to,
                "note": h.note,
                "user": {"id": h.user.id, "name": h.user.name} if h.user else None,
                "created_at": h.created_at.isoformat() if h.created_at else None,
            }
            for h in (s.history or [])
        ],
    }


# ── Opportunities proxy ───────────────────────────────────────────────────────

@router.get("/opportunities")
async def list_opportunities(current_user=Depends(get_current_user)):
    return await teamgram.get_opportunities()


@router.get("/opportunities/{opp_id}")
async def get_opportunity(opp_id: int, current_user=Depends(get_current_user)):
    return await teamgram.get_opportunity(opp_id)


@router.get("/opportunities/{opp_id}/proposals")
async def get_opportunity_proposals(opp_id: int, current_user=Depends(get_current_user)):
    return await teamgram.get_proposals_for_opportunity(opp_id)


@router.get("/proposals/{proposal_id}")
async def get_proposal(proposal_id: int, current_user=Depends(get_current_user)):
    return await teamgram.get_proposal(proposal_id)


# ── Sample CRUD ───────────────────────────────────────────────────────────────

@router.get("")
def list_samples(
    stage: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    q = db.query(SampleRequest)
    if stage:
        q = q.filter(SampleRequest.stage == stage)
    if current_user.role == "sales":
        q = q.filter(SampleRequest.created_by_id == current_user.id)
    samples = q.order_by(SampleRequest.created_at.desc()).all()
    return [_sample_to_dict(s) for s in samples]


@router.post("")
def create_sample(
    data: SampleCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin", "sales")),
):
    s = SampleRequest(
        tg_opportunity_id=data.tg_opportunity_id,
        tg_opportunity_name=data.tg_opportunity_name,
        customer_name=data.customer_name,
        delivery_type=data.delivery_type,
        cargo_company=data.cargo_company,
        delivery_address=data.delivery_address,
        delivery_district=data.delivery_district,
        delivery_city=data.delivery_city,
        delivery_zip=data.delivery_zip,
        notes=data.notes,
        waybill_note=data.waybill_note,
        recipient_name=data.recipient_name,
        recipient_phone=data.recipient_phone,
        planned_ship_date=data.planned_ship_date,
        items=data.items,
        assigned_to_id=data.assigned_to_id,
        created_by_id=current_user.id,
        stage="pending_admin",
    )
    db.add(s)
    db.commit()
    db.refresh(s)

    history = SampleHistory(
        sample_id=s.id,
        stage_from=None,
        stage_to="pending_admin",
        note=f"[CREATED] {data.notes or ''}".strip(),
        user_id=current_user.id,
    )
    db.add(history)

    # Notify admins
    admins = db.query(User).filter(User.role == "admin", User.is_active == True).all()
    for admin in admins:
        notif = Notification(
            user_id=admin.id,
            title="Yeni Numune Talebi",
            message=f"{current_user.name} tarafından {s.customer_name} için numune talebi oluşturuldu.",
            sample_id=s.id,
        )
        db.add(notif)

    db.commit()
    db.refresh(s)

    result = _sample_to_dict(s)
    warnings = _create_irsaliye_for_sample(db, s, data.tg_opportunity_id)
    result["warnings"] = warnings
    return result


def _create_irsaliye_for_sample(db: Session, s: SampleRequest, tg_opportunity_id: Optional[int]) -> list:
    """
    Talep oluşturulduğu anda Paraşüt'te irsaliye yarat.
    irsaliye_id zaten doluysa hiçbir şey yapma (revizyon sonrası yeniden gönderimde çalışmaz).
    """
    if s.irsaliye_id:
        return []

    warnings = []
    try:
        # 1. Paraşüt contact: önce VKN ile dene, bulamazsan isimle
        contact_id = None
        if tg_opportunity_id:
            try:
                opp = asyncio.run(teamgram.get_opportunity(tg_opportunity_id))
                entity = opp.get("RelatedEntity") or {}
                tax_no = (entity.get("TaxNo") or "").strip()
                if tax_no:
                    contact_id = asyncio.run(parasut.search_contact_by_tax_number(tax_no))
            except Exception as e:
                logger.warning(f"TG fırsat çekilemedi (id={tg_opportunity_id}): {e}")

        if not contact_id and s.customer_name:
            contact_id = asyncio.run(parasut.search_contact_by_name(s.customer_name))

        if not contact_id:
            warnings.append(f"Paraşüt'te '{s.customer_name}' carisi bulunamadı. İrsaliye oluşturulamadı.")
            return warnings

        # 2. TG product ID → Paraşüt product ID (local DB üzerinden)
        parasut_items = []
        for item in (s.items or []):
            tg_id = item.get("product_id")
            qty = float(item.get("quantity") or 0)
            if not tg_id or qty <= 0:
                continue
            product = db.query(Product).filter(Product.tg_id == tg_id).first()
            if product and product.parasut_id:
                parasut_items.append({"parasut_product_id": product.parasut_id, "quantity": qty})
            else:
                warnings.append(f"'{item.get('product_name', tg_id)}' ürününün Paraşüt eşleşmesi yok, irsaliyeye eklenmedi.")

        if not parasut_items:
            warnings.append("Hiçbir ürün Paraşüt'te eşleşmedi. İrsaliye boş oluşmaz, atlandı.")
            return warnings

        # 3. İrsaliye oluştur
        result = asyncio.run(parasut.create_irsaliye_for_sample(
            contact_id=contact_id,
            items=parasut_items,
            issue_date=s.planned_ship_date,
            delivery_address=s.delivery_address,
            delivery_district=s.delivery_district,
            delivery_city=s.delivery_city,
            delivery_zip=s.delivery_zip,
            delivery_type=s.delivery_type,
            cargo_company=s.cargo_company,
            description=f"Numune - {s.tg_opportunity_name or s.customer_name}",
        ))
        irsaliye_id = result.get("data", {}).get("id")
        if irsaliye_id:
            s.irsaliye_id = irsaliye_id
            db.commit()
            logger.info(f"Numune irsaliyesi oluşturuldu: sample_id={s.id} irsaliye_id={irsaliye_id}")
        else:
            warnings.append("İrsaliye oluşturuldu ancak ID alınamadı.")
    except Exception as e:
        msg = f"Paraşüt irsaliye oluşturulamadı: {e}"
        logger.error(msg)
        warnings.append(msg)

    return warnings


@router.get("/{sample_id}")
def get_sample(sample_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    s = db.query(SampleRequest).filter(SampleRequest.id == sample_id).first()
    if not s:
        raise HTTPException(404, "Numune talebi bulunamadı")
    return _sample_to_dict(s)


@router.patch("/{sample_id}")
def update_sample(
    sample_id: int,
    data: SampleUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    s = db.query(SampleRequest).filter(SampleRequest.id == sample_id).first()
    if not s:
        raise HTTPException(404, "Numune talebi bulunamadı")
    for field, val in data.model_dump(exclude_unset=True).items():
        setattr(s, field, val)
    db.commit()
    db.refresh(s)
    return _sample_to_dict(s)


@router.post("/{sample_id}/advance")
async def advance_stage(
    sample_id: int,
    body: StageAdvance,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    s = db.query(SampleRequest).filter(SampleRequest.id == sample_id).first()
    if not s:
        raise HTTPException(404, "Numune talebi bulunamadı")

    transition = STAGE_TRANSITIONS.get(s.stage)
    if not transition:
        raise HTTPException(400, "Bu aşamadan ilerleme yapılamaz")
    if current_user.role not in transition["roles"] and current_user.role != "admin":
        raise HTTPException(403, "Bu işlem için yetkiniz yok")

    old_stage = s.stage
    new_stage = transition["next"]

    if body.cargo_tracking_no:
        s.cargo_tracking_no = body.cargo_tracking_no
    if body.cargo_photo_urls:
        s.cargo_photo_urls = body.cargo_photo_urls

    s.stage = new_stage

    history = SampleHistory(
        sample_id=s.id,
        stage_from=old_stage,
        stage_to=new_stage,
        note=body.note,
        user_id=current_user.id,
    )
    db.add(history)

    # On shipped: adjust TG inventory for each item (best-effort, silent on failure)
    warnings = []
    if new_stage == "shipped":
        for item in (s.items or []):
            product_id = item.get("product_id")
            quantity = item.get("quantity") or 0
            if product_id and quantity:
                try:
                    await teamgram.inventory_adjustment(
                        product_id, quantity, reason=10,
                        desc=f"Numune - {s.tg_opportunity_name or s.customer_name}"
                    )
                except Exception as e:
                    warnings.append(f"TG stok güncellenemedi ({item.get('product_name', product_id)}): {e}")

    # Notify relevant users
    notify_roles = []
    if new_stage == "preparing":
        notify_roles = ["warehouse"]
    elif new_stage == "shipped":
        notify_roles = ["sales", "admin"]
    elif new_stage == "pending_admin":
        # Sales re-submitted after revision — notify admins
        notify_roles = ["admin"]

    notif_users = db.query(User).filter(
        User.role.in_(notify_roles), User.is_active == True
    ).all() if notify_roles else []

    for u in notif_users:
        notif = Notification(
            user_id=u.id,
            title=f"Numune: {STAGE_LABELS[new_stage]}",
            message=f"{s.customer_name} numunesinde yeni aşama: {STAGE_LABELS[new_stage]}",
            sample_id=s.id,
        )
        db.add(notif)

    db.commit()
    db.refresh(s)

    result = _sample_to_dict(s)
    result["warnings"] = warnings
    return result


class RevizeBody(BaseModel):
    note: Optional[str] = None


@router.post("/{sample_id}/revize")
def request_revision(
    sample_id: int,
    body: RevizeBody,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin")),
):
    """Admin sends the request back to sales for revision (pending_admin → revizyon_bekleniyor)."""
    s = db.query(SampleRequest).filter(SampleRequest.id == sample_id).first()
    if not s:
        raise HTTPException(404, "Numune talebi bulunamadı")
    if s.stage != "pending_admin":
        raise HTTPException(400, "Yalnızca yönetici onayı aşamasında revizyon istenebilir")

    old_stage = s.stage
    s.stage = "revizyon_bekleniyor"

    history = SampleHistory(
        sample_id=s.id,
        stage_from=old_stage,
        stage_to="revizyon_bekleniyor",
        note=body.note,
        user_id=current_user.id,
    )
    db.add(history)

    # Notify the creator (sales)
    if s.created_by_id:
        notif = Notification(
            user_id=s.created_by_id,
            title="Numune: Revizyon Bekleniyor",
            message=f"{s.customer_name} numune talebi revizyon için geri gönderildi."
            + (f" Not: {body.note}" if body.note else ""),
            sample_id=s.id,
        )
        db.add(notif)

    db.commit()
    db.refresh(s)
    return _sample_to_dict(s)


class MatchIrsaliyeIn(BaseModel):
    irsaliye_id: str


@router.post("/{sample_id}/match-irsaliye")
def match_irsaliye(
    sample_id: int,
    data: MatchIrsaliyeIn,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin")),
):
    """Admin: numune sevkine Paraşüt irsaliyesini manuel eşleştir/değiştir.
    Tüm aşamalarda izinli (sevk edilmiş numunelerde de geçerli)."""
    s = db.query(SampleRequest).filter(SampleRequest.id == sample_id).first()
    if not s:
        raise HTTPException(404, "Numune talebi bulunamadı")
    if not data.irsaliye_id or not data.irsaliye_id.strip():
        raise HTTPException(400, "irsaliye_id gerekli")
    s.irsaliye_id = data.irsaliye_id.strip()
    db.commit()
    db.refresh(s)
    return _sample_to_dict(s)


@router.post("/{sample_id}/cancel")
def cancel_sample(
    sample_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin", "sales")),
):
    s = db.query(SampleRequest).filter(SampleRequest.id == sample_id).first()
    if not s:
        raise HTTPException(404, "Numune talebi bulunamadı")
    if s.stage == "shipped":
        raise HTTPException(400, "Sevk edilmiş talep iptal edilemez")

    old_stage = s.stage
    s.stage = "iptal_edildi"
    history = SampleHistory(
        sample_id=s.id,
        stage_from=old_stage,
        stage_to="iptal_edildi",
        note="İptal edildi",
        user_id=current_user.id,
    )
    db.add(history)
    db.commit()
    db.refresh(s)
    return _sample_to_dict(s)


@router.post("/{sample_id}/upload/cargo-pdf")
def upload_cargo_pdf(
    sample_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_role("warehouse", "admin")),
):
    s = db.query(SampleRequest).filter(SampleRequest.id == sample_id).first()
    if not s:
        raise HTTPException(404, "Numune talebi bulunamadı")
    ext = os.path.splitext(file.filename or "")[1] or ".pdf"
    fname = f"sample_cargo_pdf_{sample_id}_{uuid.uuid4().hex[:8]}{ext}"
    fpath = os.path.join(UPLOAD_DIR, fname)
    with open(fpath, "wb") as f:
        f.write(file.file.read())
    s.cargo_pdf_url = f"/uploads/{fname}"
    db.commit()
    db.refresh(s)
    return _sample_to_dict(s)


@router.post("/{sample_id}/photo")
async def upload_photo(
    sample_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    s = db.query(SampleRequest).filter(SampleRequest.id == sample_id).first()
    if not s:
        raise HTTPException(404, "Numune talebi bulunamadı")

    ext = os.path.splitext(file.filename)[1] if file.filename else ".jpg"
    fname = f"sample_{sample_id}_{uuid.uuid4().hex}{ext}"
    fpath = os.path.join(UPLOAD_DIR, fname)
    content = await file.read()
    with open(fpath, "wb") as f:
        f.write(content)

    url = f"/uploads/{fname}"
    photos = list(s.cargo_photo_urls or [])
    photos.append(url)
    s.cargo_photo_urls = photos
    db.commit()
    db.refresh(s)
    return {"url": url, "cargo_photo_urls": s.cargo_photo_urls}
