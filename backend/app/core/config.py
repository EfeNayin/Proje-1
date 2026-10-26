"""Uygulama ayarları.

Tüm değerler ortam değişkenlerinden (.env dosyasından) okunur.
Değişken adları backend/.env.example ile BİREBİR aynı olmalı — biri
değişirse diğeri de güncellenmeli, yoksa .env'deki değer sessizce
göz ardı edilir (pydantic-settings tanımadığı alanı yok sayar).
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field
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

    # ── Rate limiting (shared through Redis; see app/core/ratelimit.py) ──
    # Each limit is "this many admitted requests per window"; the window starts at
    # the first request and the counter disappears when it ends. Defaults and the
    # reasoning behind them are in README.md ("Hız sınırları").
    RATE_LIMIT_KEY_PREFIX: str = "bt:rl"
    # Both timeouts bound how long a request can wait on Redis before it is
    # answered with 503; a limiter that cannot decide never lets the request through.
    RATE_LIMIT_REDIS_TIMEOUT_SECONDS: float = Field(default=0.5, gt=0, le=5)
    # Requester (client address) limits, checked before any password hashing.
    RATE_LIMIT_LOGIN_IP_LIMIT: int = Field(default=40, ge=1)
    RATE_LIMIT_LOGIN_IP_WINDOW_SECONDS: int = Field(default=600, ge=1)
    RATE_LIMIT_REGISTER_IP_LIMIT: int = Field(default=20, ge=1)
    RATE_LIMIT_REGISTER_IP_WINDOW_SECONDS: int = Field(default=3600, ge=1)
    RATE_LIMIT_REFRESH_IP_LIMIT: int = Field(default=60, ge=1)
    RATE_LIMIT_REFRESH_IP_WINDOW_SECONDS: int = Field(default=600, ge=1)
    # Login attempts that fail, per (account, requester) and per account overall.
    RATE_LIMIT_LOGIN_ACCOUNT_IP_LIMIT: int = Field(default=5, ge=1)
    RATE_LIMIT_LOGIN_ACCOUNT_IP_WINDOW_SECONDS: int = Field(default=900, ge=1)
    RATE_LIMIT_LOGIN_ACCOUNT_LIMIT: int = Field(default=50, ge=1)
    RATE_LIMIT_LOGIN_ACCOUNT_WINDOW_SECONDS: int = Field(default=3600, ge=1)
    # Refreshes per account, counted only once the refresh token's signature checked out.
    RATE_LIMIT_REFRESH_USER_LIMIT: int = Field(default=30, ge=1)
    RATE_LIMIT_REFRESH_USER_WINDOW_SECONDS: int = Field(default=600, ge=1)
    # Invite-code lookups that match no code, per signed-in account and per requester.
    RATE_LIMIT_INVITE_USER_LIMIT: int = Field(default=10, ge=1)
    RATE_LIMIT_INVITE_USER_WINDOW_SECONDS: int = Field(default=600, ge=1)
    RATE_LIMIT_INVITE_IP_LIMIT: int = Field(default=30, ge=1)
    RATE_LIMIT_INVITE_IP_WINDOW_SECONDS: int = Field(default=600, ge=1)

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