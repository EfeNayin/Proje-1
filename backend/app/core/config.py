"""Uygulama ayarları.

Tüm değerler ortam değişkenlerinden (.env dosyasından) okunur.
Değişken adları backend/.env.example ile BİREBİR aynı olmalı — biri
değişirse diğeri de güncellenmeli, yoksa .env'deki değer sessizce
göz ardı edilir (pydantic-settings tanımadığı alanı yok sayar).
"""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # ── Ortam ──
    ENVIRONMENT: Literal["development", "staging", "production"] = "development"

    # ── Veritabanı ──
    # postgresql+asyncpg://... formatında olmalı (async sürücü).
    DATABASE_URL: str
    POSTGRES_USER: str = "bodytrack"
    POSTGRES_PASSWORD: str = "bodytrack"
    POSTGRES_DB: str = "bodytrack"

    # ── Redis ──
    REDIS_URL: str = "redis://redis:6379/0"

    # ── JWT / Güvenlik ──
    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 14

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"


@lru_cache
def get_settings() -> Settings:
    """Settings'i tek bir instance olarak cache'ler.

    FastAPI dependency injection ile kullanılır: Depends(get_settings).
    lru_cache sayesinde her çağrıda .env yeniden okunmaz, bir kere
    parse edilip bellekte tutulur.
    """
    return Settings()


# Doğrudan import edip kullanmak isteyenler için (dependency injection
# gerekmeyen yerlerde, örn. Alembic env.py içinde).
settings = get_settings()