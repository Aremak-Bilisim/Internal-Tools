"""TG ürünlerini hemen senkronize eder. (Bekleme yok, scheduler atla.)

Kullanım:
    python scripts/sync_products_now.py
"""
import asyncio
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.product_sync import full_sync


async def main():
    print("TG product sync başlatılıyor...")
    await full_sync()
    print("✓ TG sync tamam.")


if __name__ == "__main__":
    asyncio.run(main())
