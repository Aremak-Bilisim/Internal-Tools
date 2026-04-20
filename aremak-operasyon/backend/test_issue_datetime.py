import asyncio, httpx, datetime

BASE = 'https://api.parasut.com'
COMPANY = '627949'
INVOICE_ID = '1083361361'

CLIENT_ID     = "yOTKDQxgZ0mj7akAwTcqSiEVm9CSsVmg4YE1Mij-txg"
CLIENT_SECRET = "TV-u5a6CJyWW-_40pqY0azL5hARGRHVJO1jbbAdPtYE"
USERNAME      = "muhasebe@aremak.com.tr"
PASSWORD      = "beka+C.313131"

async def get_token():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(f"{BASE}/oauth/token", data={
            "grant_type": "password", "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET, "username": USERNAME,
            "password": PASSWORD, "redirect_uri": "urn:ietf:wg:oauth:2.0:oob",
        })
        r.raise_for_status()
        return r.json()["access_token"]

async def main():
    token = await get_token()
    headers_auth = {'Authorization': f'Bearer {token}'}
    headers = {**headers_auth, 'Content-Type': 'application/vnd.api+json'}

    # Fetch invoice
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f'{BASE}/v4/{COMPANY}/sales_invoices/{INVOICE_ID}',
                        headers=headers_auth,
                        params={'include': 'contact,details,details.product'})
        r.raise_for_status()
        data = r.json()

    inv = data['data']
    contact_id = inv['relationships']['contact']['data']['id']
    included = {f"{i['type']}/{i['id']}": i for i in data.get('included', [])}

    stock_movements = []
    for d_ref in inv['relationships'].get('details', {}).get('data', []):
        d = included.get(f"{d_ref['type']}/{d_ref['id']}", {})
        qty = float(d.get('attributes', {}).get('quantity') or 0)
        if qty <= 0: continue
        prod_data = d.get('relationships', {}).get('product', {}).get('data')
        if not prod_data: continue
        stock_movements.append({
            'type': 'stock_movements',
            'attributes': {'quantity': qty, 'inflow': False, 'date': '2026-04-19'},
            'relationships': {
                'product': {'data': {'type': 'products', 'id': prod_data['id']}},
                'warehouse': {'data': {'type': 'warehouses', 'id': '1000081985'}}
            }
        })

    now_utc = datetime.datetime.utcnow()
    issue_datetime_str = now_utc.strftime('%Y-%m-%dT%H:%M:%SZ')
    print(f'Gonderilen issue_datetime: {issue_datetime_str}')

    payload = {'data': {
        'type': 'shipment_documents',
        'attributes': {
            'inflow': False,
            'issue_date': '2026-04-19',
            'issue_datetime': issue_datetime_str,
            'shipment_date': '2026-04-19T12:00:00Z',
            'description': 'TEST issue_datetime',
        },
        'relationships': {
            'contact': {'data': {'type': 'contacts', 'id': contact_id}},
            'invoices': {'data': [{'type': 'sales_invoices', 'id': INVOICE_ID}]},
            'stock_movements': {'data': stock_movements},
        }
    }}

    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(f'{BASE}/v4/{COMPANY}/shipment_documents', headers=headers, json=payload)
        print(f'CREATE: {r.status_code}')
        if not r.is_success:
            print('ERROR:', r.text[:500])
            return
        doc_id = r.json()['data']['id']
        print(f'doc_id: {doc_id}')

    # Read back
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f'{BASE}/v4/{COMPANY}/shipment_documents/{doc_id}', headers=headers_auth)
        attrs = r.json()['data']['attributes']

    print(f"issue_date     : {attrs.get('issue_date')}")
    print(f"issue_datetime : {attrs.get('issue_datetime')}")
    print(f"shipment_date  : {attrs.get('shipment_date')}")

    # Delete
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.delete(f'{BASE}/v4/{COMPANY}/shipment_documents/{doc_id}', headers=headers_auth)
    print(f'DELETE: {r.status_code}')

asyncio.run(main())
