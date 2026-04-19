from fastapi import APIRouter, Depends, Query, HTTPException, UploadFile, File
from typing import Optional
from pydantic import BaseModel
from app.core.auth import get_current_user
from app.services import teamgram

router = APIRouter()


class CustomFieldUpdate(BaseModel):
    fields: dict  # {str(custom_field_id): value}


@router.get("")
async def list_orders(
    page: int = Query(1, ge=1),
    pagesize: int = Query(50, ge=1, le=200),
    status: Optional[str] = Query(None),  # open | closed | None(all)
    current_user=Depends(get_current_user),
):
    return await teamgram.get_orders(page=page, pagesize=pagesize, status=status)


@router.get("/{order_id}")
async def get_order(order_id: int, current_user=Depends(get_current_user)):
    return await teamgram.get_order(order_id)


@router.post("/{order_id}/payment-doc")
async def upload_payment_doc(
    order_id: int,
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
):
    content = await file.read()
    try:
        att = await teamgram.upload_payment_document(
            order_id, content, file.filename, file.content_type or "application/octet-stream"
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"url": att["Url"], "filename": att["FileName"]}


@router.put("/{order_id}/custom-fields")
async def update_custom_fields(
    order_id: int,
    data: CustomFieldUpdate,
    current_user=Depends(get_current_user),
):
    int_fields = {int(k): v for k, v in data.fields.items()}
    ok = await teamgram.update_order_custom_fields(order_id, int_fields)
    if not ok:
        raise HTTPException(status_code=502, detail="TeamGram güncellenemedi")
    return {"ok": True}



@router.get("/{order_id}/weblink")
async def get_order_weblink(order_id: int, current_user=Depends(get_current_user)):
    url = await teamgram.get_order_weblink(order_id)
    return {"url": url}


@router.post("/{order_id}/clear-invoice-flag")
async def clear_invoice_flag(order_id: int, current_user=Depends(get_current_user)):
    ok = await teamgram.clear_order_has_invoice(order_id)
    if not ok:
        raise HTTPException(status_code=502, detail="TeamGram güncellenemedi")
    return {"ok": True}
