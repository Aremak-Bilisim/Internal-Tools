"""
Knack URL'lerinden arşiv siparişi PDF'lerini indirir, sunucuya kaydeder
ve archive_purchase_orders.local_pdf_url alanını günceller.

Kullanım:
    python scripts/download_archive_pdfs.py
"""
import os
import sys
from pathlib import Path
from urllib.parse import urlparse, unquote
import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.core.database import SessionLocal
from app.models.archive_purchase import ArchivePurchaseOrder

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads" / "purchase_orders" / "archive"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

PUBLIC_URL_PREFIX = "/uploads/purchase_orders/archive"


def safe_filename(record_id: str, knack_url: str) -> str:
    """archive_<record_id>_<original_basename>"""
    parsed = urlparse(knack_url)
    base = unquote(os.path.basename(parsed.path))
    if not base or not base.lower().endswith(".pdf"):
        base = "document.pdf"
    return f"archive_{record_id}_{base}"


def main():
    db = SessionLocal()
    downloaded = 0
    skipped = 0
    failed = []

    try:
        rows = db.query(ArchivePurchaseOrder).filter(
            ArchivePurchaseOrder.knack_pdf_url.isnot(None),
            ArchivePurchaseOrder.local_pdf_url.is_(None),
        ).all()
        print(f"İndirilecek PDF: {len(rows)}")

        with httpx.Client(timeout=60, follow_redirects=True) as client:
            for r in rows:
                fname = safe_filename(r.knack_record_id, r.knack_pdf_url)
                fpath = UPLOAD_DIR / fname
                if fpath.exists():
                    # Lokal dosya var ama DB'de path yok — sadece path'i set et
                    r.local_pdf_url = f"{PUBLIC_URL_PREFIX}/{fname}"
                    db.commit()
                    skipped += 1
                    continue
                try:
                    resp = client.get(r.knack_pdf_url)
                    resp.raise_for_status()
                    with open(fpath, "wb") as f:
                        f.write(resp.content)
                    r.local_pdf_url = f"{PUBLIC_URL_PREFIX}/{fname}"
                    db.commit()
                    downloaded += 1
                    if downloaded % 5 == 0:
                        print(f"  {downloaded} indirildi...")
                except Exception as e:
                    failed.append((r.id, r.siparis_no, str(e)[:120]))
                    print(f"  ✗ {r.siparis_no}: {e}")

        print(f"\n✓ {downloaded} PDF indirildi, {skipped} zaten vardı")
        if failed:
            print(f"⚠ {len(failed)} basarisiz:")
            for fid, sno, err in failed:
                print(f"    archive_id={fid} sipariş={sno} hata={err}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
