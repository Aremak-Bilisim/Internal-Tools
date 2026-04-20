# Aremak Operasyon — CLAUDE.md

Proje hakkında mimari kararlar, entegrasyonlar ve geliştirme kuralları.

## Çalışma Tarzı
- Büyük refactor'a başlamadan önce plan sun, onay bekle
- Mevcut kod pattern'ini koru (Field, ActionBar bileşenleri gibi)
- Yeni dosya oluşturmak yerine varolan dosyayı düzenle (mümkünse)
- Test/lint komutu biliyorsan değişiklik sonrası çalıştır

## İletişim
- Türkçe yanıt ver
- Kod içinde değişken isimleri İngilizce, UI metinleri ve hata mesajları Türkçe
- Commit mesajları: kısa, Türkçe olabilir

## Yapma

- TeamGram Edit payload'ına `DeliveryAddressId` ve `ContactInfoList` ekleme
- Paraşüt'te `filter[name]=...` kullanma (exact match yapar) — `filter[query]=...` kullan
- `"İş".lower()` ile contact tipi karşılaştırma yapma — exact match seti kullan
- GİB adresinde il/ilçe dahil etme
- Yeni Paraşüt müşterisi oluştururken `exchange_rate_type: "selling"` atlamak
- `.env` dosyasını commit etme
- Production'a push öncesi `deploy` komutunu atlamak

---

## Proje Yapısı

```
aremak-operasyon/
├── backend/          # FastAPI (Python 3.12), port 8000 (prod) / 8006 (local)
├── frontend/         # React + Vite + Ant Design, port 5173
└── docker-compose.yml
```

**Prod sunucu:** `167.235.78.31` (Ubuntu)
**Deploy komutu:** `deploy` (`/usr/local/bin/deploy`) — git pull + npm build + systemctl restart
**Servis:** `systemctl restart aremak-backend` (venv: `backend/.venv`)
**Repo:** `https://github.com/Aremak-Bilisim/Internal-Tools.git`

---

## Backend

- **Framework:** FastAPI
- **DB:** SQLite (`aremak_operasyon.db`) — SQLAlchemy ORM
- **Auth:** JWT (OAuth2PasswordBearer), token süresi 8 saat
- **Config:** `backend/.env` dosyasından okunur (pydantic-settings)
- **API prefix:** `/api/`
- **Health:** `GET /health`

### Önemli modeller
- `TeamgramCompany` — TeamGram şirketlerinin local mirror'ı
- `User`, `ShipmentRequest`, `ShipmentHistory`, `Notification`

### Background sync
- Startup'ta DB boşsa **full sync**, doluysa **incremental sync** çalışır
- Full sync: her 24 saatte bir
- Incremental sync: her 1 saatte bir (`Companies/GetUpdated`)

### Full sync zorla
```bash
cd /opt/Internal-Tools/aremak-operasyon/backend && \
.venv/bin/python -c "
import sys; sys.path.insert(0, '.')
from app.core.database import SessionLocal
from app.models.teamgram_company import TeamgramCompany
db = SessionLocal()
db.query(TeamgramCompany).delete()
db.commit()
db.close()
print('Silindi')
" && systemctl restart aremak-backend
```

---

## Frontend

- **Framework:** React 18 + Vite
- **UI:** Ant Design (antd)
- **Routing:** React Router v6
- **State:** Zustand (`useAuthStore`)
- **API client:** `src/services/api.js` (axios, baseURL `/api`)

### Sayfalar
| Route | Sayfa |
|---|---|
| `/dashboard` | Dashboard |
| `/products` | Ürünler |
| `/orders` | Müşteri Siparişleri |
| `/orders/:id` | Sipariş Detayı |
| `/shipments` | Sevkiyatlar |
| `/shipments/:id` | Sevkiyat Detayı |
| `/customer-query` | Firma Sorgula (VKN + Ünvan modu) |
| `/customer-new` | Yeni Müşteri Oluştur |

### Menü yapısı
```
Dashboard
Ürünler
Siparişler
  └─ Müşteri Siparişleri
Sevkiyatlar
Müşteri
  ├─ Firma Sorgula
  └─ Yeni Oluştur
```

---

## Entegrasyonlar

### GİB (Gelir İdaresi Başkanlığı)
- Paraşüt API'si üzerinden erişilir: `GET /v4/{company}/taxpayer_data/{vkn}`
- VKN ile vergi mükellefi bilgisi çekilir (unvan, adres, vergi dairesi, faaliyet)
- Adres formatı: `neighborhood + street + No:exteriorDoorNumber` (il/ilçe dahil edilmez)

