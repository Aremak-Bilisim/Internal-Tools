"""
Knack'ten import edilen arşiv tedarikçi siparişleri.
TG ile bağlantılı değil — sadece sorgu/analiz amaçlı lokal kayıt.
"""
from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class ArchivePurchaseOrder(Base):
    __tablename__ = "archive_purchase_orders"

    id = Column(Integer, primary_key=True, index=True)
    siparis_no = Column(String, index=True, nullable=True)             # Knack: Sipariş No
    order_date = Column(String, nullable=True)                          # YYYY-MM-DD
    supplier_name = Column(String, index=True, nullable=False)          # Knack: Tedarikçi Firma (raw)
    tg_party_id = Column(Integer, nullable=True, index=True)            # TG'deki tedarikçi ID (eşleşirse)
    total = Column(Float, nullable=True)
    currency = Column(String, nullable=True)                            # 'USD' | 'EUR'
    is_received = Column(Boolean, default=False)                        # Evet/Kısmen Evet -> True, Hayır -> False
    knack_pdf_url = Column(String, nullable=True)
    knack_record_id = Column(String, unique=True, index=True, nullable=False)  # Idempotency için
    imported_at = Column(DateTime(timezone=True), server_default=func.now())

    items = relationship("ArchivePurchaseItem", back_populates="order", cascade="all, delete-orphan")


class ArchivePurchaseItem(Base):
    __tablename__ = "archive_purchase_items"

    id = Column(Integer, primary_key=True, index=True)
    archive_order_id = Column(Integer, ForeignKey("archive_purchase_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="SET NULL"), nullable=True, index=True)  # Eşleşirse
    product_name = Column(String, nullable=False)                       # Knack'teki ürün adı (raw)
    quantity = Column(Float, nullable=False, default=0)
    line_total = Column(Float, nullable=True)
    knack_record_id = Column(String, unique=True, nullable=True)        # Item için Knack ID (idempotent)

    order = relationship("ArchivePurchaseOrder", back_populates="items")
