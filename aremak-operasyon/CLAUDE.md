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
- `Product` — TeamGram ürünlerinin local mirror'ı (`products` tablosu)

### Background sync
- Startup'ta DB boşsa **full sync**, doluysa **incremental sync** çalışır
- Full sync: her 24 saatte bir
- Incremental sync: her 1 saatte bir (`Companies/GetUpdated`)

#### Ürün sync (`product_sync.py`)
- Startup'ta `full_sync()` → TG `Products/GetAll` sayfalı çeker, DB'ye upsert eder
- Her **6 saatte bir** TG full sync tekrarlanır
- Startup'ta ayrıca `sync_parasut_match()` çalışır → Paraşüt'teki tüm ürünler çekilir, SKU eşleştirilir, `parasut_id` DB'ye yazılır
- Her **24 saatte bir** Paraşüt eşleştirme tekrarlanır
- Manuel tetikleyiciler: `POST /api/products/sync` (TG), `POST /api/products/sync-parasut` (Paraşüt)

#### DB migration notu
SQLAlchemy `create_all` mevcut tabloya yeni kolon **eklemez**. Yeni kolon eklendiğinde prod ve local'de manuel çalıştır:
```bash
python -c "
from app.core.database import engine
import sqlalchemy
with engine.connect() as conn:
    conn.execute(sqlalchemy.text('ALTER TABLE products ADD COLUMN parasut_id VARCHAR'))
    conn.commit()
"
```

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
| `/products` | Ürünler (TG+Paraşüt sync, CRUD, filtre) |
| `/orders` | Müşteri Siparişleri |
| `/orders/:id` | Sipariş Detayı |
| `/shipments` | Sevkiyatlar |
| `/shipments/:id` | Sevkiyat Detayı |
| `/customer-query` | Firma Sorgula (VKN + Ünvan modu) |
| `/customer-new` | Yeni Müşteri Oluştur |

#### ProductsPage özellikleri
- Tablo: Marka, Model, SKU, Kategori (Ana/Alt), Satış/Alış Fiyatı, KDV, Birim, Stok, Bağlantı ikonları
- Bağlantı ikonu: TG (her zaman yeşil, tıklanabilir) + Paraşüt (mavi=kayıtlı, gri=kayıtsız)
- Filtreler: metin arama, ana kategori, alt kategori, stok durumu, pasif toggle, Paraşüt'teki toggle
- Yeni Ürün drawer: tüm alanlar + SKU otomatik önerisi
- Düzenleme drawer: mevcut verilerle açılır
- Detay drawer: TG ve Paraşüt linkleri + Descriptions
- TG Sync / Paraşüt Sync butonları (manuel tetikleyici)

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

#### Companies/Get vs Companies/Edit — alan adı farkları
- `Companies/Get` → `BasicRelationType` (tekil string); `Companies/Edit` GET payload → `BasicRelationTypes` (liste)
- `Companies/Get` → `CustomChannelId` null gelir, gerçek ID `CustomChannel.Id`'de; `Companies/Edit` payload → `Channel` (integer)
- `Companies/Get` → `Industries` (obje listesi, `{Id, Name, ...}`); Edit'e **gönderilmez** — `Domain` required hatası verir
- Sektör güncellemesi için `IndustryIds` (integer listesi) kullanılır
- `Companies/Get`'te top-level `Address` null olabilir — gerçek adres `Contactinfos` listesinde (`_ADDRESS_TYPE_NAMES` ile eşleştir)
- `Companies/Edit` GET'ten gelen payload `Industries` alanı POST'a gönderilmeden önce **kaldırılmalı**

#### Contact info tip adları
- TeamGram adres tipi: **`"İş"`** (SubType: Business, Id: 20)
- `_company_to_dict`'te Türkçe büyük/küçük harf sorunu: `"İş".lower()` ≠ `"iş"` olduğu için exact match seti kullanılır

#### Ürün endpointleri
- `Products/GetAll?id=0&page=X&pagesize=100` → `{count, page, pageSize, products: [...]}`
- `Products/Get?id=X` → tek ürün; `Category` obje olarak gelir `{Id, Name, Level}`
- `Products/Edit` GET → mevcut edit payload (Create POST ile aynı format)
- `Products/Create` POST → `{Result: true, Id: N}`
- `Products/Edit` POST → `{Result: true, Id: N}`
- `Products/Delete` POST → `{Result: true}`
- Kategoriler: `ScheduledRequests/MetaData` → `Categories` listesi (`Level=0` ana, `Level=1` alt, `ParentId` ile bağlı)

#### Ürün para birimi ID'leri
| ID | Para birimi |
|---|---|
| 1 | TL |
| 2 | USD |
| 3 | EUR |

Create/Edit payload'ında `CurrencyId` ve `PurchaseCurrencyId` integer kullanılır. `GetAll`'da `CurrencyName` string olarak gelir.

#### Ürün SKU kuralı
Format: `ARMK-{MARKA}-{KATEGORI}-{MODEL}` — tüm segmentler büyük harf, ayraç tire.
Örnek: `ARMK-HIK-CAM-MV-CA050-10GC`

#### Ürün attachment proxy
`GET /api/orders/proxy/attachment?url=...` — TeamGram dosyalarını auth header'ı ile backend üzerinden sunar.
Domain whitelist: `api.teamgram.com`, `teamgram.com`, `cdn.teamgram.com`

