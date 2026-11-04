"""Uygulama ayarları.

Tüm değerler ortam değişkenlerinden (.env dosyasından) okunur.
Değişken adları backend/.env.example ile BİREBİR aynı olmalı — biri
değişirse diğeri de güncellenmeli, yoksa .env'deki değer sessizce
göz ardı edilir (pydantic-settings tanımadığı alanı yok sayar).
"""

from email.utils import parseaddr
from functools import lru_cache
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr
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

    # ── Password work (bcrypt; see app/core/passwordwork.py) ──
    # Hashing and checking a password costs ~0.2 s of CPU. It runs in this many worker
    # threads, never on the event loop. At most MAX_QUEUED more calls may wait for a
    # worker; beyond that the request is refused with a 503 (and Retry-After) instead of
    # queueing without limit.
    PASSWORD_WORK_WORKERS: int = Field(default=4, ge=1, le=32)
    PASSWORD_WORK_MAX_QUEUED: int = Field(default=64, ge=0, le=1024)

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
    # Account-deletion attempts (each one checks the current password), per signed-in
    # account and per requester. Only wrong passwords stay counted.
    RATE_LIMIT_DELETE_USER_LIMIT: int = Field(default=5, ge=1)
    RATE_LIMIT_DELETE_USER_WINDOW_SECONDS: int = Field(default=900, ge=1)
    RATE_LIMIT_DELETE_IP_LIMIT: int = Field(default=20, ge=1)
    RATE_LIMIT_DELETE_IP_WINDOW_SECONDS: int = Field(default=900, ge=1)

    # Password recovery (see README.md, "Parola kurtarma"). A code request is counted
    # per requester, per email address as typed and as a resend cooldown, whether or
    # not the address belongs to an account; confirmations per requester and per address.
    RATE_LIMIT_RECOVERY_REQUEST_IP_LIMIT: int = Field(default=15, ge=1)
    RATE_LIMIT_RECOVERY_REQUEST_IP_WINDOW_SECONDS: int = Field(default=3600, ge=1)
    RATE_LIMIT_RECOVERY_REQUEST_ACCOUNT_LIMIT: int = Field(default=5, ge=1)
    RATE_LIMIT_RECOVERY_REQUEST_ACCOUNT_WINDOW_SECONDS: int = Field(default=3600, ge=1)
    RATE_LIMIT_RECOVERY_RESEND_COOLDOWN_SECONDS: int = Field(default=60, ge=1)
    RATE_LIMIT_RECOVERY_CONFIRM_IP_LIMIT: int = Field(default=30, ge=1)
    RATE_LIMIT_RECOVERY_CONFIRM_IP_WINDOW_SECONDS: int = Field(default=900, ge=1)
    RATE_LIMIT_RECOVERY_CONFIRM_ACCOUNT_LIMIT: int = Field(default=10, ge=1)
    RATE_LIMIT_RECOVERY_CONFIRM_ACCOUNT_WINDOW_SECONDS: int = Field(default=900, ge=1)

    # ── Password recovery codes ──
    # 8 random digits (~26.6 bits). Short on purpose, so what protects them is the
    # attempt limit (per code, per address, per requester), the lifetime and the keyed
    # hash they are stored under, not their size.
    PASSWORD_RESET_CODE_TTL_SECONDS: int = Field(default=900, ge=60, le=3600)
    PASSWORD_RESET_MAX_ATTEMPTS: int = Field(default=5, ge=1, le=10)

    # ── Outgoing email ──
    # MAIL_TRANSPORT names the one transport in use; nothing switches between them on
    # failure. "smtp" talks SMTP (below); "resend" calls Resend's HTTPS API, which is how
    # a host that blocks outbound SMTP ports (Render's free plan) can still send.
    # Unset SMTP_HOST (smtp) or RESEND_API_KEY (resend) means "no delivery configured":
    # recovery requests are still answered the same way but nothing is created or sent.
    # Credentials stay here, on the backend. Outside development the selected transport
    # must be fully configured (see check_deployment_safety).
    MAIL_TRANSPORT: Literal["smtp", "resend"] = "smtp"
    # The From address of every message. Falls back to SMTP_FROM so existing setups keep
    # working; Resend requires an address on a domain verified in its dashboard.
    MAIL_FROM: str | None = None

    # ── Outgoing email: Resend (HTTPS API) ──
    RESEND_API_KEY: SecretStr | None = None
    # Not meant to be changed; tests and the local stack point it at a stub. Outside
    # development it must be https.
    RESEND_API_URL: str = "https://api.resend.com/emails"
    # Applies to the whole request (connect, send, read), not to each step.
    RESEND_TIMEOUT_SECONDS: float = Field(default=10, gt=0, le=60)
    RESEND_MAX_CONCURRENT: int = Field(default=4, ge=1, le=32)
    RESEND_MAX_PENDING: int = Field(default=100, ge=1, le=10_000)

    # ── Outgoing email: SMTP ──
    SMTP_HOST: str | None = None
    SMTP_PORT: int = Field(default=587, ge=1, le=65535)
    # starttls: plain connect, then the server must upgrade (587). implicit: TLS from
    # the first byte (465). none: unencrypted, development only.
    SMTP_SECURITY: Literal["starttls", "implicit", "none"] = "starttls"
    SMTP_USERNAME: str | None = None
    SMTP_PASSWORD: SecretStr | None = None
    SMTP_FROM: str = "BodyTrack <no-reply@example.invalid>"
    # Applies to each socket operation (connect, greeting, STARTTLS, login, send).
    SMTP_TIMEOUT_SECONDS: float = Field(default=10, gt=0, le=60)
    # Sends running at once, and sends allowed to wait; beyond that a message is dropped.
    SMTP_MAX_CONCURRENT: int = Field(default=4, ge=1, le=32)
    SMTP_MAX_PENDING: int = Field(default=100, ge=1, le=10_000)

    # ── NCBI E-utilities (PubMed) ──
    # Both optional. An API key raises NCBI's per-IP limit from 3 to 10
    # requests/second; it lives only here on the backend, never in the mobile
    # bundle. Leave unset to use the anonymous limit.
    NCBI_API_KEY: str | None = None
    NCBI_EMAIL: str | None = None

    @property
    def smtp_configured(self) -> bool:
        return bool(self.SMTP_HOST)

    @property
    def resend_configured(self) -> bool:
        return self.RESEND_API_KEY is not None and bool(self.RESEND_API_KEY.get_secret_value())

    @property
    def mail_configured(self) -> bool:
        """Whether the SELECTED transport has what it needs to deliver."""
        return self.resend_configured if self.MAIL_TRANSPORT == "resend" else self.smtp_configured

    @property
    def mail_from(self) -> str:
        return self.MAIL_FROM or self.SMTP_FROM

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @property
    def is_development(self) -> bool:
        return self.ENVIRONMENT == "development"

    def check_deployment_safety(self) -> None:
        """Refuse to start a non-development environment that is unsafe or half-configured.

        backend/.env.example ships a placeholder key that is public in the
        repository, and a copied .env keeps it. Anyone who knows the key can
        sign tokens for any user, so outside development a short key is a
        startup error; so is a mail transport that cannot deliver. Raised as a plain
        error, never a pydantic one, so the message cannot echo a secret.
        """
        if self.is_development:
            return
        environment = self.ENVIRONMENT
        if len(self.JWT_SECRET_KEY.encode()) < MIN_JWT_SECRET_BYTES:
            raise RuntimeError(
                f"JWT_SECRET_KEY must be at least {MIN_JWT_SECRET_BYTES} bytes when "
                f"ENVIRONMENT is {environment!r}. Generate one with: "
                'python -c "import secrets; print(secrets.token_urlsafe(48))"'
            )
        self._check_mail(environment)

    def _check_mail(self, environment: str) -> None:
        if self.MAIL_TRANSPORT == "resend":
            if not self.resend_configured:
                raise RuntimeError(
                    f"RESEND_API_KEY must be set when MAIL_TRANSPORT is 'resend' and "
                    f"ENVIRONMENT is {environment!r}: password recovery cannot deliver "
                    "codes without it."
                )
            url = urlsplit(self.RESEND_API_URL)
            if url.scheme != "https" or not url.hostname:
                raise RuntimeError(
                    f"RESEND_API_URL must be an https URL when ENVIRONMENT is {environment!r}."
                )
            address = parseaddr(self.mail_from)[1]
            _, at, domain = address.rpartition("@")
            if not at or not domain or domain.endswith(".invalid"):
                raise RuntimeError(
                    f"MAIL_FROM must be a real address on a domain verified with Resend when "
                    f"ENVIRONMENT is {environment!r}."
                )
            return
        if not self.smtp_configured:
            raise RuntimeError(
                f"SMTP_HOST must be set when ENVIRONMENT is {environment!r}: "
                "password recovery cannot deliver codes without it."
            )
        if self.SMTP_SECURITY == "none":
            raise RuntimeError(
                f"SMTP_SECURITY must be 'starttls' or 'implicit' when ENVIRONMENT is "
                f"{environment!r}: recovery codes must not cross the network in clear."
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