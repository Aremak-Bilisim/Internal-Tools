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

    class Config:
        env_file = ".env"


settings = Settings()
