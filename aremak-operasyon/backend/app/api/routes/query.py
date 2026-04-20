import asyncio
import httpx
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.auth import get_current_user
from app.models.teamgram_company import TeamgramCompany
from app.services import parasut
from app.services.parasut import _get_token, BASE, COMPANY
from app.services import teamgram as tg_svc
from app.services.tg_sync import _company_to_dict, _upsert
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_address_str(gib: dict) -> str:
    """GİB adres bilgisinden tek satır adres üretir."""
    infos = gib.get("addressInformation") or []
    if not infos:
        return ""
    a = infos[0]
    parts = [
        a.get("neighborhood") or "",
        a.get("street") or "",
        (f"No:{a.get('exteriorDoorNumber', '')} "
         f"{('İç:' + a['interiorDoorNo']) if a.get('interiorDoorNo') else ''}").strip() or "",
    ]
    return " ".join(p for p in parts if p).strip()


def _gib_to_parasut_attrs(gib: dict) -> dict:
    infos = gib.get("addressInformation") or [{}]
    a = infos[0]
    address_parts = [
        a.get("neighborhood") or "",
        a.get("street") or "",
        (f"No:{a.get('exteriorDoorNumber', '')} "
         f"{('İç:' + a['interiorDoorNo']) if a.get('interiorDoorNo') else ''}").strip() or "",
    ]
    return {
        "name": gib.get("identityTitle") or gib.get("title") or "",
        "tax_number": gib.get("taxIdentificationNumber") or "",
        "tax_office": gib.get("taxOfficeName") or "",
        "city": a.get("city") or "",
        "district": a.get("county") or "",
        "address": " ".join(p for p in address_parts if p).strip(),
        "account_type": "customer",
        "contact_type": "company",
        "exchange_rate_type": "selling",
    }


def _gib_to_tg_payload(gib: dict, tg_id: Optional[int] = None) -> dict:
    infos = gib.get("addressInformation") or [{}]
    a = infos[0]
    address = _build_address_str(gib)
    payload: dict = {
        "Name": gib.get("identityTitle") or gib.get("title") or "",
        "TaxNo": gib.get("taxIdentificationNumber") or "",
        "TaxOffice": gib.get("taxOfficeName") or "",
        "CityName": a.get("city") or "",
        "StateName": a.get("county") or "",
        "BasicRelationTypes": ["Customer"],
    }
    if address:
        payload["ContactInfoList"] = [{"Type": "Address", "Value": address}]
    if tg_id is not None:
        payload["Id"] = tg_id
    return payload


# ---------------------------------------------------------------------------
# GET /taxpayer/{vkn}  — sorgulama
# ---------------------------------------------------------------------------

@router.get("/taxpayer/{vkn}")
async def query_customer(vkn: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    vkn = vkn.strip()

    # 1. GİB vergi mükellefi bilgisi (Paraşüt taxpayer_data)
    gib_data = None
    try:
        token = await _get_token()
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                f"{BASE}/v4/{COMPANY}/taxpayer_data/{vkn}",
                headers={"Authorization": f"Bearer {token}"}
            )
            if r.status_code == 200:
                gib_data = r.json()
    except Exception as e:
        logger.warning(f"GİB sorgusu başarısız: {e}")

    # 2. Paraşüt müşteri kaydı (VKN ile)
    parasut_contact = None
    try:
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
    except Exception as e:
        logger.warning(f"Paraşüt sorgusu başarısız: {e}")

    # 3. TeamGram — local DB'den bul, sonra canlı doğrula (silinmiş kayıtları temizle)
    tg_row = db.query(TeamgramCompany).filter(TeamgramCompany.tax_no == vkn).first()
    tg_companies = []
    if tg_row:
        try:
            live = await tg_svc._get(f"{tg_svc.DOMAIN}/Companies/Get", {"id": tg_row.tg_id})
            if live and live.get("Id"):
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
            else:
                # TeamGram'da artık yok — local DB'den de sil
                db.delete(tg_row)
                db.commit()
                logger.info(f"Silinen TeamGram firması local DB'den temizlendi: {tg_row.tg_id}")
        except Exception as e:
            logger.warning(f"TeamGram canlı doğrulama hatası: {e}")
            # Hata durumunda local DB'deki veriyi göster
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


