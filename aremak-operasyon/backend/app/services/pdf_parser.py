"""
Proforma Invoice PDF parser.
Şu an Hikrobot proformasını parse ediyor; başka tedarikçiler için detect_supplier
ve _parse_hikrobot eklenebilir.
"""
from typing import Optional
import io
import re
import pdfplumber


def detect_supplier(text: str) -> Optional[str]:
    """PDF metninin ilk 1000 karakterinden tedarikçi adını tespit eder."""
    head = (text or "")[:1500].lower()
    if "hikrobot" in head:
        return "Hikrobot"
    return None


def _to_float(s: str) -> Optional[float]:
    if s is None:
        return None
    s = str(s).strip().replace(",", "")
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def parse_proforma(file_bytes: bytes) -> dict:
    """
    Proforma PDF'ini parse eder. Dönüş:
    {
      "supplier": "Hikrobot" | None,
      "raw_text": "...",
      "po_no": "A2603...",
      "items": [
        {"item_no": 1, "product_name": "...", "description": "...",
         "quantity": 20.0, "unit": "EA", "unit_price": 4.20, "amount": 84.00}
      ],
      "total_quantity": 245.0,
      "total_amount": 15404.00,
      "currency": "USD",
    }
    """
    items: list[dict] = []
    full_text = ""
    po_no = None

    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            full_text += text + "\n"

            # Tabloları çıkar
            for table in page.extract_tables() or []:
                if not table or len(table) < 2:
                    continue
                header = [(_clean(c) or "").lower() for c in (table[0] or [])]
                # "Product Model & Description" ve "Quantity" içeren tablo arıyoruz
                if not any("product model" in (h or "") for h in header):
                    continue

                # Kolon indekslerini bul
                idx_no = next((i for i, h in enumerate(header) if h.startswith("item")), 0)
                idx_name = next((i for i, h in enumerate(header) if "product model" in h), 1)
                idx_desc = next((i for i, h in enumerate(header)
                                 if "description" in h and "product model" not in h), -1)
                idx_qty = next((i for i, h in enumerate(header) if h == "quantity" or h.startswith("quantit")), 3)
                idx_unit = next((i for i, h in enumerate(header) if h == "unit"), -1)
                idx_price = next((i for i, h in enumerate(header) if "unit" in h and "price" in h), -1)
                idx_amount = next((i for i, h in enumerate(header) if "amount" in h), -1)

                for row in table[1:]:
                    if not row or len(row) < 4:
                        continue
                    item_no_raw = _clean(row[idx_no] if idx_no < len(row) else "")
                    if not re.match(r"^\d+$", item_no_raw or ""):
                        # TOTAL satırı vs. atla
                        continue
                    name = _clean(row[idx_name] if idx_name < len(row) else "")
                    desc = _clean(row[idx_desc]) if 0 <= idx_desc < len(row) else None
                    qty = _to_float(row[idx_qty]) if idx_qty < len(row) else None
                    unit = _clean(row[idx_unit]) if 0 <= idx_unit < len(row) else None
                    price = _to_float(row[idx_price]) if 0 <= idx_price < len(row) else None
                    amount = _to_float(row[idx_amount]) if 0 <= idx_amount < len(row) else None

                    if not name or qty is None:
                        continue
                    items.append({
                        "item_no": int(item_no_raw),
                        "product_name": name,
                        "description": desc or None,
                        "quantity": qty,
                        "unit": unit or "EA",
                        "unit_price": price,
                        "amount": amount,
                    })

    # PO no
    m = re.search(r"PO\s*NO\.?\s*[:\s]\s*([A-Z0-9]+)", full_text, re.IGNORECASE)
    if m:
        po_no = m.group(1)

    # Para birimi (Amount(USD) ipucu) — varsayılan USD
    currency = "USD" if "USD" in full_text else "USD"

    total_qty = sum(it["quantity"] for it in items if it.get("quantity") is not None)
    total_amount = sum(it["amount"] for it in items if it.get("amount") is not None)

    return {
        "supplier": detect_supplier(full_text),
        "po_no": po_no,
        "items": items,
        "total_quantity": total_qty,
        "total_amount": total_amount,
        "currency": currency,
    }
