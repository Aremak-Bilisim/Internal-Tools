import asyncio
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.auth import get_current_user
from app.models.teamgram_company import TeamgramCompany
from app.services import parasut

router = APIRouter()


@router.get("/taxpayer/{vkn}")
async def query_customer(vkn: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    vkn = vkn.strip()

    # 1. GİB vergi mükellefi bilgisi (Paraşüt taxpayer_data)
    gib_data = None
    try:
        import httpx
        from app.services.parasut import _get_token, BASE, COMPANY
        token = await _get_token()
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                f"{BASE}/v4/{COMPANY}/taxpayer_data/{vkn}",
                headers={"Authorization": f"Bearer {token}"}
            )
            if r.status_code == 200:
                gib_data = r.json()
    except Exception:
        pass

    # 2. Paraşüt müşteri kaydı (VKN ile)
    parasut_contact = None
    try:
        from app.services.parasut import _get_token, BASE, COMPANY
        import httpx
        token = await _get_token()
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                f"{BASE}/v4/{COMPANY}/contacts",
                headers={"Authorization": f"Bearer {token}"},
                params={"filter[tax_number]": vkn, "page[size]": 1}
            )
            if r.status_code == 200:
                items = r.json().get("data", [])
                if items:
                    a = items[0]["attributes"]
                    parasut_contact = {
                        "id": items[0]["id"],
                        "name": a.get("name"),
                        "tax_number": a.get("tax_number"),
                        "tax_office": a.get("tax_office"),
                        "city": a.get("city"),
                        "district": a.get("district"),
                        "address": a.get("address"),
                        "email": a.get("email"),
                        "account_type": a.get("account_type"),
                    }
    except Exception:
        pass

    # 3. TeamGram — local DB'den anında sorgula
    tg_row = db.query(TeamgramCompany).filter(TeamgramCompany.tax_no == vkn).first()
    tg_companies = []
    if tg_row:
        tg_companies = [{
            "id": tg_row.tg_id,
            "name": tg_row.name,
            "tax_no": tg_row.tax_no,
            "tax_office": tg_row.tax_office,
            "address": tg_row.address,
            "city": tg_row.city,
            "district": tg_row.district,
            "phone": tg_row.phone,
            "email": tg_row.email,
        }]

    return {
        "vkn": vkn,
        "gib": gib_data,
        "parasut": parasut_contact,
        "teamgram": tg_companies,
    }


@router.get("/tg-sync-status")
def tg_sync_status(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """TeamGram local DB durumu."""
    from app.services.tg_sync import _last_full_sync
    count = db.query(TeamgramCompany).count()
    return {
        "company_count": count,
        "last_sync": _last_full_sync.isoformat() if _last_full_sync else None,
    }
