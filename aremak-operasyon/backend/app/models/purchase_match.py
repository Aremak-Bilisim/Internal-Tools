"""
PDF'teki ürün adı → lokal Product eşleşmelerini hatırlamak için.
Manuel eşleştirildiğinde kaydedilir, sonraki PDF'lerde otomatik kullanılır.
"""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func
from app.core.database import Base


class PurchaseMatch(Base):
    __tablename__ = "purchase_matches"

    id = Column(Integer, primary_key=True, index=True)
    pdf_name_norm = Column(String, index=True, nullable=False)  # normalize edilmiş PDF adı
    pdf_name_raw = Column(String, nullable=False)               # orijinal PDF adı (debug için)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("pdf_name_norm", name="uq_purchase_matches_pdf_name_norm"),
    )
