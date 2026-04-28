from fastapi import APIRouter, Depends, HTTPException
from app.core.auth import get_current_user
from app.services import parasut

router = APIRouter()


@router.get("/invoices")
async def list_invoices(current_user=Depends(get_current_user)):
    invoices = await parasut.get_invoices()
    return {"invoices": invoices}


@router.get("/invoices/{invoice_id}/details")
async def get_invoice_details(invoice_id: str, current_user=Depends(get_current_user)):
    details = await parasut.get_invoice_details(invoice_id)
    if not details:
        raise HTTPException(status_code=404, detail="Fatura bulunamadı")
    return details


@router.get("/invoices/{invoice_id}/pdf-url")
async def get_invoice_pdf_url(invoice_id: str, current_user=Depends(get_current_user)):
    url = await parasut.get_invoice_pdf_url(invoice_id)
    if not url:
        raise HTTPException(status_code=404, detail="PDF henüz hazır değil")
    return {"url": url}


@router.post("/invoices/refresh")
async def refresh_invoices(current_user=Depends(get_current_user)):
    await parasut.invalidate_cache()
    invoices = await parasut.get_invoices()
    return {"invoices": invoices, "count": len(invoices)}


@router.get("/invoices/by-vkn")
async def list_invoices_by_vkn(vkn: str, current_user=Depends(get_current_user)):
    """VKN ile Paraşüt'te cari bul, ona ait satış faturalarını tarihe göre azalan döndür."""
    if not vkn or not vkn.strip():
        return {"contact_id": None, "invoices": []}
    contact_id = await parasut.search_contact_by_tax_number(vkn.strip())
    if not contact_id:
        return {"contact_id": None, "invoices": []}
    invoices = await parasut.list_invoices_by_contact_id(contact_id)
    return {"contact_id": contact_id, "invoices": invoices}


@router.get("/irsaliyes/by-vkn")
async def list_irsaliyes_by_vkn(vkn: str, current_user=Depends(get_current_user)):
    """VKN ile Paraşüt'te cari bul, ona ait irsaliyeleri tarihe göre azalan döndür."""
    if not vkn or not vkn.strip():
        return {"contact_id": None, "irsaliyes": []}
    contact_id = await parasut.search_contact_by_tax_number(vkn.strip())
    if not contact_id:
        return {"contact_id": None, "irsaliyes": []}
    irsaliyes = await parasut.list_irsaliyes_by_contact_id(contact_id)
    return {"contact_id": contact_id, "irsaliyes": irsaliyes}


@router.get("/irsaliye/{irsaliye_id}")
async def get_irsaliye(irsaliye_id: str, current_user=Depends(get_current_user)):
    info = await parasut.get_irsaliye_info(irsaliye_id)
    if not info:
        raise HTTPException(status_code=404, detail="İrsaliye bulunamadı")
    return info


@router.get("/irsaliye/{irsaliye_id}/pdf-url")
async def get_irsaliye_pdf_url(irsaliye_id: str, current_user=Depends(get_current_user)):
    url = await parasut.get_irsaliye_pdf_url(irsaliye_id)
    if not url:
        raise HTTPException(status_code=404, detail="İrsaliye PDF'i henüz hazır değil")
    return {"url": url}


@router.get("/invoices/debug")
async def debug_invoices(current_user=Depends(get_current_user)):
    """Returns raw Paraşüt invoice list for debugging."""
    await parasut.invalidate_cache()
    invoices = await parasut.get_invoices()
    return {
        "count": len(invoices),
        "invoices": [
            {
                "id": inv["id"],
                "invoice_no": inv["invoice_no"],
                "contact_name": inv["contact_name"],
                "contact_tax_number": inv.get("contact_tax_number", ""),
                "issue_date": inv["issue_date"],
            }
            for inv in invoices[:20]
        ]
    }
