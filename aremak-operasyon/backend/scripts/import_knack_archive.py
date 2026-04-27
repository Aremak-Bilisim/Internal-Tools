"""
Knack'ten export edilen tedarikçi siparişleri ve kalemlerini lokal arşive aktarır.

Kullanım:
    python scripts/import_knack_archive.py <orders_csv> <items_csv>

Örnek:
    python scripts/import_knack_archive.py /path/to/tedarikisiparileri.csv /path/to/tedarikisiparikalemleri.csv

Çıktı:
    - Konsola özet (kaç sipariş/kalem eklendi, kaç ürün eşleşmedi)
    - unmatched_products.csv: lokal stoğa eşleşmeyen ürünlerin listesi
"""
import csv
import os
import re
import sys
from datetime import datetime
from pathlib import Path

# Proje kökünü PYTHONPATH'e ekle
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.database import SessionLocal, Base, engine
from app.models import user, shipment, notification, teamgram_company, product, sample, purchase_match, purchase_document, purchase_receipt_document, archive_purchase  # noqa
from app.models.product import Product
from app.models.archive_purchase import ArchivePurchaseOrder, ArchivePurchaseItem

# Ensure tables exist
Base.metadata.create_all(bind=engine)


SUPPLIER_TG_MAP = {
    "Hikrobot": 28599315,
    "The Imaging Source": 28603908,
    "Arducam": 28603911,
    "Vision Components": 28603912,
    "OPT": 28603915,
    "Lucid Vision": 28603916,
    "Shenzhen Danbes Technology Co LTD": 28603919,
    "Nantong Lianze Promise Technology": 28603921,
}


def parse_date(s: str) -> str | None:
    """DD/MM/YYYY → YYYY-MM-DD"""
    if not s or not s.strip():
        return None
    try:
        return datetime.strptime(s.strip(), "%d/%m/%Y").strftime("%Y-%m-%d")
    except ValueError:
        return s


def parse_float(s: str) -> float | None:
    if not s or not s.strip():
        return None
    try:
        return float(s.replace(",", "").strip())
    except ValueError:
        return None


def parse_int(s: str) -> int:
    if not s or not s.strip():
        return 0
    try:
        return int(float(s.replace(",", "").strip()))
    except ValueError:
        return 0


def match_product(db, raw_name: str) -> Product | None:
    """Lokal Product tablosuna eşleştir (purchase_orders.py'daki _match_product mantığı)."""
    if not raw_name:
        return None
    name = raw_name.strip()

    # 1. Tam prod_model
    p = db.query(Product).filter(Product.prod_model.ilike(name)).first()
    if p:
        return p

    # 2. Substring (model adı içeriyor mu)
    upper = name.upper()
    candidates = db.query(Product).filter(Product.prod_model.isnot(None)).all()
    for c in candidates:
        pm = (c.prod_model or "").strip().upper()
        if not pm:
            continue
        if pm == upper or pm in upper or upper in pm:
            return c

    # 3. SKU
    p = db.query(Product).filter(Product.sku.ilike(f"%{name}%")).first()
    return p


