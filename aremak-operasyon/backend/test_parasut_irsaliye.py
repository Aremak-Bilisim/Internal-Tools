"""
Parasut shipment_document API field test.
Uses invoice 1083361361, creates irsaliye with all address fields,
reads back to verify, then waits for user to inspect before deleting.
"""
import asyncio
import httpx

BASE = "https://api.parasut.com"
COMPANY = "627949"

CLIENT_ID     = "yOTKDQxgZ0mj7akAwTcqSiEVm9CSsVmg4YE1Mij-txg"
CLIENT_SECRET = "TV-u5a6CJyWW-_40pqY0azL5hARGRHVJO1jbbAdPtYE"
USERNAME      = "muhasebe@aremak.com.tr"
PASSWORD      = "beka+C.313131"

TARGET_INVOICE_ID = "1083361361"


async def get_token():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(f"{BASE}/oauth/token", data={
            "grant_type": "password",
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "username": USERNAME,
            "password": PASSWORD,
            "redirect_uri": "urn:ietf:wg:oauth:2.0:oob",
        })
        r.raise_for_status()
        return r.json()["access_token"]


async def get_invoice_with_products(token):
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(
            f"{BASE}/v4/{COMPANY}/sales_invoices/{TARGET_INVOICE_ID}",
            headers={"Authorization": f"Bearer {token}"},
            params={"include": "contact,details,details.product"},
        )
        r.raise_for_status()
        data = r.json()

    inv = data["data"]
    included = {f"{i['type']}/{i['id']}": i for i in data.get("included", [])}

    inv_attrs = inv.get("attributes", {})
    print(f"   Fatura no : {inv_attrs.get('invoice_no') or inv_attrs.get('invoice_id')}")
    print(f"   Aciklama  : {inv_attrs.get('description')}")

    contact_rel = inv.get("relationships", {}).get("contact", {}).get("data")
    if not contact_rel:
        raise ValueError("Faturada contact yok")
    contact_id = contact_rel["id"]
    contact_obj = included.get(f"contacts/{contact_id}", {})
    contact_name = contact_obj.get("attributes", {}).get("name", contact_id)
    print(f"   Musteri   : {contact_name}  (id={contact_id})")

    irsaliye_desc = (
        inv_attrs.get("description")
        or inv_attrs.get("invoice_no")
        or inv_attrs.get("invoice_id")
        or ""
    )
    print(f"   irsaliye_desc olacak: {irsaliye_desc!r}")

    stock_movements = []
    for d_ref in inv["relationships"].get("details", {}).get("data", []):
        d = included.get(f"{d_ref['type']}/{d_ref['id']}", {})
        d_attrs = d.get("attributes", {})
        qty = float(d_attrs.get("quantity") or 0)
        if qty <= 0:
            continue
        prod_data = d.get("relationships", {}).get("product", {}).get("data")
        if not prod_data:
            continue
        prod_obj = included.get(f"products/{prod_data['id']}", {})
        prod_name = prod_obj.get("attributes", {}).get("name", prod_data["id"])
        print(f"   Stok: qty={qty}  urun={prod_name}")
        stock_movements.append({
            "type": "stock_movements",
            "attributes": {"quantity": qty, "inflow": False, "date": "2026-04-19"},
            "relationships": {
                "product": {"data": {"type": "products", "id": prod_data["id"]}},
                "warehouse": {"data": {"type": "warehouses", "id": "1000081985"}},
            },
        })

    if not stock_movements:
        raise ValueError("Bu faturada stok hareketi olusturulabilecek urun bulunamadi")

    return contact_id, stock_movements, irsaliye_desc


async def create_test_irsaliye(token, contact_id, stock_movements, irsaliye_desc):
    """Gercek adres bilgileriyle test irsaliyesi olustur."""
    attrs = {
        "inflow": False,
        "issue_date": "2026-04-19",
        "description": irsaliye_desc,
        # Sevkiyat (varis) adresi — uygulamamizin gonderdigi degerler
        "address":      "Ataturk Cad. No:5 Daire:3",
        "postal_code":  "06560",
        "district":     "Yenimahalle",
        "city":         "Ankara",
        # Cikis adresi (sabit depo)
        "company_address":      "Bestepe Mah. Nergis Sok. No:7/2",
        "company_postal_code":  "06560",
        "company_district":     "Yenimahalle",
        "company_city":         "Ankara",
    }

    payload = {
        "data": {
            "type": "shipment_documents",
            "attributes": attrs,
            "relationships": {
                "contact": {"data": {"type": "contacts", "id": contact_id}},
                "invoices": {"data": [{"type": "sales_invoices", "id": TARGET_INVOICE_ID}]},
                "stock_movements": {"data": stock_movements},
            },
        }
    }

    print(f"\n   Gonderilen attrs: {attrs}")

    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{BASE}/v4/{COMPANY}/shipment_documents",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/vnd.api+json"},
            json=payload,
        )
        print(f"\n--- CREATE response ({r.status_code}) ---")
        if not r.is_success:
            print("ERROR:", r.text[:2000])
            r.raise_for_status()
        doc_id = r.json()["data"]["id"]
        print(f"Created doc_id={doc_id}")
        return doc_id


async def read_irsaliye(token, doc_id):
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(
            f"{BASE}/v4/{COMPANY}/shipment_documents/{doc_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        r.raise_for_status()
        attrs = r.json()["data"]["attributes"]

    print("\n--- READ back key fields ---")
    checks = [
        "description",
        "address", "postal_code", "district", "city",
        "company_address", "company_postal_code", "company_district", "company_city",
    ]
    all_ok = True
    for f in checks:
        val = attrs.get(f)
        status = "OK" if val else "!! BOSH !!"
        if not val:
            all_ok = False
        print(f"  {f:30s} = {repr(val)[:70]}  {status}")

    return all_ok


async def delete_irsaliye(token, doc_id):
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.delete(
            f"{BASE}/v4/{COMPANY}/shipment_documents/{doc_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
    print(f"DELETE {r.status_code} -> {'Silindi' if r.is_success else r.text[:200]}")


async def main():
    print("1. Token aliniyor...")
    token = await get_token()
    print("   OK\n")

    print("2. Fatura bilgileri aliniyor (id=" + TARGET_INVOICE_ID + ")...")
    contact_id, stock_movements, irsaliye_desc = await get_invoice_with_products(token)

    print("\n3. Irsaliye olusturuluyor...")
    doc_id = await create_test_irsaliye(token, contact_id, stock_movements, irsaliye_desc)

    print("\n4. Irsaliye okunuyor (dogrulama)...")
    all_ok = await read_irsaliye(token, doc_id)

    parasut_url = f"https://uygulama.parasut.com/{COMPANY}/irsaliyeler/{doc_id}"
    print(f"\n   Parasut'te goruntule: {parasut_url}")
    print("\n   Lutfen irsaliyeyi Parasut'te kontrol edin.")
    input("   Silmek icin Enter'a basin...")

    print("\n5. Test irsaliyesi siliniyor...")
    await delete_irsaliye(token, doc_id)

    print("\n" + ("=== TUM ALANLAR DOGRU ===" if all_ok else "=== BAZI ALANLAR BOS! ==="))


asyncio.run(main())
