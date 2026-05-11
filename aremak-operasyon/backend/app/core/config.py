from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 8  # 8 hours

    TEAMGRAM_TOKEN: str
    TEAMGRAM_DOMAIN: str = "aremak"
    TEAMGRAM_BASE_URL: str = "https://api.teamgram.com"

    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""

    PARASUT_CLIENT_ID: str = ""
    PARASUT_CLIENT_SECRET: str = ""
    PARASUT_USERNAME: str = ""
    PARASUT_PASSWORD: str = ""
    PARASUT_COMPANY_ID: str = "627949"

    FRONTEND_URL: str = "http://localhost:5173"

    # Hepsiburada webhook (Basic Auth ile gelir)
    HEPSIBURADA_WEBHOOK_USER: str = ""
    HEPSIBURADA_WEBHOOK_PASSWORD: str = ""

    # Hepsiburada outbound API (Marketplace REST)
    HEPSIBURADA_API_BASE_URL: str = "https://oms-external-sit.hepsiburada.com"   # SIT (test)
    HEPSIBURADA_MERCHANT_ID: str = ""
    HEPSIBURADA_SECRET_KEY: str = ""
    HEPSIBURADA_USER_AGENT: str = ""

    # Kredi karti komisyon orani — sevk talebi olusturuldugunda TG order'in
    # 'Odeme Sekli' CF'si 'Kredi Karti' ise bagli Parasut faturasindaki tum item'larin
    # birim fiyati (1 + ORAN) ile carpilir. 0.02 = %2 default.
    KREDI_KARTI_KOMISYON_ORAN: float = 0.02

    # Public API key — kamera secici uygulamasi ve benzeri 3rd-party agent'lar icin.
    # /api/public/* endpoint'lerinde X-API-Key header ile dogrulanir. Bos birakilirsa
    # bu endpoint'ler 503 doner (yanlislikla acik kalmayi onlemek icin).
    CAMERA_AGENT_API_KEY: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
