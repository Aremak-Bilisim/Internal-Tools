from fastapi import APIRouter, Depends, Query
from app.core.auth import get_current_user
from app.services import teamgram

router = APIRouter()


@router.get("")
async def list_products(
    page: int = Query(1, ge=1),
    pagesize: int = Query(50, ge=1, le=200),
    current_user=Depends(get_current_user),
):
    return await teamgram.get_products(page=page, pagesize=pagesize)


@router.get("/{product_id}")
async def get_product(product_id: int, current_user=Depends(get_current_user)):
    return await teamgram.get_product(product_id)


@router.get("/{product_id}/inventory")
async def get_inventory(product_id: int, current_user=Depends(get_current_user)):
    return await teamgram.get_product_inventory(product_id)
