from sqlalchemy import Column, Integer, String, Float, Boolean, Text, DateTime
from sqlalchemy.sql import func
from app.core.database import Base


class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    tg_id = Column(Integer, unique=True, index=True, nullable=False)

    brand = Column(String, index=True, nullable=True)
    prod_model = Column(String, index=True, nullable=True)
    sku = Column(String, index=True, nullable=True)

    # Satış fiyatı
    price = Column(Float, nullable=True)
    currency_name = Column(String, nullable=True)   # "TL", "USD", "EUR"

    # Alış fiyatı
    purchase_price = Column(Float, nullable=True)
    purchase_currency_name = Column(String, nullable=True)

    # Kategori (alt kategori) ve üst kategori
    category_id = Column(Integer, nullable=True, index=True)
    category_name = Column(String, nullable=True)
    parent_category_id = Column(Integer, nullable=True, index=True)
    parent_category_name = Column(String, nullable=True)

    unit = Column(String, nullable=True)          # adet, set, vs.
    vat = Column(Float, nullable=True)            # KDV %
    no_inventory = Column(Boolean, default=False)
    inventory = Column(Float, default=0.0)
    critical_inventory = Column(Integer, default=0)
    details = Column(Text, nullable=True)
    not_available = Column(Boolean, default=False)  # Pasif

    synced_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
