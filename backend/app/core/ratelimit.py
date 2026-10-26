"""Rate limiting shared across backend processes, kept in Redis.

Each limit is a fixed-window counter: the first admitted request opens a window
of `window_seconds`, every admitted request adds one, and once the counter
reaches `limit` further requests are refused until the window ends and Redis
deletes the key. A fixed window lets a caller spend two allowances back to back
across a window boundary; at these limits that is an acceptable price for one
key per bucket and an exact, cheap decision (a sliding log would need a sorted
set per bucket).

What makes it safe to share:

* The decision is one Lua script, so reading the counters, comparing them, and
  adding to them cannot interleave with another request, in this process or any
  other. A parallel burst therefore cannot overshoot a limit.
* A request that spans several buckets (say a requester bucket and an account
  bucket) is admitted by all of them or by none, and a refused request adds
  nothing. A flood that is turned away by one bucket does not spend the others,
  so someone hammering from one address cannot use up an account's allowance
  from the safe side of a bigger limit.
* Every key gets a TTL when it is created (and one is restored if a key is ever
  found without), so the number of keys is bounded by what callers can create
  inside one window, never by how long the process has been running.
* Time is Redis's: windows do not depend on any backend clock.

What never reaches Redis or the logs: the subject of a bucket (an email address,
a client address, a user id) is replaced by a keyed hash before it is used in a
key, so Redis holds no email addresses, addresses or ids, and the keys cannot be
reversed or guessed without the server's secret.

If Redis cannot answer in time, the request is refused with 503 (never admitted,
and never counted in a per-process fallback). After a failure the limiter keeps
refusing for a couple of seconds without touching Redis, so an outage costs one
timeout per interval and not one per request.
"""

import asyncio
import hashlib
import hmac
import ipaddress
import logging
import math
import time
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import Depends, Request
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core.config import settings
from app.core.exceptions import RateLimitedError, ServiceUnavailableError

logger = logging.getLogger(__name__)

# How long to answer 503 without asking Redis again after it failed, and what
# Retry-After to send with that 503. Not settings: they only shape failure behaviour.
UNAVAILABLE_COOLDOWN_SECONDS = 2.0
UNAVAILABLE_RETRY_AFTER_SECONDS = 10

# KEYS[i] is a bucket, ARGV[2i-1] its limit and ARGV[2i] its window in ms.
# Returns {1, 0} when every bucket admitted (and each was incremented), or
# {0, ms} when some bucket is full (nothing was incremented) with the longest wait.
_ADMIT_SCRIPT = """
local wait = 0
for i, key in ipairs(KEYS) do
  local limit = tonumber(ARGV[2 * i - 1])
  local window = tonumber(ARGV[2 * i])
  local used = tonumber(redis.call('GET', key) or '0')
  if used > 0 then
    local ttl = redis.call('PTTL', key)
    if ttl < 0 then
      redis.call('PEXPIRE', key, window)
      ttl = window
    end
    if used >= limit and ttl > wait then
      wait = ttl
    end
  end
end
if wait > 0 then
  return {0, wait}
end
for i, key in ipairs(KEYS) do
  if redis.call('INCR', key) == 1 then
    redis.call('PEXPIRE', key, tonumber(ARGV[2 * i]))
  end
end
return {1, 0}
"""

# Takes one admission back from each bucket, never below zero. The key keeps its
# TTL, so the window it belongs to is unchanged.
_REFUND_SCRIPT = """
for _, key in ipairs(KEYS) do
  local used = tonumber(redis.call('GET', key) or '0')
  if used > 0 then
    redis.call('DECR', key)
  end
end
return {1}
"""


@dataclass(frozen=True)
class Bucket:
    """One counter: `limit` admissions per `window_seconds` for one subject in one scope."""

    scope: str  # names the operation and kind of limit, e.g. "login:ip"; keeps counters apart
    subject: str  # who is counted; hashed before it is used in a key
    limit: int
    window_seconds: int


def format_wait(seconds: int) -> str:
    """A wait as people say it: '40 seconds', '12 minutes', '2 hours'."""
    if seconds < 60:
        return "1 second" if seconds <= 1 else f"{seconds} seconds"
    if seconds < 5400:
        minutes = math.ceil(seconds / 60)
        return "1 minute" if minutes == 1 else f"{minutes} minutes"
    return f"{math.ceil(seconds / 3600)} hours"


class Admission:
    """The result of an admitted request, so a caller can take the count back."""

    def __init__(self, limiter: "RateLimiter", buckets: Sequence[Bucket]) -> None:
        self._limiter = limiter
        self._buckets = tuple(buckets)

    async def refund(self) -> None:
        """Give the attempt back, e.g. because the password or the code turned out right.

        Best effort: if Redis cannot answer, the caller loses one attempt, which
        errs on the side of the limit, so the request is not failed over it.
        """
        try:
            await self._limiter.refund(self._buckets)
        except ServiceUnavailableError:
            logger.warning("rate limit refund skipped: backend unavailable")