# ---------------------------------------------------------------------------
# GET /search  — Ünvan ile firma ara (TG local DB + Paraşüt)
# ---------------------------------------------------------------------------

@router.get("/search")
async def search_by_name(q: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    q = q.strip()
    if not q:
        return {"teamgram": [], "parasut": []}

    # TeamGram local DB
    tg_rows = (
        db.query(TeamgramCompany)
        .filter(TeamgramCompany.name.ilike(f"%{q}%"))
        .order_by(TeamgramCompany.name)
        .limit(30)
        .all()
    )
    tg_results = [
        {"id": r.tg_id, "name": r.name, "tax_no": r.tax_no,
         "city": r.city, "district": r.district, "phone": r.phone, "email": r.email}
        for r in tg_rows
    ]

    # Paraşüt
    parasut_results = []
    try:
        token = await _get_token()
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                f"{BASE}/v4/{COMPANY}/contacts",
                headers={"Authorization": f"Bearer {token}"},
                params={"filter[query]": q, "page[size]": 20}
            )
            if r.status_code == 200:
                for item in r.json().get("data", []):
                    a = item["attributes"]
                    parasut_results.append({
                        "id": item["id"],
                        "name": a.get("name"),
                        "tax_number": a.get("tax_number"),
                        "city": a.get("city"),
                        "district": a.get("district"),
                        "email": a.get("email"),
                    })
    except Exception as e:
        logger.warning(f"Paraşüt arama hatası: {e}")

    return {"teamgram": tg_results, "parasut": parasut_results}


# ---------------------------------------------------------------------------
# POST /parasut/add  — Paraşüt'e yeni müşteri ekle
# ---------------------------------------------------------------------------

@router.post("/parasut/add")
async def add_to_parasut(body: dict, current_user=Depends(get_current_user)):
    gib = body.get("gib")
    if not gib:
        raise HTTPException(400, "GİB verisi eksik")
    attrs = _gib_to_parasut_attrs(gib)
    try:
        token = await _get_token()
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                f"{BASE}/v4/{COMPANY}/contacts",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={"data": {"type": "contacts", "attributes": attrs}}
            )
            if r.status_code not in (200, 201):
                raise HTTPException(502, f"Paraşüt hatası: {r.text[:200]}")
            data = r.json().get("data", {})
            return {"ok": True, "id": data.get("id"), "name": data.get("attributes", {}).get("name")}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Paraşüt ekleme hatası: {e}")
        raise HTTPException(502, str(e))


# ---------------------------------------------------------------------------
# POST /parasut/{contact_id}/update  — Paraşüt kaydını GİB ile güncelle
# ---------------------------------------------------------------------------

@router.post("/parasut/{contact_id}/update")
async def update_parasut(contact_id: str, body: dict, current_user=Depends(get_current_user)):
    gib = body.get("gib")
    if not gib:
        raise HTTPException(400, "GİB verisi eksik")
    attrs = _gib_to_parasut_attrs(gib)
    # account_type güncelleme sırasında göndermiyoruz (Paraşüt değişime izin vermez)
    attrs.pop("account_type", None)
    attrs.pop("contact_type", None)
    try:
        token = await _get_token()
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.put(
                f"{BASE}/v4/{COMPANY}/contacts/{contact_id}",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={"data": {"id": contact_id, "type": "contacts", "attributes": attrs}}
            )
            if r.status_code not in (200, 201):
                raise HTTPException(502, f"Paraşüt hatası: {r.text[:200]}")
            return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Paraşüt güncelleme hatası: {e}")
        raise HTTPException(502, str(e))


# ---------------------------------------------------------------------------
# POST /teamgram/add  — TeamGram'a yeni firma ekle
# ---------------------------------------------------------------------------

