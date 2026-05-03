"""
Tedarikçi siparişi öncesi 'talep havuzu' / 'talep listesi':
  - Tedarikçi başına bir 'open' liste — manuel + auto-fill ile birikir
  - TG sipariş ile match edildiğinde liste 'closed' olur (artık ekleme/silme yapılamaz)
  - Yeni talep birikimi için yeni 'open' liste açılır
"""
from sqlalchemy import Column, Integer, String, Float, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base


class PurchaseRequestList(Base):
    __tablename__ = "purchase_request_lists"

    id = Column(Integer, primary_key=True, index=True)
    tg_supplier_id = Column(Integer, nullable=False, index=True)
    supplier_name = Column(String, nullable=True)

    # 'open' | 'closed' (TG sipariş ile eşlendi) | 'cancelled'
    status = Column(String, nullable=False, default="open", index=True)
    linked_tg_purchase_id = Column(Integer, nullable=True, index=True)

    created_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    closed_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    closed_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    items = relationship("PurchaseRequestItem", back_populates="list", cascade="all, delete-orphan")
    created_by = relationship("User", foreign_keys=[created_by_id])
    closed_by = relationship("User", foreign_keys=[closed_by_id])


class PurchaseRequestItem(Base):
    __tablename__ = "purchase_request_items"

    id = Column(Integer, primary_key=True, index=True)
    list_id = Column(Integer, ForeignKey("purchase_request_lists.id", ondelete="CASCADE"), nullable=False, index=True)

    product_id = Column(Integer, ForeignKey("products.id", ondelete="SET NULL"), nullable=True, index=True)
    product_tg_id = Column(Integer, nullable=True, index=True)
    product_brand = Column(String, nullable=True)
    product_model = Column(String, nullable=True)
    product_sku = Column(String, nullable=True)

    quantity = Column(Float, nullable=False, default=0)
    unit_price = Column(Float, nullable=True)
    currency = Column(String, nullable=True)

    source = Column(String, nullable=False, default="manual")   # manual | auto_critical_stock
    notes = Column(Text, nullable=True)

    added_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    added_by = relationship("User")

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    list = relationship("PurchaseRequestList", back_populates="items")
