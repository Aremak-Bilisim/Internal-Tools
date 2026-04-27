"""
Tedarikçi siparişlerinin teslim onayında yüklenen Commercial Invoice (CI) Excel'i.
Teslim alınan child siparişine bağlanır.
"""
from sqlalchemy import Column, Integer, String, DateTime, UniqueConstraint
from sqlalchemy.sql import func
from app.core.database import Base


class PurchaseReceiptDocument(Base):
    __tablename__ = "purchase_receipt_documents"

    id = Column(Integer, primary_key=True, index=True)
    tg_purchase_id = Column(Integer, nullable=False, index=True)
    file_url = Column(String, nullable=False)
    original_name = Column(String, nullable=True)
    content_type = Column(String, nullable=True)
    size = Column(Integer, nullable=True)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("tg_purchase_id", name="uq_purchase_receipt_documents_tg_id"),
    )
