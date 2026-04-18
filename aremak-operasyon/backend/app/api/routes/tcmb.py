from fastapi import APIRouter, Depends
from datetime import date
from app.core.auth import get_current_user
from app.services import tcmb

router = APIRouter()


@router.get("/rates/{rate_date}")
async def exchange_rates(rate_date: date, current_user=Depends(get_current_user)):
    rates = await tcmb.get_rates(rate_date)
    return {"date": str(rate_date), "rates": rates}
