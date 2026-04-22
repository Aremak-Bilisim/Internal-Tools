from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.auth import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models.product import Product
from app.services import teamgram
from app.services import product_sync
from app.services import parasut as parasut_svc

router = APIRouter()

CURRENCY_NAME_TO_ID = {"TL": 1, "TRY": 1, "USD": 2, "EUR": 3}
CURRENCY_ID_TO_NAME = {1: "TL", 2: "USD", 3: "EUR"}

TG_DOMAIN = settings.TEAMGRAM_DOMAIN
PARASUT_COMPANY = settings.PARASUT_COMPANY_ID


def _to_dict(p: Product) -> dict:
    return {
        "id": p.id,
        "tg_id": p.tg_id,
        "brand": p.brand,
        "prod_model": p.prod_model,
        "sku": p.sku,
        "price": p.price,
        "currency_name": p.currency_name,
        "purchase_price": p.purchase_price,
        "purchase_currency_name": p.purchase_currency_name,
        "category_id": p.category_id,
        "category_name": p.category_name,
        "parent_category_id": p.parent_category_id,
        "parent_category_name": p.parent_category_name,
        "unit": p.unit,
        "vat": p.vat,
        "no_inventory": p.no_inventory,
        "inventory": p.inventory,
        "critical_inventory": p.critical_inventory,
        "details": p.details,
        "not_available": p.not_available,
        "tg_url": f"https://www.teamgram.com/{TG_DOMAIN}/products/show?id={p.tg_id}",
        "parasut_url": f"https://uygulama.parasut.com/{PARASUT_COMPANY}/stok/{p.parasut_id}" if p.parasut_id else None,
        "parasut_id": p.parasut_id,
    }


# ── LIST ──────────────────────────────────────────────────────────────────────