### TeamGram
- **Base URL:** `https://api.teamgram.com/aremak/`
- **Auth:** `Token: {TEAMGRAM_TOKEN}` header
- **Domain:** `aremak`
- Önemli endpointler:
  - `Companies/GetAll` — tüm firmalar (sayfalı)
  - `Companies/GetUpdated?fromDate=...` — güncellenmiş firmalar
  - `Companies/Get?id=...` — tek firma
  - `Companies/Create` — firma oluştur
  - `Companies/Edit` — firma güncelle
  - `ScheduledRequests/MetaData` — sektör, kanal listeleri

#### Adres güncelleme (kritik)
- Edit payload'ında `AddressId` korunur, `DeliveryAddressId` ve `ContactInfoList` **kaldırılır**
- Aksi hâlde TeamGram yeni boş adres kayıtları oluşturur
- Yeni firma oluştururken adres `Address` top-level alanı olarak gönderilir

#### Contact info tip adları
- TeamGram adres tipi: **`"İş"`** (SubType: Business, Id: 20)
- `_company_to_dict`'te Türkçe büyük/küçük harf sorunu: `"İş".lower()` ≠ `"iş"` olduğu için exact match seti kullanılır

#### Özel alanlar (custom fields)
| Alan | CustomFieldId |
|---|---|
| Müşteri Tipi | 192253 |
| İndirim Seviyesi (%) | 192610 |
| Kullanıcı Tipi | 192611 |

#### Webhook
- URL: `POST /api/webhook/teamgram`
- TeamGram payload yapısı:
  ```json
  { "Data": { ...firma... }, "EventAction": "New|Update|Delete", "EventEntity": "Party" }
  ```
- `EventAction == "Delete"` → DB'den sil
- Diğer → `_company_to_dict(Data)` ile upsert

### Paraşüt
- **Base URL:** `https://api.parasut.com`
- **Auth:** OAuth2 password grant, token cache
- **Company ID:** `627949`
- Önemli özellikler:
  - Yeni müşteri: `exchange_rate_type: "selling"` zorunlu
  - İsim arama: `filter[query]=...` (partial match), `filter[name]=...` exact match yapar — **kullanma**
  - `zip_code` alanı desteklenir

---

## Kod stili

### Backend (Python)
- Route'lar `app/api/routes/` altında
- Servisler `app/services/` altında (`teamgram.py`, `parasut.py`, `tg_sync.py`)
- Async endpoint'ler için `async def`, DB işlemleri sync
- Hata mesajları Türkçe (`detail: "..."`)
- Log: `logger.info/warning/error(...)` — `logging.getLogger(__name__)`

### Frontend (React)
- Sayfa bileşenleri `src/pages/`, ortak bileşenler `src/components/`
- Stil: inline style objeleri (CSS-in-JS), Ant Design token'ları
- `Field` bileşeni: label + value + copy butonu (tekrarlanan pattern)
- `ActionBar` bileşeni: href (link) / onClick (navigate) / endpoint (Popconfirm + API) aksiyonları
- Türkçe UI metinleri

---

## Önemli kararlar

1. **TeamGram local DB mirror** — API rate limit ve hız için şirketler SQLite'ta cache'lenir, webhook ile realtime güncellenir
2. **VKN sorgusu canlı doğrulama** — Local DB'de bulunan firma `Companies/Get` ile doğrulanır; silinmişse DB'den de temizlenir
3. **Firma Sorgula iki modlu** — VKN modu (GİB+TG+Paraşüt) ve Ünvan modu (TG local DB LIKE + Paraşüt filter[query])
4. **TeamGram'a Ekle → form yönlendirme** — Direkt eklemek yerine `/customer-new?vkn=...` adresine yönlendirir, kullanıcı formu doldurur
5. **Webhook event tipi yerine Companies/Get** — Delete event adı güvenilmez olduğundan Companies/Get boş dönerse sil mantığı uygulanır (aynı zamanda EventAction=="delete" kontrolü de var)

---

## Sık kullanılan komutlar

```bash
# Local backend başlat
cd backend
python -m uvicorn main:app --host 0.0.0.0 --port 8006 --reload

# Prod deploy
deploy

# Prod backend restart
systemctl restart aremak-backend

# Prod loglar
journalctl -u aremak-backend -f
journalctl -u aremak-backend -n 100 | grep "webhook"

# Full sync (prod)
cd /opt/Internal-Tools/aremak-operasyon/backend && \
.venv/bin/python -c "
import sys; sys.path.insert(0, '.')
from app.core.database import SessionLocal
from app.models.teamgram_company import TeamgramCompany
db = SessionLocal()
db.query(TeamgramCompany).delete()
db.commit()
db.close()
print('Silindi')
" && systemctl restart aremak-backend
```
