"""Uygulama ayarları.

Tüm değerler ortam değişkenlerinden (.env dosyasından) okunur.
Değişken adları backend/.env.example ile BİREBİR aynı olmalı — biri
değişirse diğeri de güncellenmeli, yoksa .env'deki değer sessizce
göz ardı edilir (pydantic-settings tanımadığı alanı yok sayar).
"""

from email.utils import parseaddr
from functools import lru_cache
from typing import Literal
from urllib.parse import parse_qsl, urlsplit

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

# 256 bits, the size of an HS256 key.
MIN_JWT_SECRET_BYTES = 32


def _is_loopback_origin(origin: str) -> bool:
    """True for exactly http://localhost[:port] or http://127.0.0.1[:port]."""
    try:
        parts = urlsplit(origin)
        port = parts.port
    except ValueError:
        return False
    if parts.scheme != "http" or parts.hostname not in {"localhost", "127.0.0.1"}:
        return False
    return origin == f"http://{parts.hostname}" + (f":{port}" if port is not None else "")


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
    # Connection pool of this process. The defaults are SQLAlchemy's own; a small hosted
    # database (Neon free: 0.25 CU, ~97 usable connections) wants a smaller pool, and its
    # compute suspends when idle, so a connection can be dead long before it is used
    # (pool_pre_ping catches that; DB_POOL_RECYCLE_SECONDS retires old ones before it has to).
    DB_POOL_SIZE: int = Field(default=5, ge=1, le=50)
    DB_MAX_OVERFLOW: int = Field(default=10, ge=0, le=50)
    DB_POOL_RECYCLE_SECONDS: int = Field(default=-1, ge=-1)

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

    # ── Sign in with Google / Apple (see README.md, "Google ve Apple ile giriş") ──
    # Both are OFF unless their flag is true AND every value they need is set; a flag with
    # missing values is a startup error outside development (check_deployment_safety), and
    # the app is told a provider is unavailable until it is fully configured. Secrets live
    # only here: nothing below is ever sent to the app except the public client ids.
    SOCIAL_GOOGLE_ENABLED: bool = False
    # The Google web client: the one the phone's server auth code is minted for and redeemed
    # with. Its id is the audience of the ID token Google returns.
    GOOGLE_WEB_CLIENT_ID: str | None = None
    GOOGLE_WEB_CLIENT_SECRET: SecretStr | None = None
    # Public: the iOS client the native SDK is configured with (also baked into the app).
    GOOGLE_IOS_CLIENT_ID: str | None = None
    # Empty omits redirect_uri, which is what the mobile SDKs' server codes are redeemed with.
    GOOGLE_CODE_REDIRECT_URI: str = ""
    GOOGLE_TOKEN_URL: str = "https://oauth2.googleapis.com/token"
    GOOGLE_JWKS_URL: str = "https://www.googleapis.com/oauth2/v3/certs"

    SOCIAL_APPLE_ENABLED: bool = False
    # The app's bundle id (the Sign in with Apple "client id" for native sign-in).
    APPLE_CLIENT_ID: str | None = None
    # Extra accepted audiences, comma separated. Development only: Expo Go signs in as
    # "host.exp.Exponent", not as this app.
    APPLE_EXTRA_AUDIENCES: str = ""
    APPLE_TEAM_ID: str | None = None
    APPLE_KEY_ID: str | None = None
    # The .p8 key's PEM text. Newlines may be written as backslash-n so it fits in one env line.
    APPLE_PRIVATE_KEY: SecretStr | None = None
    APPLE_BASE_URL: str = "https://appleid.apple.com"
    # Encrypts the Apple refresh token kept for revocation (Fernet key, see core/secretbox.py):
    #   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    SOCIAL_TOKEN_ENCRYPTION_KEY: SecretStr | None = None

    # How long a nonce / an unfinished sign-up lasts, and how long we wait on a provider.
    SOCIAL_NONCE_TTL_SECONDS: int = Field(default=300, ge=60, le=900)
    SOCIAL_SIGNUP_TTL_SECONDS: int = Field(default=900, ge=120, le=3600)
    SOCIAL_HTTP_TIMEOUT_SECONDS: float = Field(default=5, gt=0, le=30)
    # Per requester, counted before anything is verified (nonces cost a row, sign-ins a call
    # to the provider, completions a user row).
    RATE_LIMIT_SOCIAL_NONCE_IP_LIMIT: int = Field(default=60, ge=1)
    RATE_LIMIT_SOCIAL_NONCE_IP_WINDOW_SECONDS: int = Field(default=600, ge=1)
    RATE_LIMIT_SOCIAL_SIGNIN_IP_LIMIT: int = Field(default=30, ge=1)
    RATE_LIMIT_SOCIAL_SIGNIN_IP_WINDOW_SECONDS: int = Field(default=600, ge=1)
    RATE_LIMIT_SOCIAL_COMPLETE_IP_LIMIT: int = Field(default=20, ge=1)
    RATE_LIMIT_SOCIAL_COMPLETE_IP_WINDOW_SECONDS: int = Field(default=3600, ge=1)
    RATE_LIMIT_SOCIAL_NOTIFY_IP_LIMIT: int = Field(default=120, ge=1)
    RATE_LIMIT_SOCIAL_NOTIFY_IP_WINDOW_SECONDS: int = Field(default=600, ge=1)

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

    # ── Reverse proxy ──
    # uvicorn reads this variable itself (the peers whose X-Forwarded-For it believes).
    # It is declared here only so a wildcard can be refused outside development; the
    # client-address model is in README.md ("Hız sınırları").
    FORWARDED_ALLOW_IPS: str | None = None

    # ── Browser preview (development only) ──
    # Comma-separated origins of a local Expo web preview, e.g. "http://localhost:8081".
    # Empty (the default) adds no CORS headers at all, so a phone app is unaffected.
    # Only loopback http origins are accepted, and only when ENVIRONMENT is development
    # (see check_cors). The API uses bearer tokens, never cookies, so credentialed
    # cross-origin requests stay disallowed.
    CORS_ALLOWED_ORIGINS: str = ""

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
    def cors_origins(self) -> list[str]:
        return [part.strip() for part in self.CORS_ALLOWED_ORIGINS.split(",") if part.strip()]

    @property
    def apple_extra_audiences(self) -> list[str]:
        return [part.strip() for part in self.APPLE_EXTRA_AUDIENCES.split(",") if part.strip()]

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
        startup error; so are a mail transport that cannot deliver, and database,
        Redis or proxy settings that would send credentials in clear or skip
        certificate checks. Raised as a plain error, never a pydantic one, so the
        message cannot echo a secret or a connection string.
        """
        self.check_cors()
        self.check_social()
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
        self._check_database_url(environment)
        self._check_redis_url(environment)
        allowed = [part.strip() for part in (self.FORWARDED_ALLOW_IPS or "").split(",")]
        if "*" in allowed:
            raise RuntimeError(
                f"FORWARDED_ALLOW_IPS must list the proxy addresses, not '*', when "
                f"ENVIRONMENT is {environment!r}: a wildcard would let any caller choose "
                "the address its rate limits are counted under."
            )

    def check_social(self) -> None:
        """A provider that is switched on must be complete; nothing half-configured starts.

        Runs in every environment: a flag with missing values would otherwise show a button
        that can never work. Messages name the variables, never their values.
        """
        # Imported here: secretbox imports nothing of ours, and config must stay importable first.
        from app.core.secretbox import is_valid_key

        def missing(names: dict[str, object]) -> list[str]:
            return [name for name, value in names.items() if not value]

        if self.SOCIAL_GOOGLE_ENABLED:
            absent = missing(
                {
                    "GOOGLE_WEB_CLIENT_ID": self.GOOGLE_WEB_CLIENT_ID,
                    "GOOGLE_WEB_CLIENT_SECRET": (
                        self.GOOGLE_WEB_CLIENT_SECRET
                        and self.GOOGLE_WEB_CLIENT_SECRET.get_secret_value()
                    ),
                    "GOOGLE_IOS_CLIENT_ID": self.GOOGLE_IOS_CLIENT_ID,
                }
            )
            if absent:
                raise RuntimeError(
                    f"SOCIAL_GOOGLE_ENABLED is true but {', '.join(absent)} "
                    f"{'is' if len(absent) == 1 else 'are'} not set."
                )
        if self.SOCIAL_APPLE_ENABLED:
            key = self.SOCIAL_TOKEN_ENCRYPTION_KEY
            absent = missing(
                {
                    "APPLE_CLIENT_ID": self.APPLE_CLIENT_ID,
                    "APPLE_TEAM_ID": self.APPLE_TEAM_ID,
                    "APPLE_KEY_ID": self.APPLE_KEY_ID,
                    "APPLE_PRIVATE_KEY": (
                        self.APPLE_PRIVATE_KEY and self.APPLE_PRIVATE_KEY.get_secret_value()
                    ),
                    "SOCIAL_TOKEN_ENCRYPTION_KEY": key and key.get_secret_value(),
                }
            )
            if absent:
                raise RuntimeError(
                    f"SOCIAL_APPLE_ENABLED is true but {', '.join(absent)} "
                    f"{'is' if len(absent) == 1 else 'are'} not set."
                )
            if key is not None and not is_valid_key(key.get_secret_value()):
                raise RuntimeError(
                    "SOCIAL_TOKEN_ENCRYPTION_KEY is not a valid Fernet key (32 url-safe "
                    "base64-encoded bytes)."
                )
        if not self.is_development:
            for name, url in (
                ("GOOGLE_TOKEN_URL", self.GOOGLE_TOKEN_URL),
                ("GOOGLE_JWKS_URL", self.GOOGLE_JWKS_URL),
                ("APPLE_BASE_URL", self.APPLE_BASE_URL),
            ):
                if urlsplit(url).scheme != "https":
                    raise RuntimeError(
                        f"{name} must be an https URL when ENVIRONMENT is {self.ENVIRONMENT!r}."
                    )
            if self.apple_extra_audiences:
                raise RuntimeError(
                    f"APPLE_EXTRA_AUDIENCES must be empty when ENVIRONMENT is "
                    f"{self.ENVIRONMENT!r}: it exists to test with Expo Go in development."
                )

    def check_cors(self) -> None:
        """Browser access exists only for a local preview: loopback http origins, in development.

        A wildcard or a hosted origin would let any web page call this API with a
        user's token, so those are startup errors, as is any value outside development.
        """
        origins = self.cors_origins
        if not origins:
            return
        if not self.is_development:
            raise RuntimeError(
                f"CORS_ALLOWED_ORIGINS must be empty when ENVIRONMENT is "
                f"{self.ENVIRONMENT!r}: browser access is a development-only preview."
            )
        for origin in origins:
            if not _is_loopback_origin(origin):
                raise RuntimeError(
                    "CORS_ALLOWED_ORIGINS entries must look like http://localhost:8081 "
                    "(http, localhost or 127.0.0.1, optional port, no path or wildcard)."
                )

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

    def _check_database_url(self, environment: str) -> None:
        query = dict(parse_qsl(urlsplit(self.DATABASE_URL).query))
        libpq_only = sorted({"sslmode", "channel_binding", "sslrootcert"} & query.keys())
        if libpq_only:
            raise RuntimeError(
                f"DATABASE_URL uses libpq parameter(s) {', '.join(libpq_only)}, which asyncpg "
                "does not read. Drop them and add ssl=verify-full to the query string."
            )
        if query.get("ssl") != "verify-full":
            raise RuntimeError(
                f"DATABASE_URL must end with ?ssl=verify-full when ENVIRONMENT is "
                f"{environment!r}: the database connection must be encrypted and the "
                "server's certificate and hostname verified."
            )

    def _check_redis_url(self, environment: str) -> None:
        url = urlsplit(self.REDIS_URL)
        if url.scheme != "rediss":
            raise RuntimeError(
                f"REDIS_URL must use rediss:// (TLS) when ENVIRONMENT is {environment!r}: "
                "its password must not cross the network in clear."
            )
        options = dict(parse_qsl(url.query))
        weakened = sorted({"ssl_cert_reqs", "ssl_check_hostname"} & options.keys())
        if weakened:
            raise RuntimeError(
                f"REDIS_URL must not set {', '.join(weakened)} when ENVIRONMENT is "
                f"{environment!r}: certificate and hostname checks are always on."
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