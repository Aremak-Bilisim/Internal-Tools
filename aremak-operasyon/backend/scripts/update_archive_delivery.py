"""
Arşiv siparişlerine teslim tarihi atar ve hepsini "Teslim Alındı" yapar.
- Items CSV'sinden her sipariş için max(Teslim Alınma Tarihi) hesaplanır.
- Hiç tarih yoksa order_date kullanılır.
- Tüm arşiv siparişlerinin is_received alanı True yapılır.

Kullanım:
    python scripts/update_archive_delivery.py <items_csv>
"""
import csv
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.core.database import SessionLocal
from app.models.archive_purchase import ArchivePurchaseOrder


def parse_date(s: str):
    if not s or not s.strip():
        return None
    try:
        return datetime.strptime(s.strip(), "%d/%m/%Y").strftime("%Y-%m-%d")
    except ValueError:
        return None


def main():
    if len(sys.argv) < 2:
        print("Kullanım: python scripts/update_archive_delivery.py <items_csv>")
        sys.exit(1)

    items_csv = sys.argv[1]
    db = SessionLocal()
    try:
        # Sipariş no -> max delivery date
        max_dates: dict[str, str] = {}
        with open(items_csv, "r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                siparis_no = (row.get("Sipariş") or "").strip()
                if not siparis_no:
                    continue
                d = parse_date(row.get("Teslim Alınma Tarihi"))
                if not d:
                    continue
                cur = max_dates.get(siparis_no)
                if not cur or d > cur:
                    max_dates[siparis_no] = d

        print(f"CSV'den {len(max_dates)} sipariş için teslim tarihi bulundu")

        all_orders = db.query(ArchivePurchaseOrder).all()
        updated_date = 0
        marked_received = 0
        for o in all_orders:
            new_date = max_dates.get(o.siparis_no or "")
            if new_date:
                o.delivery_date = new_date
                updated_date += 1
            elif not o.delivery_date and o.order_date:
                # Items'ta tarih yoksa order_date'i kullan
                o.delivery_date = o.order_date
                updated_date += 1
            if not o.is_received:
                o.is_received = True
                marked_received += 1
        db.commit()
        print(f"✓ {updated_date} siparişe teslim tarihi atandı")
        print(f"✓ {marked_received} sipariş Teslim Alındı işaretlendi")

    finally:
        db.close()


if __name__ == "__main__":
    main()
