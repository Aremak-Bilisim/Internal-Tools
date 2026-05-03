import asyncio
import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.core.config import settings
from app.core.database import Base, engine
from app.api import api_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

# Tüm modelleri yükle (create_all için)
from app.models import user, shipment, notification, teamgram_company, product, sample, purchase_match, purchase_document, purchase_receipt_document, archive_purchase, hepsiburada_order, archive_shipment  # noqa
Base.metadata.create_all(bind=engine)

# Column-level migrations for existing tables
def _run_migrations():
    from sqlalchemy import text, inspect
    with engine.connect() as conn:
        insp = inspect(engine)
        notif_cols = {c["name"] for c in insp.get_columns("notifications")}
        if "sample_id" not in notif_cols:
            conn.execute(text("ALTER TABLE notifications ADD COLUMN sample_id INTEGER REFERENCES sample_requests(id)"))
            conn.commit()
        if "product_id" not in notif_cols:
            conn.execute(text("ALTER TABLE notifications ADD COLUMN product_id INTEGER REFERENCES products(id)"))
            conn.commit()
        # archive_purchase_orders ek kolonlar
        try:
            archive_cols = {c["name"] for c in insp.get_columns("archive_purchase_orders")}
            if "local_pdf_url" not in archive_cols:
                conn.execute(text("ALTER TABLE archive_purchase_orders ADD COLUMN local_pdf_url VARCHAR"))
                conn.commit()
            if "delivery_date" not in archive_cols:
                conn.execute(text("ALTER TABLE archive_purchase_orders ADD COLUMN delivery_date VARCHAR"))
                conn.commit()
        except Exception:
            pass  # tablo yoksa create_all yaratir
        # products.shelf + pending_approval + created_by_id
        try:
            prod_cols = {c["name"] for c in insp.get_columns("products")}
            if "shelf" not in prod_cols:
                conn.execute(text("ALTER TABLE products ADD COLUMN shelf VARCHAR"))
                conn.commit()
            if "pending_approval" not in prod_cols:
                conn.execute(text("ALTER TABLE products ADD COLUMN pending_approval BOOLEAN DEFAULT 0"))
                conn.commit()
            if "created_by_id" not in prod_cols:
                conn.execute(text("ALTER TABLE products ADD COLUMN created_by_id INTEGER REFERENCES users(id)"))
                conn.commit()
        except Exception:
            pass
        # hepsiburada_orders ek kolonlar (Asama 1 onay icin)
        try:
            hb_cols = {c["name"] for c in insp.get_columns("hepsiburada_orders")}
            if "parasut_invoice_id" not in hb_cols:
                conn.execute(text("ALTER TABLE hepsiburada_orders ADD COLUMN parasut_invoice_id VARCHAR"))
                conn.commit()
            if "package_number" not in hb_cols:
                conn.execute(text("ALTER TABLE hepsiburada_orders ADD COLUMN package_number VARCHAR"))
                conn.commit()
            if "approved_by_id" not in hb_cols:
                conn.execute(text("ALTER TABLE hepsiburada_orders ADD COLUMN approved_by_id INTEGER"))
                conn.commit()
        except Exception:
            pass

_run_migrations()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: TeamGram sync arka planda başlat
    from app.services.tg_sync import start_background_sync
    from app.services.product_sync import start_background_sync as start_product_sync
    task1 = asyncio.create_task(start_background_sync())
    task2 = asyncio.create_task(start_product_sync())
    yield
    # Shutdown
    for task in [task1, task2]:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="Aremak Operasyon API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL, "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api")

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


@app.get("/health")
def health():
    return {"status": "ok"}
