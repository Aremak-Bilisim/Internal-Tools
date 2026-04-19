from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class ShipmentRequest(Base):
    __tablename__ = "shipment_requests"

    id = Column(Integer, primary_key=True, index=True)

    # TeamGram reference
    tg_order_id = Column(Integer, index=True)
    tg_order_name = Column(String)
    customer_name = Column(String)

    # Shipment info
    delivery_type = Column(String)          # Ofis Teslim | Kargo
    cargo_company = Column(String)          # Yurtiçi Kargo, MNG, vs. (Kargo için)
    delivery_address = Column(Text)
    delivery_district = Column(String)       # İlçe
    delivery_city = Column(String)           # İl
    delivery_zip = Column(String)            # Posta kodu
    notes = Column(Text)

    # Invoice info (from TeamGram/Paraşüt)
    invoice_url = Column(String)
    invoice_no = Column(String)
    invoice_note = Column(Text)           # vergi dairesi, açıklama notu vb.
    waybill_note = Column(Text)           # irsaliye notu

    # Recipient info
    recipient_name = Column(String)
    recipient_phone = Column(String)

    # Shipment details
    planned_ship_date = Column(String)   # YYYY-MM-DD
    shipping_doc_type = Column(String)   # Fatura | İrsaliye | Fatura + İrsaliye

    # Items: [{"product_id": x, "product_name": "", "quantity": n, "shelf": ""}]
    items = Column(JSON, default=list)

    # Workflow stage
    # draft → pending_admin → preparing → pending_waybill_approval → ready_to_ship → shipped
    stage = Column(String, default="draft")

    # Assigned users
    created_by_id = Column(Integer, ForeignKey("users.id"))
    assigned_to_id = Column(Integer, ForeignKey("users.id"))   # warehouse staff

    # File uploads
    cargo_photo_urls = Column(JSON, default=list)
    cargo_tracking_no = Column(String)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    created_by = relationship("User", foreign_keys=[created_by_id])
    assigned_to = relationship("User", foreign_keys=[assigned_to_id])
    history = relationship("ShipmentHistory", back_populates="shipment", order_by="ShipmentHistory.created_at")


class ShipmentHistory(Base):
    __tablename__ = "shipment_history"

    id = Column(Integer, primary_key=True, index=True)
    shipment_id = Column(Integer, ForeignKey("shipment_requests.id"))
    stage_from = Column(String)
    stage_to = Column(String)
    note = Column(Text)
    user_id = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    shipment = relationship("ShipmentRequest", back_populates="history")
    user = relationship("User")
