"""What makes the backend safe to run on a hosted platform.

Startup refusals outside development (mail, database and Redis encryption, the proxy
address list), the readiness probe, Redis over TLS with real certificate and hostname
checks (a TLS front for the test Redis and a throw-away CA, tests/support/tls.py), and that
a complete staging environment really boots with its documentation closed.

No hosted service is contacted here: the hosted-provider specifics are in README.md
("Staging'e dağıtım") with what still has to be verified against the real services.
"""

import asyncio
import os
import subprocess
import sys
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import pytest
from httpx import ASGITransport, AsyncClient

import app.core.readiness as readiness
from app.core.config import MIN_JWT_SECRET_BYTES, Settings, settings
from app.core.exceptions import RateLimitedError, ServiceUnavailableError
from app.core.ratelimit import Bucket, RateLimiter, get_rate_limiter
from app.main import app
from tests.conftest import rate_limit_test_url
from tests.support.tls import issue, make_authority
from tests.test_ratelimit import DeadRedis

DB_SECRET = "dbpw-SECRET-value"
REDIS_SECRET = "redis-TOKEN-SECRET"
RESEND_SECRET = "re_SECRET_api_key"

STAGING: dict[str, Any] = {
    "ENVIRONMENT": "staging",
    "DATABASE_URL": f"postgresql+asyncpg://app:{DB_SECRET}@ep-x.neon.example/app?ssl=verify-full",
    "REDIS_URL": f"rediss://default:{REDIS_SECRET}@eu1-x.upstash.example:6379",
    "JWT_SECRET_KEY": "k" * MIN_JWT_SECRET_BYTES,
    "MAIL_TRANSPORT": "resend",
    "RESEND_API_KEY": RESEND_SECRET,
    "MAIL_FROM": "BodyTrack <no-reply@mail.example.test>",
}


def staging(**overrides: Any) -> Settings:
    return Settings(_env_file=None, **{**STAGING, **overrides})


def refusal(**overrides: Any) -> str:
    with pytest.raises(RuntimeError) as raised:
        staging(**overrides).check_deployment_safety()
    message = str(raised.value)
    for secret in (DB_SECRET, REDIS_SECRET, RESEND_SECRET):
        assert secret not in message  # a refusal never repeats a credential
    return message


# ── startup refusals ─────────────────────────────────────────────────────


class TestAFullStagingEnvironmentIsAccepted:
    @pytest.mark.parametrize("environment", ["staging", "production"])
    def test_resend_with_encrypted_database_and_redis(self, environment: str) -> None:
        staging(ENVIRONMENT=environment).check_deployment_safety()

    def test_smtp_remains_a_valid_transport(self) -> None:
        staging(
            MAIL_TRANSPORT="smtp", SMTP_HOST="smtp.example.test", RESEND_API_KEY=None
        ).check_deployment_safety()

    def test_development_needs_none_of_it(self) -> None:
        Settings(
            _env_file=None,
            DATABASE_URL="postgresql+asyncpg://u:p@db/x",
            JWT_SECRET_KEY="short",
            REDIS_URL="redis://redis:6379/0",
        ).check_deployment_safety()


class TestMail:
    def test_resend_needs_a_key(self) -> None:
        assert "RESEND_API_KEY" in refusal(RESEND_API_KEY=None)
        assert "RESEND_API_KEY" in refusal(RESEND_API_KEY="")

    def test_the_selected_transport_is_the_one_checked(self) -> None:
        # SMTP is fully configured, Resend is selected without a key: still refused.
        assert "RESEND_API_KEY" in refusal(RESEND_API_KEY=None, SMTP_HOST="smtp.example.test")
        # And the other way round: a Resend key does not satisfy a selected SMTP.
        assert "SMTP_HOST" in refusal(MAIL_TRANSPORT="smtp", SMTP_HOST=None)

    def test_the_api_url_must_be_https(self) -> None:
        assert "https" in refusal(RESEND_API_URL="http://api.resend.com/emails")
        assert "https" in refusal(RESEND_API_URL="https:///emails")

    @pytest.mark.parametrize(
        "sender", [None, "no-reply@example.invalid", "BodyTrack <>", "not an address"]
    )
    def test_the_from_address_must_be_a_real_one(self, sender: str | None) -> None:
        assert "MAIL_FROM" in refusal(MAIL_FROM=sender, SMTP_FROM="BodyTrack <a@example.invalid>")

    def test_unencrypted_smtp_is_still_refused(self) -> None:
        message = refusal(
            MAIL_TRANSPORT="smtp", SMTP_HOST="smtp.example.test", SMTP_SECURITY="none"
        )
        assert "SMTP_SECURITY" in message