def import_orders(db, orders_csv: str) -> dict[str, int]:
    """Returns: knack_record_id -> archive_order.id"""
    record_to_id = {}
    inserted = 0
    skipped = 0
    unmatched_suppliers = set()

    with open(orders_csv, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            knack_id = (row.get("Record ID") or "").strip()
            if not knack_id:
                continue

            existing = db.query(ArchivePurchaseOrder).filter_by(knack_record_id=knack_id).first()
            if existing:
                record_to_id[knack_id] = existing.id
                skipped += 1
                continue

            supplier = (row.get("Tedarikçi Firma") or "").strip()
            tg_id = SUPPLIER_TG_MAP.get(supplier)
            if not tg_id:
                unmatched_suppliers.add(supplier)

            usd = parse_float(row.get("Sipariş Toplamı (USD)"))
            eur = parse_float(row.get("Sipariş Toplamı (Euro)"))
            if usd and usd > 0:
                total, currency = usd, "USD"
            elif eur and eur > 0:
                total, currency = eur, "EUR"
            else:
                total, currency = None, None

            received_str = (row.get("Teslim Alındı mı?") or "").strip().lower()
            is_received = received_str.startswith("evet") or received_str.startswith("kısmen") or received_str.startswith("kismen")

            order = ArchivePurchaseOrder(
                siparis_no=(row.get("Sipariş No") or "").strip() or None,
                order_date=parse_date(row.get("Sipariş Tarihi")),
                supplier_name=supplier,
                tg_party_id=tg_id,
                total=total,
                currency=currency,
                is_received=is_received,
                knack_pdf_url=(row.get("Sipariş Dokümanı : URL") or "").strip() or None,
                knack_record_id=knack_id,
            )
            db.add(order)
            db.flush()
            record_to_id[knack_id] = order.id
            inserted += 1

    db.commit()
    return {
        "record_to_id": record_to_id,
        "inserted": inserted,
        "skipped": skipped,
        "unmatched_suppliers": unmatched_suppliers,
    }


def import_items(db, items_csv: str, siparis_no_to_order_id: dict[str, int]) -> dict:
    inserted = 0
    skipped = 0
    no_parent = 0
    unmatched = []  # list of (product_name, qty)

    with open(items_csv, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            knack_id = (row.get("Record ID") or "").strip()
            if not knack_id:
                continue

            existing = db.query(ArchivePurchaseItem).filter_by(knack_record_id=knack_id).first()
            if existing:
                skipped += 1
                continue

            siparis_no = (row.get("Sipariş") or "").strip()
            order_id = siparis_no_to_order_id.get(siparis_no)
            if not order_id:
                no_parent += 1
                continue

            product_name = (row.get("Ürünler") or "").strip()
            quantity = parse_float(row.get("Sipariş Edilen Adet")) or 0
            line_total = parse_float(row.get("Toplam Tutar"))

            matched = match_product(db, product_name)
            if not matched and product_name:
                unmatched.append((product_name, quantity))

            item = ArchivePurchaseItem(
                archive_order_id=order_id,
                product_id=matched.id if matched else None,
                product_name=product_name,
                quantity=quantity,
                line_total=line_total,
                knack_record_id=knack_id,
            )
            db.add(item)
            inserted += 1

    db.commit()
    return {"inserted": inserted, "skipped": skipped, "no_parent": no_parent, "unmatched": unmatched}


def main():
    if len(sys.argv) < 3:
        print("Kullanım: python scripts/import_knack_archive.py <orders_csv> <items_csv>")
        sys.exit(1)

    orders_csv = sys.argv[1]
    items_csv = sys.argv[2]

    db = SessionLocal()
    try:
        print(f"Orders import: {orders_csv}")
        r1 = import_orders(db, orders_csv)
        print(f"  ✓ {r1['inserted']} eklendi, {r1['skipped']} zaten vardı")
        if r1["unmatched_suppliers"]:
            print(f"  ⚠ Eşleşmeyen tedarikçi: {r1['unmatched_suppliers']}")

        # Build siparis_no → order_id map (for items lookup by 'Sipariş' field)
        siparis_no_map = {
            o.siparis_no: o.id for o in db.query(ArchivePurchaseOrder).all() if o.siparis_no
        }
        # Knack'te bazı siparişler 'temp' olarak gelmiş olabilir — onları da dahil et
        for o in db.query(ArchivePurchaseOrder).all():
            if o.siparis_no:
                siparis_no_map.setdefault(o.siparis_no, o.id)

        print(f"\nItems import: {items_csv}")
        r2 = import_items(db, items_csv, siparis_no_map)
        print(f"  ✓ {r2['inserted']} eklendi, {r2['skipped']} zaten vardı, {r2['no_parent']} parent bulunamadı")

        # Unmatched products → CSV
        if r2["unmatched"]:
            out_path = "unmatched_products.csv"
            with open(out_path, "w", encoding="utf-8-sig", newline="") as f:
                w = csv.writer(f)
                w.writerow(["product_name", "total_qty_unmatched"])
                # Aggregate
                agg = {}
                for name, qty in r2["unmatched"]:
                    agg[name] = agg.get(name, 0) + qty
                for name, qty in sorted(agg.items(), key=lambda x: -x[1]):
                    w.writerow([name, qty])
            print(f"\n  ⚠ {len(r2['unmatched'])} item eşleşmedi → {out_path} (toplam {len(agg)} unique ürün)")

    finally:
        db.close()


if __name__ == "__main__":
    main()