#### Özel alanlar (custom fields)
| Alan | CustomFieldId | Tip | Notlar |
|---|---|---|---|
| Müşteri Tipi | 192253 | select | — |
| İndirim Seviyesi (%) | 192610 | number | — |
| Kullanıcı Tipi | 192611 | select | — |

#### Sipariş custom fields (ödeme / sevk)
| Alan | CustomFieldId | Tip | Seçenekler |
|---|---|---|---|
| Ödeme Durumu | 193501 | select | 14858=Ödendi, 14859=Ödenecek |
| Beklenen Ödeme Tarihi | 193502 | date | `UnFormattedDate` veya `Value` (YYYY-MM-DD) |
| Ödeme Belgesi | 193472 | attachment | JSON array `[{Url, FileName, ...}]` |
| Ödeme Tutarı | 193526 | number | raw string değer |
| Ödeme Para Birimi | 193527 | select | 14860=TRL, 14861=USD, 14862=EUR |

**Okuma:** select → `JSON.parse(cf.Value).Id`, number → `cf.Value` (string → Number), attachment → `JSON.parse(cf.Value)`
**Yazma:** select → option ID string (ör. `"14858"`), number → string (ör. `"1500"`), date → `"YYYY-MM-DD"`

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
  - Posta kodu alanı: API'de `postal_code` (`zip_code` değil) — okuma ve yazma için `postal_code` kullan
  - Paraşüt contact eşleştirme: `filter[tax_number]={vkn}` ile yapılır
  - İrsaliye URL formatı: `https://uygulama.parasut.com/{company}/giden-irsaliyeler/{id}` (`irsaliyeler` **değil**, `giden-irsaliyeler`)
  - Ürün arama: `GET /products?filter[code]={sku}` (stok koduna göre)
  - Ürün listesi: `GET /products?page[number]=X&page[size]=25` — max 25 (100 → 422), `meta.total_pages` ile sayfalama, sayfalar arası 0.3s bekleme (429 koruması)
  - Ürün URL formatı: `https://uygulama.parasut.com/{company}/hizmet-ve-urunler/{id}`
  - **`page[size]` max=25 — TÜM endpointlerde** (`products`, `sales_invoices`, `shipment_documents`, `contacts` vs). 26+ → `422`. `min(size, 25)` ile clamp et.
  - Fatura listesi (cari bazlı): `GET /sales_invoices?filter[contact_id]={cid}&sort=-issue_date&page[size]=25`
  - İrsaliye listesi (cari bazlı): `GET /shipment_documents?filter[contact_id]={cid}&sort=-issue_date&page[size]=25`
  - VKN aramada bazı carilerde sıfır-prefix farkı olabilir → fallback olarak `lstrip('0')` versiyonunu da dene.

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

## Sevk Talebi İş Akışı

### Aşamalar
| Aşama | Açıklama |
|---|---|
| `draft` | Taslak — Sales veya Admin oluşturur |
| `pending_admin` | Admin onayı bekliyor |
| `parasut_review` | Gül (warehouse) Paraşüt faturasını inceler |
| `pending_parasut_approval` | Admin Paraşüt onayı bekliyor |
| `preparing` | Gül kargo hazırlıyor |
| `shipped` | Sevk edildi — son aşama |
| `revizyon_bekleniyor` | Admin revizyon talep etti; Sales güncelleyip yeniden gönderir |
| `iptal_edildi` | Admin iptal etti — terminal aşama |

### Geçişler ve Yetkiler
| Geçiş | Kim Yapar |
|---|---|
| `pending_admin` → `parasut_review` | Admin (onay) |
| `parasut_review` → `pending_parasut_approval` | Warehouse (Gül) |
| `pending_parasut_approval` → `preparing` | Admin (onay) |
| `preparing` → `shipped` | Warehouse (Gül) |
| `pending_admin` → `revizyon_bekleniyor` | Admin (revizyon talep et) |
| `revizyon_bekleniyor` → `pending_admin` | Sales (düzenleyip yeniden gönder) |
| Herhangi (aktif) → `iptal_edildi` | Yalnızca Admin |

### Rol Kapsamları
- **admin** — Tüm talepleri görür; tüm onay/revizyon/iptal yetkisi
- **sales (Ahmet)** — Talep oluşturur; yalnızca kendi taleplerini görür; `revizyon_bekleniyor` taleplerini düzenleyip yeniden gönderir
- **warehouse (Gül)** — Tüm talepleri görür; `parasut_review` ve `preparing` aşamalarını ilerletir; kargo PDF/fotoğraf yükler

### Bildirimler
- Yeni talep → Admin'e (in-app + e-posta)
- `pending_admin` onayı → Warehouse'a
- `parasut_review` geçişi → Admin'e
- `pending_parasut_approval` onayı → Warehouse'a
- `shipped` → Sales'e; TeamGram siparişi "Sevk edildi" olarak güncellenir
- Revizyon talep edildi → Sales'e (in-app + kırmızı başlıklı e-posta, revizyon notu içerir)
- İptal edildi → Sales'e (in-app + gri başlıklı e-posta)
- Sales revize edip yeniden gönderdi → Admin'lere

### Revizyon notu
`ShipmentHistory` tablosunda `[REVIZYON]` prefix'li kayıt olarak saklanır.
`get_shipment` response'unda `revision_note` alanı olarak en son `[REVIZYON]` kaydından parse edilir.

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
