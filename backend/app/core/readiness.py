"""Dependency readiness: can this process reach its database and Redis right now?

Liveness (`/health`) only says the process answers. Readiness (`/health/ready`) asks the two
things a request needs. It is deliberately small:

  * Each check is bounded (CHECK_TIMEOUT_SECONDS) and its answer is a bare yes/no: the
    caller learns nothing about hosts, credentials or error text. The failing dependency
    and the exception class go to the log, nothing else.
  * The answer is cached for CACHE_SECONDS and concurrent callers share one check, so
    the endpoint cannot be used (it is public) to wake a suspended hosted database or
    burn a hosted Redis's command allowance at the rate a caller chooses.
  * Platform health checks should point at liveness, not here: a probe every few seconds
    would keep the free database awake around the clock.
"""

import asyncio
import logging
import time
import weakref
from collections.abc import Awaitable, Callable

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.ratelimit import RateLimiter

logger = logging.getLogger(__name__)

CHECK_TIMEOUT_SECONDS = 4.0
CACHE_SECONDS = 5.0


class _State:
    checked_at: float = float("-inf")
    result: bool = False
    running: "asyncio.Future[bool] | None" = None


_states: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, _State]" = (
    weakref.WeakKeyDictionary()
)


async def _database(session: AsyncSession) -> None:
    await session.execute(text("SELECT 1"))


async def _redis(limiter: RateLimiter) -> None:
    await limiter.connection().ping()


async def _check(name: str, probe: Callable[[], Awaitable[None]]) -> bool:
    try:
        async with asyncio.timeout(CHECK_TIMEOUT_SECONDS):
            await probe()
    except Exception as error:  # noqa: BLE001 - any failure means "not ready"; only the class is kept
        logger.warning("not ready: %s unavailable (%s)", name, type(error).__name__)
        return False
    return True


async def _run(session: AsyncSession, limiter: RateLimiter) -> bool:
    database, redis = await asyncio.gather(
        _check("database", lambda: _database(session)),
        _check("redis", lambda: _redis(limiter)),
    )
    return database and redis


async def is_ready(session: AsyncSession, limiter: RateLimiter) -> bool:
    loop = asyncio.get_running_loop()
    state = _states.setdefault(loop, _State())
    if time.monotonic() - state.checked_at < CACHE_SECONDS:
        return state.result
    if state.running is None:
        state.running = asyncio.ensure_future(_run(session, limiter))
        state.running.add_done_callback(lambda _: setattr(state, "running", None))
    result = await asyncio.shield(state.running)
    state.result, state.checked_at = result, time.monotonic()
    return result
