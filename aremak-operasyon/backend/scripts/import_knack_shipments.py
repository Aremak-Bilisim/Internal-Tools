"""
Knack arşivinden export edilen sevk verisi içe aktarımı.

Beklenen klasör yapısı (zip açılmış halde):
    /tmp/sevk_export/
      sevk.db
      files/
        {knack_record_id}/
          kargo_fisi/  *.pdf
          fatura/      *.pdf
          irsaliye/    *.pdf
          ...

Kullanım:
    python scripts/import_knack_shipments.py /tmp/sevk_export

Yapılanlar:
    1. sevk_talepleri → archive_shipment_requests (tarihler ISO'ya çevrilir)
    2. sevk_listeleri → archive_shipment_items (urun_sku ile lokal Product eşleşmesi)
    3. sevk_dosyalari → /uploads/shipments/archive/{knack_id}/{kategori}/{file}'a kopyalanır
       + archive_shipment_files kaydı oluşur
    Idempotent: knack_record_id UNIQUE.
"""
import os
import re
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.database import SessionLocal
from app.models import (
    user, shipment, notification, teamgram_company, product, sample,
    purchase_match, purchase_document, purchase_receipt_document, archive_purchase,
    hepsiburada_order, archive_shipment,
)  # noqa
from app.models.product import Product
from app.models.archive_shipment import (
    ArchiveShipmentRequest, ArchiveShipmentItem, ArchiveShipmentFile,
)


UPLOAD_BASE = Path(__file__).resolve().parent.parent / "uploads" / "shipments" / "archive"
PUBLIC_PREFIX = "/uploads/shipments/archive"


