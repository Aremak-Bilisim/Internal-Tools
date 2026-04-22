from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class SampleRequest(Base):
    __tablename__ = "sample_requests"

    id = Column(Integer, primary_key=True, index=True)

    # TeamGram opportunity reference
    tg_opportunity_id = Column(Integer, index=True)
    tg_opportunity_name = Column(String)
    customer_name = Column(String)

    # Delivery info
    delivery_type = Column(String)        # Ofis Teslim | Kargo
    cargo_company = Column(String)
    delivery_address = Column(Text)
    delivery_district = Column(String)
    delivery_city = Column(String)
    delivery_zip = Column(String)
    notes = Column(Text)

    # Recipient
    recipient_name = Column(String)
    recipient_phone = Column(String)

    # Shipment
    planned_ship_date = Column(String)    # YYYY-MM-DD

    # Items: [{"product_id": x, "product_name": "", "quantity": n, "shelf": ""}]
    items = Column(JSON, default=list)

    # Workflow: pending_admin → preparing → shipped | iptal_edildi
    stage = Column(String, default="pending_admin")

    # Users
    created_by_id = Column(Integer, ForeignKey("users.id"))
    assigned_to_id = Column(Integer, ForeignKey("users.id"))

    # Paraşüt irsaliye (no invoice for samples)
    irsaliye_id = Column(String)
    waybill_note = Column(Text)

    # Cargo
    cargo_photo_urls = Column(JSON, default=list)
    cargo_pdf_url = Column(String)
    cargo_tracking_no = Column(String)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    created_by = relationship("User", foreign_keys=[created_by_id])
    assigned_to = relationship("User", foreign_keys=[assigned_to_id])
    history = relationship("SampleHistory", back_populates="sample", order_by="SampleHistory.created_at")


class SampleHistory(Base):
    __tablename__ = "sample_history"

    id = Column(Integer, primary_key=True, index=True)
    sample_id = Column(Integer, ForeignKey("sample_requests.id"))
    stage_from = Column(String)
    stage_to = Column(String)
    note = Column(Text)
    user_id = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    sample = relationship("SampleRequest", back_populates="history")
    user = relationship("User")
