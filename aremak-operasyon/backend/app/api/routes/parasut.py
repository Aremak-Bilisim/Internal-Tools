from fastapi import APIRouter, Depends, HTTPException
from app.core.auth import get_current_user
from app.services import parasut

router = APIRouter()


@router.get("/invoices")
async def list_invoices(current_user=Depends(get_current_user)):
    invoices = await parasut.get_invoices()
    return {"invoices": invoices}


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