def parse_dt_to_date(s: str | None) -> str | None:
    """'DD/MM/YYYY HH:MM' veya 'DD/MM/YYYY' → 'YYYY-MM-DD'"""
    if not s:
        return None
    s = s.strip()
    if not s:
        return None
    for fmt in ("%d/%m/%Y %H:%M", "%d/%m/%Y", "%d.%m.%Y %H:%M", "%d.%m.%Y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def safe_filename(name: str) -> str:
    """OS-safe filename — / \\ : ? * vs. çıkar."""
    return re.sub(r'[\\/:"*?<>|]+', "_", name).strip() or "file"


def import_data(export_dir: Path):
    db_path = export_dir / "sevk.db"
    files_root = export_dir / "files"
    if not db_path.exists():
        raise FileNotFoundError(f"sevk.db bulunamadı: {db_path}")

    src = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    src.row_factory = sqlite3.Row

    db = SessionLocal()
    try:
        # SKU → Product map (lokal)
        sku_to_pid = {p.sku: p.id for p in db.query(Product).all() if p.sku}

        # ── 1. Talepler ──
        talep_rows = src.execute("SELECT * FROM sevk_talepleri").fetchall()
        print(f"Talep sayısı: {len(talep_rows)}")
        knack_to_local: dict[str, int] = {}
        inserted_t = 0
        skipped_t = 0
        for r in talep_rows:
            knack_id = r["id"]
            existing = db.query(ArchiveShipmentRequest).filter_by(knack_record_id=knack_id).first()
            if existing:
                knack_to_local[knack_id] = existing.id
                skipped_t += 1
                continue
            req = ArchiveShipmentRequest(
                knack_record_id=knack_id,
                talep_tarihi=parse_dt_to_date(r["talep_tarihi"]),
                sevk_tarihi=parse_dt_to_date(r["sevk_tarihi"]),
                son_kontrol_tarihi=parse_dt_to_date(r["son_kontrol_tarihi"]),
                planlanan_sevk_tarihi=parse_dt_to_date(r["planlanan_sevk_tarihi"]),
                planlanan_fatura_tarihi=parse_dt_to_date(r["planlanan_fatura_tarihi"]),
                talep_admini=r["talep_admini"],
                sevk_sorumlusu=r["sevk_sorumlusu"],
                ilgili_satisci=r["ilgili_satisci"],
                alici_adi=r["alici_adi"],
                alici_telefon=r["alici_telefon"],
                durum=r["durum"],
                onay=r["onay"],
                admin_onayi=r["admin_onayi"],
                parasut_onayi=r["parasut_onayi"],
                siparis_onayi=r["siparis_onayi"],
                sevk_yonu=r["sevk_yonu"],
                gonderim_belgesi=r["gonderim_belgesi"],
                teslim_sekli=r["teslim_sekli"],
                sevkiyat_yontemi=r["sevkiyat_yontemi"],
                kargo_firmalari=r["kargo_firmalari"],
                teslimat_adresi=r["teslimat_adresi"],
                arac_plakasi=r["arac_plakasi"],
                sofor_ad_soyad=r["sofor_ad_soyad"],
                sofor_tc=r["sofor_tc"],
                fatura_para_birimi=r["fatura_para_birimi"],
                fatura_kuru=r["fatura_kuru"],
                odeme_durumu=r["odeme_durumu"],
                odeme_tarihi=parse_dt_to_date(r["odeme_tarihi"]),
                iban_bilgileri=r["iban_bilgileri"],
                kontrol_notu=r["kontrol_notu"],
                sevk_sorumlusu_notu=r["sevk_sorumlusu_notu"],
                irsaliye_notu=r["irsaliye_notu"],
                fatura_notu=r["fatura_notu"],
                kargo_icerigi=r["kargo_icerigi"],
                irsaliye_adi=r["irsaliye_adi"],
                stok_takibi=r["stok_takibi"],
            )
            db.add(req)
            db.flush()
            knack_to_local[knack_id] = req.id
            inserted_t += 1
            if inserted_t % 100 == 0:
                db.commit()
                print(f"  {inserted_t} talep eklendi...")
        db.commit()
        print(f"✓ {inserted_t} talep eklendi, {skipped_t} mevcut")

        # ── 2. Items ──
        item_rows = src.execute("SELECT * FROM sevk_listeleri").fetchall()
        inserted_i = 0
        no_parent_i = 0
        for r in item_rows:
            local_req_id = knack_to_local.get(r["talep_id"])
            if not local_req_id:
                no_parent_i += 1
                continue
            sku = (r["urun_sku"] or "").strip() or None
            product_id = sku_to_pid.get(sku) if sku else None
            db.add(ArchiveShipmentItem(
                request_id=local_req_id,
                product_id=product_id,
                urun_adi=r["urun_adi"] or "",
                urun_sku=sku,
                adet=r["adet"],
                konum=r["konum"],
            ))
            inserted_i += 1
            if inserted_i % 500 == 0:
                db.commit()
        db.commit()
        print(f"✓ {inserted_i} ürün eklendi, {no_parent_i} parent bulunamadı")

        # ── 3. Dosyalar ──
        file_rows = src.execute("SELECT * FROM sevk_dosyalari").fetchall()
        inserted_f = 0
        copied_f = 0
        skipped_f = 0
        missing_f = 0
        for r in file_rows:
            local_req_id = knack_to_local.get(r["talep_id"])
            if not local_req_id:
                continue

            yerel_yol = (r["yerel_yol"] or "").replace("\\", "/").lstrip("/")
            src_path = export_dir / yerel_yol
            if not src_path.exists():
                missing_f += 1
                continue

            kategori_dir = Path(yerel_yol).parent.name  # ör. 'fatura'
            dest_dir = UPLOAD_BASE / r["talep_id"] / kategori_dir
            dest_dir.mkdir(parents=True, exist_ok=True)
            fname = safe_filename(r["dosya_adi"] or src_path.name)
            dest_path = dest_dir / fname

            # public path
            public_path = f"{PUBLIC_PREFIX}/{r['talep_id']}/{kategori_dir}/{fname}"

            existing = db.query(ArchiveShipmentFile).filter_by(
                request_id=local_req_id,
                yerel_yol=public_path,
            ).first()
            if existing:
                skipped_f += 1
                continue

            if not dest_path.exists():
                shutil.copy2(src_path, dest_path)
                copied_f += 1

            size = dest_path.stat().st_size if dest_path.exists() else None
            db.add(ArchiveShipmentFile(
                request_id=local_req_id,
                alan_adi=r["alan_adi"] or "?",
                dosya_adi=fname,
                yerel_yol=public_path,
                boyut=size,
            ))
            inserted_f += 1
            if inserted_f % 500 == 0:
                db.commit()
                print(f"  {inserted_f} dosya kaydı eklendi, {copied_f} kopyalandı...")
        db.commit()
        print(f"✓ {inserted_f} dosya eklendi, {copied_f} fiziksel kopyalandı")
        print(f"  {skipped_f} zaten vardı, {missing_f} kaynak dosya bulunamadı")

    finally:
        db.close()
        src.close()


def main():
    if len(sys.argv) < 2:
        print("Kullanım: python scripts/import_knack_shipments.py <export_dir>")
        sys.exit(1)
    import_data(Path(sys.argv[1]).resolve())


if __name__ == "__main__":
    main()
