"""
Müşteri adı boş olan arşiv sevk taleplerinin fatura/irsaliye PDF'inden
müşteri adını çekip DB'ye yazar.

Kullanım:
    python scripts/extract_archive_customers.py [--dry-run]
"""
import io
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.database import SessionLocal
from app.models.archive_shipment import ArchiveShipmentRequest, ArchiveShipmentFile

import pdfplumber


UPLOAD_BASE = Path(__file__).resolve().parent.parent / "uploads" / "shipments" / "archive"


# Türkçe fatura/irsaliye başlıkları — sonrasında müşteri adı gelir
HEADER_PATTERNS = [
    r"SAYIN\s*[:\n]?",
    r"ALICI\s*[:\n]?",
    r"M[ÜU]ŞTER[İI]\s*[:\n]?",
    r"BILL\s*TO\s*[:\n]?",
    r"BUYER\s*[:\n]?",
    r"ATTN\s*[:\n]?",
    r"ALICI\s*B[İI]LG[İI]LER[İI]\s*[:\n]?",
]

# Anlamsız satırları skip et (etiket/header satırları)
SKIP_PATTERNS = [
    r"^\s*$",
    r"^[-=_~*]+$",
    r"^\d+$",  # sadece numara
    r"FATURA",
    r"İRSALİYE",
    r"IRSALIYE",
    r"VERG[İI]",
    r"VKN",
    r"TCKN",
    r"E-FATURA",
    r"E-?ARS[İI]V",
    r"NO\s*:",
    r"TAR[İI]H",
    r"DATE",
    r"SER[İI]\s*A",
    r"SAYFA",
    r"PAGE",
    r"^\(?ALICI",  # "ALICI BİLGİLERİ" başlığını skip et
    r"^MÜŞTERİ",
]


def is_skip(line: str) -> bool:
    s = line.strip()
    if not s or len(s) < 3:
        return True
    upper = s.upper()
    for p in SKIP_PATTERNS:
        if re.search(p, upper):
            return True
    return False


COMPANY_SUFFIX_RE = re.compile(
    r"\b(LTD|ŞT[İI]|A\.?Ş\.?|AS\b|TİC|TIC|SAN|ANONİM|LİMİTED|LIMITED|INC|GMBH|VAKFI|DERNEĞİ|ÜNİVERSİTESİ|KOOP)",
    re.IGNORECASE,
)
ADDRESS_HINT_RE = re.compile(
    r"\b(MAH\.?|CAD\.?|CADDE|SOK\.?|SOKAK|BLV\.?|BULV\.?|NO\s*:|KAT\s*:|D\s*:|İLÇE|ŞEHİR|POSTA|VKN|VERG[İI]|TCKN|MERSİS|KEP|TEL\b|FAX|GSM)",
    re.IGNORECASE,
)


def extract_customer_from_text(text: str) -> str | None:
    """PDF text'inden müşteri adı çıkarmaya çalış (multi-line birleştirme dahil)."""
    if not text:
        return None
    for pat in HEADER_PATTERNS:
        m = re.search(pat, text, flags=re.IGNORECASE)
        if not m:
            continue
        after = text[m.end():m.end() + 600]
        lines = [l.strip() for l in after.split("\n")]
        # İlk anlamlı satırı bul
        idx0 = None
        for i, line in enumerate(lines):
            if not line or is_skip(line) or len(line) > 120:
                continue
            idx0 = i
            break
        if idx0 is None:
            continue
        result = lines[idx0]
        # Sonraki 1-2 satırı kontrol et — şirket suffix devamı mı?
        for j in range(idx0 + 1, min(idx0 + 3, len(lines))):
            nxt = lines[j]
            if not nxt:
                break
            if ADDRESS_HINT_RE.search(nxt):
                break  # adres satırı geldi, dur
            if COMPANY_SUFFIX_RE.search(nxt) and len(nxt) <= 80:
                # Devam eden şirket adı satırı
                result = (result + " " + nxt).strip()
            else:
                break
        return result[:200]
    return None


def find_invoice_file(req: ArchiveShipmentRequest) -> Path | None:
    """Fatura > İrsaliye > Kargo Fişi sırası ile PDF dosya yolunu döner."""
    by_cat: dict[str, ArchiveShipmentFile] = {}
    for f in req.files:
        by_cat.setdefault(f.alan_adi, f)
    cand = by_cat.get("Fatura") or by_cat.get("İrsaliye") or by_cat.get("Kargo Fişi")
    if not cand:
        return None
    # public path: /uploads/shipments/archive/...
    rel = cand.yerel_yol.replace("/uploads/shipments/archive/", "", 1)
    full = UPLOAD_BASE / rel
    return full if full.exists() else None


def main():
    dry_run = "--dry-run" in sys.argv
    # --id <archive_id>  → tek kayıt test
    single_id = None
    if "--id" in sys.argv:
        idx = sys.argv.index("--id")
        if idx + 1 < len(sys.argv):
            single_id = int(sys.argv[idx + 1])

    db = SessionLocal()
    try:
        if single_id:
            q = db.query(ArchiveShipmentRequest).filter(ArchiveShipmentRequest.id == single_id)
            total = q.count()
            print(f"Tek kayıt test: archive_id={single_id} ({total} kayıt)")
        else:
            q = db.query(ArchiveShipmentRequest).filter(
                (ArchiveShipmentRequest.alici_adi.is_(None))
                | (ArchiveShipmentRequest.alici_adi == "")
                | (ArchiveShipmentRequest.alici_adi == "-")
                | (ArchiveShipmentRequest.alici_adi.ilike("(%"))
            )
            total = q.count()
            print(f"Boş alici_adi: {total} kayıt")

        ok = 0
        not_found = 0
        no_pdf = 0
        for i, req in enumerate(q.all(), start=1):
            pdf_path = find_invoice_file(req)
            if not pdf_path:
                no_pdf += 1
                continue
            try:
                with pdfplumber.open(pdf_path) as pdf:
                    text = ""
                    for page in pdf.pages[:2]:  # ilk 2 sayfa yeter
                        text += (page.extract_text() or "") + "\n"
            except Exception as e:
                print(f"  [{req.id}] PDF okunamadı: {e}")
                continue

            name = extract_customer_from_text(text)
            if name:
                ok += 1
                if not dry_run:
                    req.alici_adi = name
                if ok <= 5 or ok % 100 == 0:
                    print(f"  [{req.id}] → '{name}'")
            else:
                not_found += 1

            if i % 50 == 0:
                print(f"  ... {i}/{total} işlendi (eşleşen: {ok})")
                if not dry_run:
                    db.commit()

        if not dry_run:
            db.commit()
        print(f"\nÖzet: {ok} eklendi, {not_found} parse edilemedi, {no_pdf} PDF yok")
        if dry_run:
            print("(--dry-run modunda — DB'ye yazılmadı)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
