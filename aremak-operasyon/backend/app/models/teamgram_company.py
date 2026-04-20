from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.sql import func
from app.core.database import Base


class TeamgramCompany(Base):
    __tablename__ = "teamgram_companies"

    id = Column(Integer, primary_key=True, index=True)
    tg_id = Column(Integer, unique=True, index=True, nullable=False)
    name = Column(String, nullable=True)
    tax_no = Column(String, index=True, nullable=True)
    tax_office = Column(String, nullable=True)
    address = Column(String, nullable=True)
    city = Column(String, nullable=True)
    district = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    email = Column(String, nullable=True)
    synced_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
