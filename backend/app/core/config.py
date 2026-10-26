"""Uygulama ayarları.

Tüm değerler ortam değişkenlerinden (.env dosyasından) okunur.
Değişken adları backend/.env.example ile BİREBİR aynı olmalı — biri
değişirse diğeri de güncellenmeli, yoksa .env'deki değer sessizce
göz ardı edilir (pydantic-settings tanımadığı alanı yok sayar).
"""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

# 256 bits, the size of an HS256 key.
MIN_JWT_SECRET_BYTES = 32


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
    # Only symmetric HMAC algorithms: the key above is a shared secret, and an
    # unchecked free-form value could name "none" or an asymmetric algorithm.
    JWT_ALGORITHM: Literal["HS256", "HS384", "HS512"] = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 14

    # ── NCBI E-utilities (PubMed) ──
    # Both optional. An API key raises NCBI's per-IP limit from 3 to 10
    # requests/second; it lives only here on the backend, never in the mobile
    # bundle. Leave unset to use the anonymous limit.
    NCBI_API_KEY: str | None = None
    NCBI_EMAIL: str | None = None

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @property
    def is_development(self) -> bool:
        return self.ENVIRONMENT == "development"

    def check_deployment_safety(self) -> None:
        """Refuse to start a non-development environment with a guessable JWT key.

        backend/.env.example ships a placeholder key that is public in the
        repository, and a copied .env keeps it. Anyone who knows the key can
        sign tokens for any user, so outside development a short key is a
        startup error. Raised as a plain error, never a pydantic one, so the
        message cannot echo the secret or the other settings.
        """
        if not self.is_development and len(self.JWT_SECRET_KEY.encode()) < MIN_JWT_SECRET_BYTES:
            raise RuntimeError(
                f"JWT_SECRET_KEY must be at least {MIN_JWT_SECRET_BYTES} bytes when "
                f"ENVIRONMENT is {self.ENVIRONMENT!r}. Generate one with: "
                'python -c "import secrets; print(secrets.token_urlsafe(48))"'
            )


@lru_cache
def get_settings() -> Settings:
    """Settings'i tek bir instance olarak cache'ler.

    FastAPI dependency injection ile kullanılır: Depends(get_settings).
    lru_cache sayesinde her çağrıda .env yeniden okunmaz, bir kere
    parse edilip bellekte tutulur.
    """
    loaded = Settings()
    loaded.check_deployment_safety()
    return loaded


# Doğrudan import edip kullanmak isteyenler için (dependency injection
# gerekmeyen yerlerde, örn. Alembic env.py içinde).
settings = get_settings()