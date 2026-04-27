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
from app.models import user, shipment, notification, teamgram_company, product, sample, purchase_match, purchase_document, purchase_receipt_document, archive_purchase  # noqa
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
