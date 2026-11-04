"""Read-only compatibility check for a hosted database and Redis.

    python -m app.preflight

Run it with the SAME environment variables the service will use (ENVIRONMENT=staging,
the real DATABASE_URL and REDIS_URL, ...) from any machine that can reach them, before the
first deploy and after changing a provider setting. It answers, in plain lines, the
questions that only the real services can answer:

  * the settings pass the deployment safety checks;
  * the database connection is TLS, the server's version, the collation behaviour the
    schema depends on (Turkish case folding), the extensions the baseline migration
    needs, and whether this role may create objects;
  * Redis answers, over TLS, and the limiter's real Lua scripts behave (a second request
    over the limit is refused, the key has a TTL, a refund gives the count back).

It never writes to the application schema, never sends email, and prints no URL, host,
password or key: a failure shows the exception class only. The Redis probe uses a
throwaway key prefix with a TTL and deletes what it created. Exit status 1 if any check
failed.
"""

import asyncio
import secrets
import sys
import time
from collections.abc import Awaitable, Callable

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import get_settings
from app.core.dburl import engine_arguments
from app.core.exceptions import RateLimitedError
from app.core.ratelimit import Bucket, RateLimiter

REQUIRED_EXTENSIONS = ("citext", "pgcrypto", "unaccent", "pg_trgm")
CONNECT_TIMEOUT_SECONDS = 60  # a suspended hosted database needs a moment to wake up

failures = 0


def report(ok: bool, name: str, detail: str = "") -> None:
    global failures
    if not ok:
        failures += 1
    print(f"{'ok  ' if ok else 'FAIL'} {name}" + (f": {detail}" if detail else ""))


async def guarded(name: str, check: Callable[[], Awaitable[None]]) -> None:
    try:
        await check()
    except Exception as error:  # noqa: BLE001 - the class is the report; messages can hold hosts
        report(False, name, f"{type(error).__name__}")


async def check_database() -> None:
    settings = get_settings()
    url, connect_args = engine_arguments(settings.DATABASE_URL)
    engine = create_async_engine(
        url,
        poolclass=NullPool,
        connect_args={**connect_args, "timeout": CONNECT_TIMEOUT_SECONDS},
    )
    try:
        async with engine.connect() as conn:
            started = time.monotonic()
            version = (await conn.execute(text("SHOW server_version"))).scalar_one()
            report(True, "database connect", f"server {version}, {time.monotonic() - started:.2f}s")

            tls = (
                await conn.execute(text("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()"))
            ).scalar_one_or_none()
            report(tls is True, "database connection is TLS-encrypted")

            collation = (
                await conn.execute(
                    text(
                        "SELECT datcollate || ' / ' || datctype FROM pg_database "
                        "WHERE datname = current_database()"
                    )
                )
            ).scalar_one()
            folded = (
                await conn.execute(
                    text("SELECT lower('GÖĞÜS') = 'göğüs' AND lower('INCLINE') = 'incline'")
                )
            ).scalar_one()
            report(
                bool(folded),
                "case folding (Turkish letters fold, 'I' stays 'i')",
                f"datcollate/datctype = {collation}",
            )

            rows = await conn.execute(
                text(
                    "SELECT name, installed_version IS NOT NULL FROM pg_available_extensions "
                    "WHERE name = ANY(:names)"
                ),
                {"names": list(REQUIRED_EXTENSIONS)},
            )
            known = {name: installed for name, installed in rows}
            for extension in REQUIRED_EXTENSIONS:
                state = (
                    "missing"
                    if extension not in known
                    else "installed"
                    if known[extension]
                    else "available, not installed yet (the baseline migration creates it)"
                )
                report(extension in known, f"extension {extension}", state)

            can_create = (
                await conn.execute(
                    text("SELECT has_schema_privilege(current_user, 'public', 'CREATE')")
                )
            ).scalar_one()
            report(bool(can_create), "role may create objects in schema public")

            table = text("SELECT to_regclass('alembic_version')")
            if (await conn.execute(table)).scalar_one() is None:
                print("info migrations: none applied yet (empty database)")
            else:
                query = text("SELECT version_num FROM alembic_version")
                head = (await conn.execute(query)).scalar_one_or_none()
                print(f"info migrations: database is at revision {head}")
    finally:
        await engine.dispose()


async def check_redis() -> None:
    settings = get_settings()
    prefix = f"bt:preflight:{secrets.token_hex(4)}"
    limiter = RateLimiter.from_settings(key_prefix=prefix)
    bucket = Bucket(scope="probe", subject="preflight", limit=1, window_seconds=30)
    try:
        started = time.monotonic()
        await limiter.connection().ping()
        report(True, "redis ping", f"{time.monotonic() - started:.3f}s")

        started = time.monotonic()
        admission = await limiter.admit([bucket], message="probe")
        first = time.monotonic() - started
        report(
            first < settings.RATE_LIMIT_REDIS_TIMEOUT_SECONDS,
            "limiter script, first admit",
            f"{first:.3f}s (production timeout {settings.RATE_LIMIT_REDIS_TIMEOUT_SECONDS}s)",
        )
        try:
            await limiter.admit([bucket], message="probe")
            report(False, "limiter refuses the request over the limit")
        except RateLimitedError:
            report(True, "limiter refuses the request over the limit")
        ttl = await limiter.connection().pttl(limiter.key_for(bucket))
        report(0 < ttl <= 30_000, "limiter key carries a TTL", f"{ttl} ms")
        await admission.refund()
        again = await limiter.admit([bucket], message="probe")
        report(True, "refund gives the admission back")
        del again
    finally:
        try:
            await limiter.connection().delete(limiter.key_for(bucket))
        except Exception:  # noqa: BLE001 - cleanup only; the key expires within 30 s anyway
            pass
        await limiter.aclose()


def check_configuration() -> None:
    settings = get_settings()  # runs check_deployment_safety; raises with a safe message
    report(
        True,
        "settings pass the deployment safety checks",
        f"ENVIRONMENT={settings.ENVIRONMENT}",
    )
    report(
        settings.mail_configured,
        f"mail transport '{settings.MAIL_TRANSPORT}' is configured (nothing is sent here)",
    )


async def main() -> int:
    try:
        check_configuration()
    except Exception as error:  # noqa: BLE001
        safe = isinstance(error, RuntimeError)  # config's own messages never hold a secret
        report(False, "settings", str(error) if safe else type(error).__name__)
        return 1
    await guarded("database", check_database)
    await guarded("redis", check_redis)
    print(f"{failures} check(s) failed" if failures else "all checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
