from fastapi import APIRouter
from app.api.routes import auth, products, orders, shipments, users, webhook

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(products.router, prefix="/products", tags=["products"])
api_router.include_router(orders.router, prefix="/orders", tags=["orders"])
api_router.include_router(shipments.router, prefix="/shipments", tags=["shipments"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(webhook.router, prefix="/webhook", tags=["webhook"])
