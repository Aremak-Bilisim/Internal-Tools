"""
Knack'ten import edilen arşiv sevk talepleri (1707 kayıt).
Mevcut ShipmentRequest ile karışmaması için ayrı tablolar.
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Float
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class ArchiveShipmentRequest(Base):
    __tablename__ = "archive_shipment_requests"

    id = Column(Integer, primary_key=True, index=True)
    knack_record_id = Column(String, unique=True, index=True, nullable=False)

    # Tarihler (YYYY-MM-DD)
    talep_tarihi = Column(String, nullable=True, index=True)
    sevk_tarihi = Column(String, nullable=True, index=True)
    son_kontrol_tarihi = Column(String, nullable=True)
    planlanan_sevk_tarihi = Column(String, nullable=True)
    planlanan_fatura_tarihi = Column(String, nullable=True)

    # Kişiler
    talep_admini = Column(String, nullable=True)
    sevk_sorumlusu = Column(String, nullable=True)
    ilgili_satisci = Column(String, nullable=True)
    alici_adi = Column(String, nullable=True, index=True)
    alici_telefon = Column(String, nullable=True)

    # Durum / onaylar
    durum = Column(String, nullable=True, index=True)
    onay = Column(String, nullable=True)
    admin_onayi = Column(String, nullable=True)
    parasut_onayi = Column(String, nullable=True)
    siparis_onayi = Column(String, nullable=True)

    # Sevk
    sevk_yonu = Column(String, nullable=True)
    gonderim_belgesi = Column(String, nullable=True)
    teslim_sekli = Column(String, nullable=True)
    sevkiyat_yontemi = Column(String, nullable=True)
    kargo_firmalari = Column(String, nullable=True)
    teslimat_adresi = Column(Text, nullable=True)
    arac_plakasi = Column(String, nullable=True)
    sofor_ad_soyad = Column(String, nullable=True)
    sofor_tc = Column(String, nullable=True)

    # Ödeme
    fatura_para_birimi = Column(String, nullable=True)
    fatura_kuru = Column(String, nullable=True)
    odeme_durumu = Column(String, nullable=True)
    odeme_tarihi = Column(String, nullable=True)
    iban_bilgileri = Column(String, nullable=True)

    # Notlar
    kontrol_notu = Column(Text, nullable=True)
    sevk_sorumlusu_notu = Column(Text, nullable=True)
    irsaliye_notu = Column(Text, nullable=True)
    fatura_notu = Column(Text, nullable=True)
    kargo_icerigi = Column(Text, nullable=True)
    irsaliye_adi = Column(String, nullable=True)

    # Stok
    stok_takibi = Column(String, nullable=True)

    imported_at = Column(DateTime(timezone=True), server_default=func.now())

    items = relationship("ArchiveShipmentItem", back_populates="request", cascade="all, delete-orphan")
    files = relationship("ArchiveShipmentFile", back_populates="request", cascade="all, delete-orphan")


class ArchiveShipmentItem(Base):
    __tablename__ = "archive_shipment_items"

    id = Column(Integer, primary_key=True, index=True)
    request_id = Column(Integer, ForeignKey("archive_shipment_requests.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="SET NULL"), nullable=True, index=True)
    urun_adi = Column(String, nullable=False)
    urun_sku = Column(String, nullable=True, index=True)
    adet = Column(Integer, nullable=True)
    konum = Column(String, nullable=True)

    request = relationship("ArchiveShipmentRequest", back_populates="items")


class ArchiveShipmentFile(Base):
    __tablename__ = "archive_shipment_files"

    id = Column(Integer, primary_key=True, index=True)
    request_id = Column(Integer, ForeignKey("archive_shipment_requests.id", ondelete="CASCADE"), nullable=False, index=True)
    alan_adi = Column(String, nullable=False)         # 'Kargo Fişi', 'Fatura', 'Foto-1: ...' vs.
    dosya_adi = Column(String, nullable=False)
    yerel_yol = Column(String, nullable=False)        # public path: /uploads/shipments/archive/{knack_id}/{kategori}/file
    boyut = Column(Integer, nullable=True)            # bytes

    request = relationship("ArchiveShipmentRequest", back_populates="files")
