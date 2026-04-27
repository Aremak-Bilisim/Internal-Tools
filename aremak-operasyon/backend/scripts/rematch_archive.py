"""
Arşiv item'ları için yeniden ürün eşleştirme.
- product_id NULL olan tüm item'lar için lokal products tablosunda eşleşme dener
- Opsiyonel: rename mapping ile item adlarını değiştir önce eşleştir

Kullanım:
    python scripts/rematch_archive.py
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.database import SessionLocal
from app.models.product import Product
from app.models.archive_purchase import ArchivePurchaseItem


# Manuel rename mapping: eski_ad -> yeni_ad
RENAME_MAP = {
    "BP Filtre (640nm, D24*1mm)": "BP Filtre (640nm)",
}


def match_product(db, raw_name: str):
    if not raw_name:
        return None
    name = raw_name.strip()

    p = db.query(Product).filter(Product.prod_model.ilike(name)).first()
    if p:
        return p

    upper = name.upper()
    candidates = db.query(Product).filter(Product.prod_model.isnot(None)).all()
    for c in candidates:
        pm = (c.prod_model or "").strip().upper()
        if not pm:
            continue
        if pm == upper or pm in upper or upper in pm:
            return c

    p = db.query(Product).filter(Product.sku.ilike(f"%{name}%")).first()
    return p


def main():
    db = SessionLocal()
    try:
        # 1) Rename
        renamed = 0
        for old_name, new_name in RENAME_MAP.items():
            rows = db.query(ArchivePurchaseItem).filter(ArchivePurchaseItem.product_name == old_name).all()
            for r in rows:
                r.product_name = new_name
                renamed += 1
        if renamed:
            db.commit()
            print(f"✓ {renamed} item adi degistirildi")

        # 2) Eşleşmeyenleri tekrar match et
        unmatched = db.query(ArchivePurchaseItem).filter(ArchivePurchaseItem.product_id.is_(None)).all()
        print(f"Eslesmeyen item sayisi: {len(unmatched)}")

        matched = 0
        still_unmatched = {}
        for it in unmatched:
            p = match_product(db, it.product_name)
            if p:
                it.product_id = p.id
                matched += 1
                print(f"  ✓ {it.product_name} -> {p.brand} - {p.prod_model} (id={p.id})")
            else:
                still_unmatched[it.product_name] = still_unmatched.get(it.product_name, 0) + (it.quantity or 0)
        db.commit()
        print(f"\n✓ {matched} item eslestirildi")

        if still_unmatched:
            print(f"\n⚠ Hala eslesmeyen ({len(still_unmatched)} unique):")
            for name, qty in sorted(still_unmatched.items(), key=lambda x: -x[1]):
                print(f"    {name}: {qty}")

    finally:
        db.close()


if __name__ == "__main__":
    main()
