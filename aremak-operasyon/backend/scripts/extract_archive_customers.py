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
    r"\b(LTD|ŞT[İI]|ŞİRKET|SIRKET|A\.?Ş\.?|AS\b|TİC|TIC|SAN|ANONİM|ANONIM|LİMİTED|LIMITED|INC|GMBH|VAKFI|DERNEĞİ|ÜNİVERSİTESİ|KOOP|HOLDING)",
    re.IGNORECASE,
)
ADDRESS_HINT_RE = re.compile(
    r"\b(MAH\.?|CAD\.?|CADDE|SOK\.?|SOKAK|BLV\.?|BULV\.?|NO\s*:|KAT\s*:|D\s*:|İLÇE|ŞEHİR|POSTA|VKN|VERG[İI]|TCKN|MERSİS|KEP|TEL\b|FAX|GSM)",
    re.IGNORECASE,
)


def _is_bold(fontname: str) -> bool:
    fn = (fontname or "").lower()
    return "bold" in fn or "heavy" in fn or "black" in fn or "-b" in fn


def extract_customer_from_pdf(pdf) -> str | None:
    """
    PDF'in ilk 2 sayfasından müşteri adını çıkar.
    Stratejisi:
      1. Char-level bold detection: SAYIN/ALICI/MUSTERI başlığı altındaki
         ardışık BOLD satırları al, ilk non-bold satırda dur (= adres başlangıcı).
      2. Bold tespit edilemezse fallback: text + suffix-based heuristic.
    """
    # Önce text'i al — header pozisyonu için
    text_pages = []
    pages_data = []
    try:
        for page in pdf.pages[:2]:
            text = page.extract_text() or ""
            text_pages.append(text)
            chars = page.chars or []
            pages_data.append((text, chars))
    except Exception:
        return None

    full_text = "\n".join(text_pages)

    # Header pozisyonunu bul
    header_match = None
    for pat in HEADER_PATTERNS:
        m = re.search(pat, full_text, flags=re.IGNORECASE)
        if m:
            header_match = m
            break
    if not header_match:
        return None

    # Hangi sayfada header var?
    page_idx = 0
    cumulative = 0
    for i, t in enumerate(text_pages):
        if cumulative + len(t) >= header_match.start():
            page_idx = i
            break
        cumulative += len(t) + 1

    text, chars = pages_data[page_idx]
    if not chars:
        return _fallback_heuristic(full_text, header_match)

    # Header'ın PDF'teki Y pozisyonunu yaklaşık tahmin
    # Char'ları satır-bazlı grupla (y koordinatı). pdfplumber'da top: sayfa üstü=0
    lines: list[list[dict]] = []
    sorted_chars = sorted(chars, key=lambda c: (c.get("top", 0), c.get("x0", 0)))
    for c in sorted_chars:
        if not lines or abs(c.get("top", 0) - lines[-1][0].get("top", 0)) > 3:
            lines.append([c])
        else:
            lines[-1].append(c)
    # Her satırı x0'a göre tekrar sırala (line içindeki char'lar sıralı olsun)
    for ln in lines:
        ln.sort(key=lambda c: c.get("x0", 0))

    # Header'ın bulunduğu satırı bul
    header_kw = [p.split("\\")[0].rstrip("[\\:s*").upper()[:6] for p in HEADER_PATTERNS]
    header_line_idx = None
    for i, ln in enumerate(lines):
        line_text = "".join(c.get("text", "") for c in ln).upper()
        if any(kw and kw in line_text for kw in ["SAYIN", "ALICI", "MÜŞTER", "MUSTER", "BILL T", "ATTN", "BUYER"]):
            header_line_idx = i
            break

    if header_line_idx is None:
        return _fallback_heuristic(full_text, header_match)

    # DEBUG: Header sonrası 12 satırı yazdır
    if "--verbose" in sys.argv:
        print(f"\n[VERBOSE] header_line_idx={header_line_idx}")
        for i in range(header_line_idx, min(header_line_idx + 12, len(lines))):
            ln = lines[i]
            line_text = "".join(c.get("text", "") for c in ln).strip()
            bold_count = sum(1 for c in ln if _is_bold(c.get("fontname", "")))
            is_b = bold_count >= max(1, len(ln) * 0.5)
            print(f"  [{i}] BOLD={is_b} top={ln[0].get('top',0):.1f} → {line_text[:90]}")

    # Header satırının altındaki BOLD satırları topla — multi-column layout için
    # tolerant: label satırlarını (Vergi No, Mersis, vs.) atla, address keyword'lerinde dur
    LABEL_RE = re.compile(r"^\s*(VERG[İI]\s*NO|VKN|TCKN|MERS[İI]S|T[İI]CARET\s*S[İI]C[İI]L|ADRES|TEL|FAX|E-?POSTA|E-?MAIL|KEP|FATURA\s*NO|TAR[İI]H|SENARYO)\s*[:.]?\s*$", re.IGNORECASE)

    bold_lines = []
    consecutive_non_bold = 0
    for i in range(header_line_idx + 1, min(header_line_idx + 15, len(lines))):
        ln = lines[i]
        if not ln:
            continue
        line_text = "".join(c.get("text", "") for c in ln).strip()
        if not line_text:
            continue

        # Label satırları (Vergi No, Mersis, vs.) — atla
        if LABEL_RE.match(line_text):
            continue
        # Adres anahtar kelimeleri = bitmek üzere
        if ADDRESS_HINT_RE.search(line_text):
            break

        bold_count = sum(1 for c in ln if _is_bold(c.get("fontname", "")))
        is_bold_line = bold_count >= max(1, len(ln) * 0.5)

        if is_bold_line:
            consecutive_non_bold = 0
            # Skip-able içerik kontrolü (label gibi)
            if is_skip(line_text):
                continue
            bold_lines.append(line_text)
        else:
            consecutive_non_bold += 1
            if consecutive_non_bold >= 3:
                break  # 3 ardışık non-bold = isim bitti
            # Bold değil ama satır kısa ve label gibi değilse de yine geç

    if bold_lines:
        result = " ".join(bold_lines).strip()
        # Header kelimesini çıkar (örn. "SAYIN Acme Ltd")
        for kw in ["SAYIN", "ALICI", "MÜŞTERİ", "MÜŞTER", "BILL TO", "BUYER"]:
            result = re.sub(rf"^{kw}\s*[:,]?\s*", "", result, flags=re.IGNORECASE).strip()
        # Cleanup: VKN/TCKN (10-11 hane sayılar), parantez içerikleri (vergi dairesi vs.)
        result = re.sub(r"\b\d{10,11}\b", "", result)        # VKN/TCKN
        result = re.sub(r"\([^)]*\)", "", result)              # (vergi dairesi)
        result = re.sub(r"\s+", " ", result).strip()           # fazla boşluk
        if len(result) >= 3:
            return result[:200]

    return _fallback_heuristic(full_text, header_match)


