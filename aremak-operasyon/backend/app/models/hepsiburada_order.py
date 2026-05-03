"""
Hepsiburada webhook'tan alınan sipariş kayıtları.
- Idempotent: aynı external_order_id tekrar gelirse duplicate olmaz.
- raw_payload: tam gelen JSON, debug + analiz için saklanır.
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, UniqueConstraint
from sqlalchemy.sql import func
from app.core.database import Base


class HepsiburadaOrder(Base):
    __tablename__ = "hepsiburada_orders"

    id = Column(Integer, primary_key=True, index=True)
    external_order_id = Column(String, nullable=False, index=True)        # Hepsiburada order ID
    order_number = Column(String, nullable=True, index=True)              # İnsan-okur sipariş no
    event_type = Column(String, nullable=True)                            # OrderCreated, StatusUpdate vs.
    raw_payload = Column(Text, nullable=False)                            # Tam JSON payload
    tg_opportunity_id = Column(Integer, nullable=True, index=True)        # TG'de yaratılan fırsat ID
    processed = Column(Boolean, default=False)                            # TG'de fırsat yaratıldı mı?
    error = Column(Text, nullable=True)                                   # İşlem hatası varsa
    parasut_invoice_id = Column(String, nullable=True, index=True)        # Asama 1 onayinda olusan Parasut faturasi
    package_number = Column(String, nullable=True, index=True)            # HB packaging API'sinden donen paket no
    approved_by_id = Column(Integer, nullable=True)                       # Asama 1'i onaylayan kullanici (User.id)
    received_at = Column(DateTime(timezone=True), server_default=func.now())
    processed_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("external_order_id", "event_type", name="uq_hb_orders_eid_event"),
    )