@router.post("/teamgram/add")
async def add_to_teamgram(body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    gib = body.get("gib")
    if not gib:
        raise HTTPException(400, "GİB verisi eksik")
    payload = _gib_to_tg_payload(gib)
    try:
        result = await tg_svc._post(f"{tg_svc.DOMAIN}/Companies/Create", payload)
        if not result or not result.get("Result"):
            msg = result.get("Message", "Bilinmeyen hata") if result else "Yanıt alınamadı"
            raise HTTPException(502, f"TeamGram hatası: {msg}")
        new_id = result.get("Id")
        # Local DB'ye de ekle
        if new_id:
            c = await tg_svc._get(f"{tg_svc.DOMAIN}/Companies/Get", {"id": new_id})
            if c and c.get("Id"):
                _upsert(db, _company_to_dict(c))
                db.commit()
        return {"ok": True, "id": new_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"TeamGram ekleme hatası: {e}")
        raise HTTPException(502, str(e))


# ---------------------------------------------------------------------------
# POST /teamgram/{tg_id}/update  — TeamGram firmasını GİB ile güncelle
# ---------------------------------------------------------------------------

@router.post("/teamgram/{tg_id}/update")
async def update_teamgram(tg_id: int, body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    gib = body.get("gib")
    if not gib:
        raise HTTPException(400, "GİB verisi eksik")
    try:
        # Önce mevcut kaydı çek (zorunlu alanlar korunsun)
        existing = await tg_svc._get(f"{tg_svc.DOMAIN}/Companies/Edit", {"id": tg_id})
        if not existing:
            raise HTTPException(404, "TeamGram'da firma bulunamadı")

        # Mevcut kaydı olduğu gibi al, sadece GİB'den gelen alanları güncelle
        infos = gib.get("addressInformation") or [{}]
        a = infos[0]

        payload = dict(existing)  # tüm mevcut alanları koru
        payload["Id"] = tg_id
        payload["Name"] = gib.get("identityTitle") or gib.get("title") or existing.get("Name")
        payload["TaxNo"] = gib.get("taxIdentificationNumber") or existing.get("TaxNo")
        payload["TaxOffice"] = gib.get("taxOfficeName") or existing.get("TaxOffice")
        if a.get("city"):
            payload["CityName"] = a.get("city")
        if a.get("county"):
            payload["StateName"] = a.get("county")
        gib_address = _build_address_str(gib)
        if gib_address:
            payload["Address"] = gib_address
        # DeliveryAddressId boş teslimat adresi yaratır, ContactInfoList yeni kayıt açar — ikisini çıkar
        # AddressId korunur: mevcut adres contact info'sunu günceller
        payload.pop("DeliveryAddressId", None)
        payload.pop("ContactInfoList", None)
        result = await tg_svc._post(f"{tg_svc.DOMAIN}/Companies/Edit", payload)
        logger.info(f"TeamGram Edit yanıtı: {result}")
        if not result or not result.get("Result"):
            msg = result.get("Message", "Bilinmeyen hata") if result else "Yanıt alınamadı"
            raise HTTPException(502, f"TeamGram hatası: {msg}")

        # Local DB güncelle
        c = await tg_svc._get(f"{tg_svc.DOMAIN}/Companies/Get", {"id": tg_id})
        if c and c.get("Id"):
            _upsert(db, _company_to_dict(c))
            db.commit()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"TeamGram güncelleme hatası: {e}")
        raise HTTPException(502, str(e))


# ---------------------------------------------------------------------------
# GET /customer/meta  — Form için TeamGram seçenek listeleri
# ---------------------------------------------------------------------------

@router.get("/customer/meta")
async def customer_meta(current_user=Depends(get_current_user)):
    """Sektörler, kanallar ve ilişki tipleri."""
    try:
        meta = await tg_svc._get(f"{tg_svc.DOMAIN}/ScheduledRequests/MetaData")
        industries = [{"id": i["Id"], "name": i["Name"]} for i in meta.get("Industries", [])]
        channels = [{"id": c["Id"], "name": c["Name"]} for c in meta.get("CustomChannelsLead", [])]
        relation_types = [
            {"value": "Customer", "label": "Müşteri"},
            {"value": "PotentialCustomer", "label": "Potansiyel Müşteri"},
            {"value": "Supplier", "label": "Tedarikçi"},
            {"value": "Other", "label": "Diğer"},
        ]
        return {"industries": industries, "channels": channels, "relation_types": relation_types}
    except Exception as e:
        logger.error(f"Metadata hatası: {e}")
        raise HTTPException(502, str(e))


# ---------------------------------------------------------------------------
# POST /customer/create  — Formdan yeni müşteri oluştur (TG + opsiyonel Paraşüt)
# ---------------------------------------------------------------------------

@router.post("/customer/create")
async def create_customer(body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """
    body: {
      name, tax_no, tax_office, address, district, city, phone, email, website,
      musteri_tipi, indirim_seviyesi, kullanici_tipi,
      also_parasut: bool
    }
    """
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Firma adı zorunludur")

    contact_info_list = []
    if body.get("phone"):
        contact_info_list.append({"Type": "Phone", "Value": body["phone"]})
    if body.get("email"):
        contact_info_list.append({"Type": "Email", "Value": body["email"]})
    if body.get("website"):
        contact_info_list.append({"Type": "Website", "Value": body["website"]})

    custom_field_datas = []
    if body.get("musteri_tipi"):
        custom_field_datas.append({"CustomFieldId": 192253, "Value": body["musteri_tipi"]})
    if body.get("indirim_seviyesi") is not None:
        custom_field_datas.append({"CustomFieldId": 192610, "Value": str(body["indirim_seviyesi"])})
    if body.get("kullanici_tipi"):
        custom_field_datas.append({"CustomFieldId": 192611, "Value": body["kullanici_tipi"]})

    basic_relation_types = body.get("basic_relation_types") or ["Customer"]

    tg_payload = {
        "Name": name,
        "TaxNo": body.get("tax_no") or "",
        "TaxOffice": body.get("tax_office") or "",
        "CityName": body.get("city") or "",
        "StateName": body.get("district") or "",
        "Address": body.get("address") or "",   # top-level adres alanı
        "BasicRelationTypes": basic_relation_types,
        "ContactInfoList": contact_info_list or None,
        "CustomFieldDatas": custom_field_datas or None,
        "Description": body.get("description") or None,
        "DefaultDueDays": body.get("default_due_days") or None,
        "IndustryIds": body.get("industry_ids") or None,
        "CustomChannelId": body.get("channel_id") or None,
    }

    try:
        tg_result = await tg_svc._post(f"{tg_svc.DOMAIN}/Companies/Create", tg_payload)
        if not tg_result or not tg_result.get("Result"):
            msg = tg_result.get("Message", "Bilinmeyen hata") if tg_result else "Yanıt alınamadı"
            raise HTTPException(502, f"TeamGram hatası: {msg}")
        new_tg_id = tg_result.get("Id")
        if new_tg_id:
            c = await tg_svc._get(f"{tg_svc.DOMAIN}/Companies/Get", {"id": new_tg_id})
            if c and c.get("Id"):
                from app.services.tg_sync import _company_to_dict, _upsert
                _upsert(db, _company_to_dict(c))
                db.commit()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Müşteri oluşturma (TG) hatası: {e}")
        raise HTTPException(502, str(e))

    parasut_id = None
    if body.get("also_parasut"):
        try:
            attrs = {
                "name": name,
                "tax_number": body.get("tax_no") or "",
                "tax_office": body.get("tax_office") or "",
                "city": body.get("city") or "",
                "district": body.get("district") or "",
                "address": body.get("address") or "",
                "account_type": "customer",
                "contact_type": "company",
                "exchange_rate_type": "selling",
                "zip_code": body.get("zip_code") or None,
            }
            token = await _get_token()
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.post(
                    f"{BASE}/v4/{COMPANY}/contacts",
                    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                    json={"data": {"type": "contacts", "attributes": attrs}}
                )
                if r.status_code in (200, 201):
                    parasut_id = r.json().get("data", {}).get("id")
        except Exception as e:
            logger.warning(f"Paraşüt oluşturma hatası (devam edildi): {e}")

    return {"ok": True, "tg_id": new_tg_id, "parasut_id": parasut_id}


# ---------------------------------------------------------------------------
# GET /tg-sync-status
# ---------------------------------------------------------------------------

@router.get("/tg-sync-status")
def tg_sync_status(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """TeamGram local DB durumu."""
    from app.services.tg_sync import _last_full_sync
    count = db.query(TeamgramCompany).count()
    return {
        "company_count": count,
        "last_sync": _last_full_sync.isoformat() if _last_full_sync else None,
    }
