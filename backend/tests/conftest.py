"""Shared pytest fixtures.

Tests run against a real PostgreSQL database, not a mock or SQLite. The schema
relies on PostgreSQL-specific features (CITEXT, gen_random_uuid, triggers,
AT TIME ZONE), so testing against anything else would prove very little.

A dedicated `bodytrack_test` database is dropped and recreated once per test
session, then brought to the latest schema with `alembic upgrade head` — the
exact same migrations production applies. That means every run also verifies
the migration chain itself still applies cleanly, the same value the old
schema_v1.sql-loading setup had.

Run them with:
    docker compose exec backend pytest
"""

import asyncio
from collections.abc import AsyncGenerator
from pathlib import Path

import asyncpg  # type: ignore[import-untyped]
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from alembic import command
from alembic.config import Config
from app.core.config import settings
from app.core.database import get_db
from app.main import app

TEST_DB_NAME = "bodytrack_test"
BACKEND_ROOT = Path(__file__).resolve().parent.parent
ALEMBIC_INI_PATH = BACKEND_ROOT / "alembic.ini"

_base_url = make_url(settings.DATABASE_URL)
_test_url = _base_url.set(database=TEST_DB_NAME)


def _asyncpg_kwargs(database: str) -> dict[str, object]:
    """Connection arguments for a raw asyncpg connect().

    SQLAlchemy is bypassed here because CREATE DATABASE cannot run inside a
    transaction, which SQLAlchemy's engine would otherwise wrap it in.
    """
    return {
        "user": _base_url.username,
        "password": _base_url.password,
        "host": _base_url.host,
        "port": _base_url.port or 5432,
        "database": database,
    }


@pytest.fixture(scope="session")
def _database_ready() -> None:
    """Create the test database and migrate it to head. Runs once per session.

    Deliberately a *sync* fixture that opens its own short-lived event loop
    for database creation. A session-scoped async fixture would be bound to
    a session-scoped event loop, while the tests themselves run in
    per-function loops, and asyncpg connections cannot be shared across
    loops. Doing the setup in an isolated loop sidesteps that entirely.
    """

    async def _create_database() -> None:
        # "postgres" is the maintenance database; you cannot drop the database
        # you are currently connected to.
        admin = await asyncpg.connect(**_asyncpg_kwargs("postgres"))
        try:
            # WITH (FORCE) kicks out leftover connections from an aborted run.
            await admin.execute(f'DROP DATABASE IF EXISTS "{TEST_DB_NAME}" WITH (FORCE)')
            # Same locale as production; collation affects CITEXT case folding
            # and lower(), so a mismatch would let real bugs slip through.
            await admin.execute(
                f'CREATE DATABASE "{TEST_DB_NAME}" '
                "TEMPLATE template0 ENCODING 'UTF8' LOCALE 'C.UTF-8'"
            )
        finally:
            await admin.close()

    asyncio.run(_create_database())

    # alembic/env.py reads settings.DATABASE_URL by default (the real app
    # database) unless the Config already carries a url — set it explicitly
    # here so migrations land on bodytrack_test, not the dev database.
    alembic_cfg = Config(str(ALEMBIC_INI_PATH))
    # str(_test_url) would render the password as "***" (SQLAlchemy's default
    # URL repr masks it) and alembic would then try to connect with a literal
    # "***" password — must opt out of masking explicitly.
    alembic_cfg.set_main_option("sqlalchemy.url", _test_url.render_as_string(hide_password=False))
    command.upgrade(alembic_cfg, "head")


@pytest.fixture
async def db_engine(_database_ready: None) -> AsyncGenerator[AsyncEngine, None]:
    """A fresh engine per test, bound to that test's event loop."""
    engine = create_async_engine(_test_url, echo=False)
    yield engine
    await engine.dispose()


@pytest.fixture(autouse=True)
async def _clean_tables(db_engine: AsyncEngine) -> AsyncGenerator[None, None]:
    """Remove test-created rows after each test, keeping the seed catalogue.

    DELETE rather than TRUNCATE CASCADE: exercises.created_by references
    users, so TRUNCATE users CASCADE would wipe the seeded exercise catalogue
    too. DELETE follows the per-row rules instead — cascading to
    refresh_tokens, workouts and sets, and leaving exercises alone.
    """
    yield
    async with db_engine.begin() as conn:
        await conn.execute(text("DELETE FROM users"))


@pytest.fixture
async def db(db_engine: AsyncEngine) -> AsyncGenerator[AsyncSession, None]:
    """Direct database access, for asserting on state the API does not expose."""
    factory = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session


@pytest.fixture
async def client(db_engine: AsyncEngine) -> AsyncGenerator[AsyncClient, None]:
    """HTTP client wired to the app, with get_db pointed at the test database."""
    factory = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)

    async def _override_get_db() -> AsyncGenerator[AsyncSession, None]:
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db
    # ASGITransport talks to the app in-process: no uvicorn, no open port.
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test/api/v1"
    ) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def register_payload() -> dict[str, str]:
    """A valid registration body. Copy and tweak per test."""
    return {
        "email": "efe@example.com",
        "username": "efe",
        "password": "supersecret123",
        "first_name": "Efe",
    }


@pytest.fixture
async def auth_headers(
    client: AsyncClient, register_payload: dict[str, str]
) -> dict[str, str]:
    """Register a user and return headers carrying their access token."""
    response = await client.post("/auth/register", json=register_payload)
    assert response.status_code == 201, response.text
    token = response.json()["tokens"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def other_auth_headers(client: AsyncClient) -> dict[str, str]:
    """A second, unrelated account.

    Used to prove that one user cannot read or mutate another's data — the
    kind of hole that stays silent until it leaks real user data.
    """
    response = await client.post(
        "/auth/register",
        json={
            "email": "intruder@example.com",
            "username": "intruder",
            "password": "supersecret123",
        },
    )
    assert response.status_code == 201, response.text
    token = response.json()["tokens"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def bench_press_id(client: AsyncClient, auth_headers: dict[str, str]) -> str:
    """Id of a seeded exercise, for building workouts in tests."""
    response = await client.get("/exercises?q=barbell bench", headers=auth_headers)
    assert response.status_code == 200, response.text
    return str(response.json()["items"][0]["id"])


@pytest.fixture
async def squat_id(client: AsyncClient, auth_headers: dict[str, str]) -> str:
    response = await client.get("/exercises?q=back squat", headers=auth_headers)
    assert response.status_code == 200, response.text
    return str(response.json()["items"][0]["id"])