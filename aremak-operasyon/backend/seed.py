"""
Run once to create the first admin user:
  python seed.py
"""
from app.core.database import SessionLocal, engine
from app.core.database import Base
from app.models.user import User
from app.models.shipment import ShipmentRequest, ShipmentHistory
from app.core.auth import hash_password

Base.metadata.create_all(bind=engine)

db = SessionLocal()

if not db.query(User).filter(User.email == "emrah@aremak.com.tr").first():
    db.add(User(
        email="emrah@aremak.com.tr",
        name="Emrah Bala",
        hashed_password=hash_password("changeme123"),
        role="admin",
    ))
    db.commit()
    print("Admin kullanıcı oluşturuldu: emrah@aremak.com.tr / changeme123")
else:
    print("Admin zaten mevcut")

db.close()
