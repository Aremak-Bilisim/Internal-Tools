from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from app.core.database import get_db
from app.core.auth import hash_password, require_role
from app.models.user import User

router = APIRouter()


class UserCreate(BaseModel):
    email: EmailStr
    name: str
    password: str
    role: str  # admin | sales | warehouse


@router.get("")
def list_users(db: Session = Depends(get_db), current_user=Depends(require_role("admin"))):
    users = db.query(User).all()
    return [{"id": u.id, "name": u.name, "email": u.email, "role": u.role, "is_active": u.is_active} for u in users]


@router.post("")
def create_user(data: UserCreate, db: Session = Depends(get_db), current_user=Depends(require_role("admin"))):
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Bu e-posta zaten kayıtlı")
    if data.role not in ("admin", "sales", "warehouse"):
        raise HTTPException(status_code=400, detail="Geçersiz rol")
    user = User(email=data.email, name=data.name, hashed_password=hash_password(data.password), role=data.role)
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"id": user.id, "name": user.name, "email": user.email, "role": user.role}


@router.delete("/{user_id}")
def deactivate_user(user_id: int, db: Session = Depends(get_db), current_user=Depends(require_role("admin"))):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
    user.is_active = False
    db.commit()
    return {"ok": True}
