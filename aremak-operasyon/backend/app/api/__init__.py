from fastapi import APIRouter
from app.api.routes import auth, products, orders, shipments, users, webhook, parasut, tcmb, notifications, query, samples

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(products.router, prefix="/products", tags=["products"])
api_router.include_router(orders.router, prefix="/orders", tags=["orders"])
api_router.include_router(shipments.router, prefix="/shipments", tags=["shipments"])
api_router.include_router(samples.router, prefix="/samples", tags=["samples"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(webhook.router, prefix="/webhook", tags=["webhook"])
api_router.include_router(parasut.router, prefix="/parasut", tags=["parasut"])
api_router.include_router(tcmb.router, prefix="/tcmb", tags=["tcmb"])
api_router.include_router(notifications.router, prefix="/notifications", tags=["notifications"])
api_router.include_router(query.router, prefix="/query", tags=["query"])
