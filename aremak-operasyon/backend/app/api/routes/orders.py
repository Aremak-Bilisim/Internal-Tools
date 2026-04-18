from fastapi import APIRouter, Depends, Query
from typing import Optional
from app.core.auth import get_current_user
from app.services import teamgram

router = APIRouter()


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


@router.get("/{order_id}/weblink")
async def get_order_weblink(order_id: int, current_user=Depends(get_current_user)):
    url = await teamgram.get_order_weblink(order_id)
    return {"url": url}