class TestDatabaseUrl:
    @pytest.mark.parametrize(
        "query", ["", "?ssl=require", "?ssl=disable", "?ssl=prefer", "?ssl=verify-ca"]
    )
    def test_the_certificate_and_hostname_must_be_verified(self, query: str) -> None:
        url = f"postgresql+asyncpg://app:{DB_SECRET}@ep-x.neon.example/app{query}"
        assert "ssl=verify-full" in refusal(DATABASE_URL=url)

    @pytest.mark.parametrize("param", ["sslmode=require", "channel_binding=require"])
    def test_libpq_parameters_get_an_explicit_explanation(self, param: str) -> None:
        url = f"postgresql+asyncpg://app:{DB_SECRET}@ep-x.neon.example/app?{param}&ssl=verify-full"
        message = refusal(DATABASE_URL=url)
        assert param.split("=")[0] in message and "asyncpg" in message


class TestRedisUrl:
    def test_tls_is_required(self) -> None:
        url = f"redis://default:{REDIS_SECRET}@eu1-x.upstash.example:6379"
        assert "rediss://" in refusal(REDIS_URL=url)

    @pytest.mark.parametrize("query", ["ssl_cert_reqs=none", "ssl_check_hostname=false"])
    def test_the_url_cannot_switch_the_certificate_checks_off(self, query: str) -> None:
        url = f"rediss://default:{REDIS_SECRET}@eu1-x.upstash.example:6379?{query}"
        assert query.split("=")[0] in refusal(REDIS_URL=url)


class TestProxyAddresses:
    @pytest.mark.parametrize("value", ["*", "10.0.0.1, *", " * "])
    def test_a_wildcard_is_refused(self, value: str) -> None:
        assert "FORWARDED_ALLOW_IPS" in refusal(FORWARDED_ALLOW_IPS=value)

    def test_listed_addresses_and_networks_are_fine(self) -> None:
        staging(FORWARDED_ALLOW_IPS="10.0.0.0/8,172.16.0.1").check_deployment_safety()


class TestPoolSettings:
    def test_the_defaults_are_sqlalchemys_own(self) -> None:
        fresh = Settings(
            _env_file=None, DATABASE_URL="postgresql+asyncpg://u:p@db/x", JWT_SECRET_KEY="k" * 32
        )
        assert (fresh.DB_POOL_SIZE, fresh.DB_MAX_OVERFLOW, fresh.DB_POOL_RECYCLE_SECONDS) == (
            5,
            10,
            -1,
        )

    def test_the_engine_uses_them(self) -> None:
        from app.core.database import engine

        assert engine.pool.size() == settings.DB_POOL_SIZE  # type: ignore[attr-defined]


class TestVerifiedTlsForPostgres:
    """asyncpg given the bare string "verify-full" wants ~/.postgresql/root.crt and fails
    without it; the application, Alembic and the preflight check get a real SSLContext."""

    def test_verify_full_becomes_a_context_that_checks_chain_and_hostname(self) -> None:
        import ssl

        from app.core.dburl import engine_arguments

        url, args = engine_arguments(
            f"postgresql+asyncpg://app:{DB_SECRET}@ep-x.neon.example/app?ssl=verify-full&timeout=9"
        )

        assert "ssl" not in url.query and dict(url.query) == {"timeout": "9"}
        assert url.host == "ep-x.neon.example" and url.password == DB_SECRET
        context = args["ssl"]
        assert isinstance(context, ssl.SSLContext)
        assert context.verify_mode == ssl.CERT_REQUIRED and context.check_hostname is True

    @pytest.mark.parametrize("query", ["", "?ssl=require", "?ssl=disable"])
    def test_other_urls_pass_through_untouched(self, query: str) -> None:
        from app.core.dburl import engine_arguments

        raw = f"postgresql+asyncpg://u:p@db/x{query}"
        url, args = engine_arguments(raw)

        assert args == {} and url.render_as_string(hide_password=False) == raw

    def test_a_password_with_percent_signs_survives_the_alembic_round_trip(self) -> None:
        from sqlalchemy.engine import make_url

        from app.core.dburl import engine_arguments

        raw = "postgresql+asyncpg://app:p%40ss%25word@db/x?ssl=verify-full"
        url, _ = engine_arguments(raw)
        rendered = url.render_as_string(hide_password=False)

        assert make_url(rendered).password == "p@ss%word"


