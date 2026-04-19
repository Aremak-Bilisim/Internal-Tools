from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.sql import func
from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    hashed_password = Column(String, nullable=False)
    # Roles: admin | sales | warehouse
    role = Column(String, nullable=False, default="sales")
    is_active = Column(Boolean, default=True)
    # Optional override: if set, notifications go here instead of `email`
    notification_email = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