class RateLimiter:
    def __init__(
        self,
        redis_url: str,
        *,
        key_prefix: str,
        secret: bytes,
        timeout_seconds: float,
    ) -> None:
        self._url = redis_url
        self._prefix = key_prefix
        self._timeout = timeout_seconds
        # A subkey, so the JWT secret itself never keys anything else.
        self._hash_key = hmac.new(secret, b"bodytrack/ratelimit/v1", hashlib.sha256).digest()
        self._client: Redis | None = None
        self._admit: Any = None
        self._refund: Any = None
        self._unavailable_until = 0.0

    @classmethod
    def from_settings(
        cls, redis_url: str | None = None, key_prefix: str | None = None
    ) -> "RateLimiter":
        return cls(
            redis_url or settings.REDIS_URL,
            key_prefix=key_prefix or settings.RATE_LIMIT_KEY_PREFIX,
            secret=settings.JWT_SECRET_KEY.encode(),
            timeout_seconds=settings.RATE_LIMIT_REDIS_TIMEOUT_SECONDS,
        )

    @property
    def key_prefix(self) -> str:
        return self._prefix

    def key_for(self, bucket: Bucket) -> str:
        digest = hmac.new(
            self._hash_key, f"{bucket.scope}\0{bucket.subject}".encode(), hashlib.sha256
        ).hexdigest()[:32]
        return f"{self._prefix}:{bucket.scope}:{digest}"

    def connection(self) -> Redis:
        """The Redis client, created on first use (also for tests and diagnostics)."""
        if self._client is None:
            # Both timeouts are short on purpose, and nothing is retried here: a
            # limiter that waits and retries turns a Redis outage into a pile-up.
            self._client = Redis.from_url(
                self._url,
                socket_connect_timeout=self._timeout,
                socket_timeout=self._timeout,
                retry_on_timeout=False,
            )
            self._admit = self._client.register_script(_ADMIT_SCRIPT)
            self._refund = self._client.register_script(_REFUND_SCRIPT)
        return self._client

    def _unavailable(self) -> ServiceUnavailableError:
        return ServiceUnavailableError(retry_after=UNAVAILABLE_RETRY_AFTER_SECONDS)

    async def _run(self, script_name: str, keys: list[str], args: list[int]) -> list[int]:
        if time.monotonic() < self._unavailable_until:
            raise self._unavailable()
        try:
            self.connection()
            script = self._admit if script_name == "admit" else self._refund
            # The socket timeouts cover a stalled read or connect; this covers
            # everything else (acquiring a connection, a slow script).
            async with asyncio.timeout(self._timeout * 3):
                result = await script(keys=keys, args=args)
        except (RedisError, OSError, TimeoutError) as exc:
            self._unavailable_until = time.monotonic() + UNAVAILABLE_COOLDOWN_SECONDS
            # The class only: messages can carry the connection URL.
            logger.warning("rate limit backend unavailable (%s)", type(exc).__name__)
            raise self._unavailable() from None
        return [int(value) for value in result]

    async def admit(self, buckets: Sequence[Bucket], *, message: str) -> Admission:
        """Count this request in every bucket, or raise 429 and count nothing."""
        keys = [self.key_for(bucket) for bucket in buckets]
        args: list[int] = []
        for bucket in buckets:
            args += [bucket.limit, bucket.window_seconds * 1000]
        admitted, wait_ms = await self._run("admit", keys, args)
        if not admitted:
            retry_after = max(1, math.ceil(wait_ms / 1000))
            raise RateLimitedError(
                f"{message} Try again in {format_wait(retry_after)}.", retry_after=retry_after
            )
        return Admission(self, buckets)

    async def refund(self, buckets: Sequence[Bucket]) -> None:
        await self._run("refund", [self.key_for(bucket) for bucket in buckets], [])

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None


_limiter: RateLimiter | None = None


def get_rate_limiter() -> RateLimiter:
    """The process-wide limiter. A FastAPI dependency, so tests can swap it."""
    global _limiter
    if _limiter is None:
        _limiter = RateLimiter.from_settings()
    return _limiter


async def close_rate_limiter() -> None:
    global _limiter
    if _limiter is not None:
        await _limiter.aclose()
        _limiter = None


def requester_address(request: Request) -> str:
    """The address of whoever is connected to this server, as the transport reports it.

    Deliberately nothing but the connection: X-Forwarded-For and similar headers
    are written by the caller, so reading them here would let anyone pick the
    bucket they are counted in. A reverse proxy is the one party that may speak
    for the caller, and uvicorn applies the header only for peers listed in
    FORWARDED_ALLOW_IPS; see README.md ("Hız sınırları") for the supported model.

    IPv6 callers are grouped by /64, the smallest block one subscriber
    controls, so rotating through addresses inside it does not mint new buckets.
    """
    host = request.client.host if request.client else ""
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return f"other:{host}"
    if isinstance(address, ipaddress.IPv6Address):
        if address.ipv4_mapped is not None:
            return str(address.ipv4_mapped)
        return str(ipaddress.ip_network(f"{address}/64", strict=False))
    return str(address)


Limiter = Annotated[RateLimiter, Depends(get_rate_limiter)]
Requester = Annotated[str, Depends(requester_address)]