class TestPreflightTlsVerdict:
    """The preflight judges TLS on this client's side of the database connection.

    Found against a real Neon project: its proxy terminates TLS, so the PostgreSQL backend's
    own `pg_stat_ssl` said "not encrypted" for a TLS 1.3, certificate- and hostname-verified
    client connection. The verdict must follow what this process controls, and must still
    fail for anything weaker.
    """

    @staticmethod
    def session(version: str | None, *, mode: Any = None, hostname: bool = True) -> Any:
        import ssl
        from types import SimpleNamespace

        context = SimpleNamespace(
            verify_mode=ssl.CERT_REQUIRED if mode is None else mode, check_hostname=hostname
        )
        return SimpleNamespace(
            version=lambda: version, context=context, cipher=lambda: ("TLS_AES_256_GCM_SHA384",)
        )

    @pytest.mark.parametrize("version", ["TLSv1.2", "TLSv1.3"])
    def test_a_verified_modern_session_passes(self, version: str) -> None:
        from app.preflight import judge_client_tls

        ok, detail = judge_client_tls(self.session(version))

        assert ok and version in detail and "certificate required" in detail

    def test_no_tls_session_fails(self) -> None:
        from app.preflight import judge_client_tls

        assert judge_client_tls(None)[0] is False

    def test_an_old_protocol_fails(self) -> None:
        from app.preflight import judge_client_tls

        assert judge_client_tls(self.session("TLSv1.1"))[0] is False

    def test_an_unverified_certificate_fails(self) -> None:
        import ssl

        from app.preflight import judge_client_tls

        ok, detail = judge_client_tls(self.session("TLSv1.3", mode=ssl.CERT_NONE))

        assert ok is False and "NOT required" in detail

    def test_an_unchecked_hostname_fails(self) -> None:
        from app.preflight import judge_client_tls

        ok, detail = judge_client_tls(self.session("TLSv1.3", hostname=False))

        assert ok is False and "NOT checked" in detail

    async def test_a_plain_asyncpg_connection_reads_as_not_encrypted(self) -> None:
        """Also pins that asyncpg still exposes the transport the preflight reads."""
        import asyncpg  # type: ignore[import-untyped]

        from app.preflight import client_tls
        from tests.conftest import TEST_DB_NAME, _asyncpg_kwargs

        connection = await asyncpg.connect(**_asyncpg_kwargs(TEST_DB_NAME))
        try:
            assert getattr(connection, "_transport", None) is not None
            assert client_tls(connection) is None
        finally:
            await connection.close()


# ── a complete staging environment boots, with its documentation closed ──


class TestBoot:
    def test_staging_starts_and_serves_no_interactive_documentation(self, tmp_path: Path) -> None:
        backend = Path(__file__).resolve().parents[1]
        env = {
            "PATH": os.environ["PATH"],
            "PYTHONPATH": str(backend),  # tmp_path as the working directory: no .env is read
            **{key: str(value) for key, value in STAGING.items()},
        }
        probe = "from app.main import app; " "print(app.docs_url, app.redoc_url, app.openapi_url)"

        done = subprocess.run(
            [sys.executable, "-c", probe], env=env, cwd=tmp_path, capture_output=True, text=True
        )

        assert done.returncode == 0, done.stderr[-800:]
        assert done.stdout.strip() == "None None None"

    def test_an_unsafe_staging_environment_does_not_start(self, tmp_path: Path) -> None:
        backend = Path(__file__).resolve().parents[1]
        env = {
            "PATH": os.environ["PATH"],
            "PYTHONPATH": str(backend),
            **{key: str(value) for key, value in STAGING.items()},
            "REDIS_URL": f"redis://default:{REDIS_SECRET}@eu1-x.upstash.example:6379",
        }

        done = subprocess.run(
            [sys.executable, "-c", "import app.main"],
            env=env,
            cwd=tmp_path,
            capture_output=True,
            text=True,
        )

        assert done.returncode != 0
        assert "REDIS_URL must use rediss://" in done.stderr
        assert REDIS_SECRET not in done.stderr and DB_SECRET not in done.stderr

    def test_development_keeps_the_documentation(self) -> None:
        assert settings.is_development
        assert app.docs_url == "/docs" and app.openapi_url == "/openapi.json"