@router.get("")
async def list_products(
    page: int = Query(1, ge=1),
    pagesize: int = Query(50, ge=1, le=200),
    search: Optional[str] = Query(None),
    parent_category_id: Optional[int] = Query(None),
    category_id: Optional[int] = Query(None),
    in_stock: Optional[bool] = Query(None),
    not_available: Optional[bool] = Query(None),
    parasut_only: Optional[bool] = Query(None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    q = db.query(Product)
    if search:
        s = f"%{search}%"
        q = q.filter(
            Product.brand.ilike(s) |
            Product.prod_model.ilike(s) |
            Product.sku.ilike(s)
        )
    if parent_category_id is not None:
        q = q.filter(Product.parent_category_id == parent_category_id)
    if category_id is not None:
        q = q.filter(Product.category_id == category_id)
    if in_stock is True:
        q = q.filter(Product.inventory > 0, Product.no_inventory == False)
    if in_stock is False:
        q = q.filter(Product.inventory <= 0, Product.no_inventory == False)
    if not_available is not None:
        q = q.filter(Product.not_available == not_available)
    else:
        # Varsayılan: pasif ürünleri gösterme
        q = q.filter(Product.not_available == False)
    if parasut_only:
        q = q.filter(Product.parasut_id.isnot(None))

    total = q.count()
    items = q.order_by(Product.brand, Product.prod_model).offset((page - 1) * pagesize).limit(pagesize).all()
    return {"total": total, "page": page, "pagesize": pagesize, "items": [_to_dict(p) for p in items]}


# ── CATEGORIES ────────────────────────────────────────────────────────────────

@router.get("/categories")
async def get_categories(current_user=Depends(get_current_user)):
    meta = await teamgram.get_metadata()
    cats = meta.get("Categories", [])
    parents = [{"id": c["Id"], "name": c["Name"]} for c in cats if c.get("Level") == 0]
    children = [{"id": c["Id"], "name": c["Name"], "parent_id": c.get("ParentId")} for c in cats if c.get("Level") == 1]
    return {"parents": parents, "children": children}


# ── SYNC ──────────────────────────────────────────────────────────────────────

@router.post("/sync")
async def trigger_sync(
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    background_tasks.add_task(product_sync.full_sync)
    return {"message": "Ürün sync başlatıldı"}


# ── CREATE ────────────────────────────────────────────────────────────────────

class ProductCreate(BaseModel):
    brand: str
    prod_model: str
    sku: Optional[str] = None
    price: Optional[float] = None
    currency_name: Optional[str] = "TL"   # TL, USD, EUR
    purchase_price: Optional[float] = None
    purchase_currency_name: Optional[str] = "TL"
    category_id: Optional[int] = None
    unit: Optional[str] = "adet"
    vat: Optional[int] = 20
    no_inventory: bool = False
    critical_inventory: int = 0
    details: Optional[str] = None
    not_available: bool = False


@router.post("")
async def create_product(
    body: ProductCreate,
    current_user=Depends(get_current_user),
):
    currency_id = CURRENCY_NAME_TO_ID.get((body.currency_name or "TL").upper(), 1)
    purchase_currency_id = CURRENCY_NAME_TO_ID.get((body.purchase_currency_name or "TL").upper(), 1)

    payload = {
        "Brand": body.brand,
        "ProdModel": body.prod_model,
        "Sku": body.sku or "",
        "Price": body.price or 0.0,
        "CurrencyId": currency_id,
        "PurchasePrice": body.purchase_price or 0.0,
        "PurchaseCurrencyId": purchase_currency_id,
        "Details": body.details or "",
        "CategoryId": body.category_id or 0,
        "Unit": body.unit or "adet",
        "Vat": body.vat or 20,
        "NoInventory": body.no_inventory,
        "CriticalInventory": body.critical_inventory,
        "NotAvaliable": body.not_available,
        "WritersIdToString": ["0|WholeCompany"],
        "ReadersIdToString": [],
        "OwnerId": 0,
    }

    result = await teamgram.create_product(payload)
    if not result.get("Result") or not result.get("Id"):
        raise HTTPException(status_code=500, detail=f"TeamGram ürün oluşturma hatası: {result}")

    tg_id = result["Id"]
    # DB'ye kaydet (sync ile de gelir ama anında yap)
    await product_sync.sync_one(tg_id)

    return {"tg_id": tg_id, "message": "Ürün oluşturuldu"}


# ── GET ONE ───────────────────────────────────────────────────────────────────

@router.get("/{product_id}")
async def get_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    p = db.query(Product).filter(Product.tg_id == product_id).first()
    if not p:
        # Fallback: TG'den çek
        try:
            tg = await teamgram.get_product(product_id)
            return tg
        except Exception:
            raise HTTPException(status_code=404, detail="Ürün bulunamadı")
    return _to_dict(p)


# ── EDIT ──────────────────────────────────────────────────────────────────────

class ProductEdit(BaseModel):
    brand: Optional[str] = None
    prod_model: Optional[str] = None
    sku: Optional[str] = None
    price: Optional[float] = None
    currency_name: Optional[str] = None
    purchase_price: Optional[float] = None
    purchase_currency_name: Optional[str] = None
    category_id: Optional[int] = None
    unit: Optional[str] = None
    vat: Optional[int] = None
    no_inventory: Optional[bool] = None
    critical_inventory: Optional[int] = None
    details: Optional[str] = None
    not_available: Optional[bool] = None


@router.put("/{product_id}")
async def edit_product(
    product_id: int,
    body: ProductEdit,
    current_user=Depends(get_current_user),
):
    # TG'den mevcut edit payload'ını al
    try:
        edit_payload = await teamgram.get_product_edit_payload(product_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Ürün bulunamadı: {e}")

    # Gönderilen alanları güncelle
    if body.brand is not None:
        edit_payload["Brand"] = body.brand
    if body.prod_model is not None:
        edit_payload["ProdModel"] = body.prod_model
    if body.sku is not None:
        edit_payload["Sku"] = body.sku
    if body.price is not None:
        edit_payload["Price"] = body.price
    if body.currency_name is not None:
        edit_payload["CurrencyId"] = CURRENCY_NAME_TO_ID.get(body.currency_name.upper(), 1)
    if body.purchase_price is not None:
        edit_payload["PurchasePrice"] = body.purchase_price
    if body.purchase_currency_name is not None:
        edit_payload["PurchaseCurrencyId"] = CURRENCY_NAME_TO_ID.get(body.purchase_currency_name.upper(), 1)
    if body.category_id is not None:
        edit_payload["CategoryId"] = body.category_id
    if body.unit is not None:
        edit_payload["Unit"] = body.unit
    if body.vat is not None:
        edit_payload["Vat"] = body.vat
    if body.no_inventory is not None:
        edit_payload["NoInventory"] = body.no_inventory
    if body.critical_inventory is not None:
        edit_payload["CriticalInventory"] = body.critical_inventory
    if body.details is not None:
        edit_payload["Details"] = body.details
    if body.not_available is not None:
        edit_payload["NotAvaliable"] = body.not_available

    result = await teamgram.edit_product(edit_payload)
    if not result.get("Result"):
        raise HTTPException(status_code=500, detail=f"TeamGram güncelleme hatası: {result}")

    # DB güncelle
    await product_sync.sync_one(product_id)

    return {"message": "Ürün güncellendi"}


# ── PARAŞÜT KONTROL ──────────────────────────────────────────────────────────

@router.get("/{product_id}/parasut")
async def check_parasut(
    product_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Ürünün SKU'su ile Paraşüt'te ürün ara. Bulunursa parasut_id DB'ye yaz."""
    p = db.query(Product).filter(Product.tg_id == product_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Ürün bulunamadı")
    if not p.sku:
        return {"found": False, "message": "SKU boş, arama yapılamadı"}

    result = await parasut_svc.search_product_by_code(p.sku)
    if result:
        p.parasut_id = result["id"]
        db.commit()
        return {
            "found": True,
            "parasut_id": result["id"],
            "name": result["name"],
            "code": result["code"],
            "url": result["url"],
        }
    return {"found": False, "message": f"'{p.sku}' stok kodu Paraşüt'te bulunamadı"}


# ── INVENTORY ─────────────────────────────────────────────────────────────────

@router.get("/{product_id}/inventory")
async def get_inventory(product_id: int, current_user=Depends(get_current_user)):
    return await teamgram.get_product_inventory(product_id)