def _fallback_heuristic(text: str, header_match) -> str | None:
    """Bold bulunamazsa önceki suffix-based mantık."""
    after = text[header_match.end():header_match.end() + 600]
    lines = [l.strip() for l in after.split("\n")]
    idx0 = None
    for i, line in enumerate(lines):
        if not line or is_skip(line) or len(line) > 120:
            continue
        idx0 = i
        break
    if idx0 is None:
        return None
    result = lines[idx0]
    for j in range(idx0 + 1, min(idx0 + 3, len(lines))):
        nxt = lines[j]
        if not nxt:
            break
        if ADDRESS_HINT_RE.search(nxt):
            break
        if COMPANY_SUFFIX_RE.search(nxt) and len(nxt) <= 80:
            result = (result + " " + nxt).strip()
        else:
            break
    return result[:200]


def extract_customer_from_text(text: str) -> str | None:
    """Eski text-based API (geriye dönük). Bold detection için extract_customer_from_pdf kullan."""
    if not text:
        return None
    for pat in HEADER_PATTERNS:
        m = re.search(pat, text, flags=re.IGNORECASE)
        if m:
            return _fallback_heuristic(text, m)
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


def debug_pdf(pdf_path: Path):
    """PDF içeriğini ekrana yazdır (fontname dahil)."""
    print(f"\n=== DEBUG: {pdf_path} ===")
    with pdfplumber.open(pdf_path) as pdf:
        for pi, page in enumerate(pdf.pages[:2]):
            text = page.extract_text() or ""
            print(f"\n--- Sayfa {pi+1} TEXT (ilk 800 char) ---")
            print(text[:800])
            chars = page.chars or []
            print(f"\n--- Sayfa {pi+1} CHARS ({len(chars)} adet) — örnek 30 ---")
            for c in chars[:30]:
                print(f"  '{c.get('text','?')}' font={c.get('fontname','?')} top={c.get('top',0):.1f}")
            # Fontname dağılımı
            fonts = set(c.get('fontname') for c in chars)
            print(f"\n--- Unique fonts ({len(fonts)}): ---")
            for f in sorted(fonts, key=lambda x: x or ""):
                print(f"  {f}")


def main():
    dry_run = "--dry-run" in sys.argv
    debug = "--debug" in sys.argv
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
            if debug:
                debug_pdf(pdf_path)
            try:
                with pdfplumber.open(pdf_path) as pdf:
                    name = extract_customer_from_pdf(pdf)
            except Exception as e:
                print(f"  [{req.id}] PDF okunamadı: {e}")
                continue
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