# ── the readiness probe ──────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _fresh_readiness() -> None:
    readiness._states.clear()


@pytest.fixture
async def root(client: AsyncClient) -> AsyncIterator[AsyncClient]:
    """A client for paths outside the API prefix (/health), sharing `client`'s overrides."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as plain:
        yield plain


class TestLivenessAndReadiness:
    async def test_liveness_never_touches_a_dependency(
        self, root: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def boom(*_: Any) -> None:
            raise AssertionError("liveness must not probe anything")

        monkeypatch.setattr(readiness, "_database", boom)
        monkeypatch.setattr(readiness, "_redis", boom)

        response = await root.get("/health")

        assert response.status_code == 200 and response.json()["status"] == "ok"

    async def test_ready_when_database_and_redis_answer(self, root: AsyncClient) -> None:
        response = await root.get("/health/ready")

        assert response.status_code == 200
        assert response.json() == {"status": "ready"}
        assert response.headers["cache-control"] == "no-store"

    async def test_not_ready_without_redis_and_it_says_nothing_else(
        self, root: AsyncClient
    ) -> None:
        app.dependency_overrides[get_rate_limiter] = lambda: DeadRedis.refusing_limiter()

        response = await root.get("/health/ready")

        assert response.status_code == 503
        assert response.json() == {"status": "unavailable"}
        for word in ("redis", "database", "127.0.0.1", "Connection"):
            assert word.lower() not in response.text.lower()

    async def test_not_ready_without_the_database(
        self, root: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def down(_: Any) -> None:
            raise ConnectionRefusedError("password=hunter2 host=db.internal")

        monkeypatch.setattr(readiness, "_database", down)

        response = await root.get("/health/ready")

        assert response.status_code == 503
        assert response.json() == {"status": "unavailable"}

    async def test_a_hanging_dependency_is_cut_off(
        self, root: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def hangs(_: Any) -> None:
            await asyncio.sleep(30)

        monkeypatch.setattr(readiness, "_database", hangs)
        monkeypatch.setattr(readiness, "CHECK_TIMEOUT_SECONDS", 0.2)

        started = asyncio.get_running_loop().time()
        response = await root.get("/health/ready")

        assert response.status_code == 503
        assert asyncio.get_running_loop().time() - started < 3

    async def test_the_answer_is_cached_and_concurrent_callers_share_one_check(
        self, root: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        probes = 0

        async def counted(_: Any) -> None:
            nonlocal probes
            probes += 1
            await asyncio.sleep(0.05)

        monkeypatch.setattr(readiness, "_database", counted)

        answers = await asyncio.gather(*(root.get("/health/ready") for _ in range(20)))
        again = await root.get("/health/ready")

        assert {a.status_code for a in answers} == {200} and again.status_code == 200
        assert probes == 1  # twenty callers and a later one cost a single database probe

    async def test_the_cache_expires(
        self, root: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        probes = 0

        async def counted(_: Any) -> None:
            nonlocal probes
            probes += 1

        monkeypatch.setattr(readiness, "_database", counted)
        monkeypatch.setattr(readiness, "CACHE_SECONDS", 0.05)

        await root.get("/health/ready")
        await asyncio.sleep(0.1)
        await root.get("/health/ready")

        assert probes == 2


# ── Redis over TLS: the certificate AND the hostname are checked ─────────


class TlsFront:
    """A TLS listener that relays to the test Redis, like a hosted Redis's TLS endpoint."""

    def __init__(self, certificate: Path, key: Path) -> None:
        import ssl

        self._context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self._context.load_cert_chain(certificate, key)
        self._server: asyncio.Server | None = None
        self.connections = 0

    async def start(self) -> int:
        self._server = await asyncio.start_server(self._relay, "127.0.0.1", 0, ssl=self._context)
        return int(self._server.sockets[0].getsockname()[1])

    async def stop(self) -> None:
        assert self._server is not None
        self._server.close()
        await self._server.wait_closed()

    async def _relay(self, client_r: asyncio.StreamReader, client_w: asyncio.StreamWriter) -> None:
        self.connections += 1  # only a completed handshake gets here
        target = urlsplit(settings.REDIS_URL)
        upstream_r, upstream_w = await asyncio.open_connection(target.hostname, target.port or 6379)

        async def pipe(source: asyncio.StreamReader, sink: asyncio.StreamWriter) -> None:
            try:
                while data := await source.read(65536):
                    sink.write(data)
                    await sink.drain()
            except (ConnectionError, OSError):
                pass
            finally:
                sink.close()

        await asyncio.gather(pipe(client_r, upstream_w), pipe(upstream_r, client_w))


@pytest.fixture
async def tls_front(tmp_path: Path) -> AsyncIterator[tuple[TlsFront, int, Path]]:
    authority = make_authority()
    issued = issue(authority, "redis.staging.test")
    (tmp_path / "ca.crt").write_bytes(authority.pem)
    (tmp_path / "server.crt").write_bytes(issued.certificate_pem)
    (tmp_path / "server.key").write_bytes(issued.key_pem)
    front = TlsFront(tmp_path / "server.crt", tmp_path / "server.key")
    port = await front.start()
    yield front, port, tmp_path / "ca.crt"
    await front.stop()


def tls_limiter(port: int, host: str = "127.0.0.1") -> RateLimiter:
    plain = urlsplit(rate_limit_test_url())
    url = f"rediss://{host}:{port}{plain.path}"
    return RateLimiter(url, key_prefix="bt:rl:test:tls", secret=b"s" * 32, timeout_seconds=2)


class TestRedisOverTls:
    async def test_the_limiters_scripts_work_over_a_verified_tls_connection(
        self, tls_front: tuple[TlsFront, int, Path], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        front, port, ca = tls_front
        monkeypatch.setenv("SSL_CERT_FILE", str(ca))
        limiter = tls_limiter(port)
        bucket = Bucket("tls-probe", f"{port}", limit=2, window_seconds=30)
        try:
            first = await limiter.admit([bucket], message="x")
            await limiter.admit([bucket], message="x")
            with pytest.raises(RateLimitedError):
                await limiter.admit([bucket], message="x")
            await first.refund()
            await limiter.admit([bucket], message="x")  # the refund gave one back
            ttl = await limiter.connection().pttl(limiter.key_for(bucket))
            assert 0 < ttl <= 30_000
            await limiter.connection().delete(limiter.key_for(bucket))
        finally:
            await limiter.aclose()
        assert front.connections >= 1

    async def test_a_certificate_for_another_hostname_is_refused(
        self, tls_front: tuple[TlsFront, int, Path], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        front, port, ca = tls_front
        monkeypatch.setenv("SSL_CERT_FILE", str(ca))  # the CA IS trusted
        limiter = tls_limiter(port, host="localhost")  # but the certificate does not name it
        try:
            with pytest.raises(ServiceUnavailableError):
                await limiter.admit([Bucket("tls-probe", "x", 1, 30)], message="x")
        finally:
            await limiter.aclose()
        assert front.connections == 0  # no command ever reached Redis

    async def test_a_certificate_from_an_unknown_authority_is_refused(
        self, tls_front: tuple[TlsFront, int, Path]
    ) -> None:
        front, port, _ = tls_front  # SSL_CERT_FILE is not set: the CA is not trusted
        limiter = tls_limiter(port)
        try:
            with pytest.raises(ServiceUnavailableError):
                await limiter.admit([Bucket("tls-probe", "x", 1, 30)], message="x")
        finally:
            await limiter.aclose()
        assert front.connections == 0

    async def test_plain_redis_urls_get_no_tls_options(self) -> None:
        from app.core.ratelimit import _tls_options

        assert _tls_options("redis://redis:6379/0") == {}
        assert _tls_options("rediss://h:6379/0") == {
            "ssl_cert_reqs": "required",
            "ssl_check_hostname": True,
        }
