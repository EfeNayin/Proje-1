"""The shared limiter against a real Redis.

Everything that claims atomicity or sharing is proven here with real Redis
connections (separate clients, and separate OS processes), not mocks. Counters
live in a per-test key prefix in Redis database 15 (see conftest.rate_limiter).
"""

import asyncio
import logging
import subprocess
import sys
import textwrap
import time
from uuid import uuid4

import pytest
from starlette.requests import Request

from app.core.exceptions import RateLimitedError, ServiceUnavailableError
from app.core.ratelimit import (
    UNAVAILABLE_COOLDOWN_SECONDS,
    Bucket,
    RateLimiter,
    format_wait,
    requester_address,
)
from tests.conftest import delete_keys_with_prefix, rate_limit_test_url


def bucket(
    subject: str = "someone", *, scope: str = "test:op", limit: int = 3, window: int = 60
) -> Bucket:
    return Bucket(scope, subject, limit, window)


async def stored_keys(limiter: RateLimiter) -> dict[str, tuple[int, int]]:
    """Every key under this limiter's prefix as {key: (count, ttl_ms)}."""
    redis = limiter.connection()
    found: dict[str, tuple[int, int]] = {}
    async for key in redis.scan_iter(match=f"{limiter.key_prefix}:*", count=500):
        found[key.decode()] = (int(await redis.get(key)), await redis.pttl(key))
    return found


async def count_of(limiter: RateLimiter, target: Bucket) -> int:
    value = await limiter.connection().get(limiter.key_for(target))
    return 0 if value is None else int(value)


class TestThresholdsAndExpiry:
    async def test_admits_up_to_the_limit_then_refuses_with_a_retry_after(
        self, rate_limiter: RateLimiter
    ) -> None:
        target = bucket(limit=3, window=60)
        for _ in range(3):
            await rate_limiter.admit([target], message="Too many.")

        with pytest.raises(RateLimitedError) as refused:
            await rate_limiter.admit([target], message="Too many.")

        assert refused.value.status_code == 429
        assert 1 <= (refused.value.retry_after or 0) <= 60
        assert refused.value.headers == {"Retry-After": str(refused.value.retry_after)}
        assert "Try again in" in refused.value.detail

    async def test_a_refused_request_is_not_counted_and_does_not_extend_the_window(
        self, rate_limiter: RateLimiter
    ) -> None:
        target = bucket(limit=2, window=60)
        await rate_limiter.admit([target], message="x")
        await rate_limiter.admit([target], message="x")
        ttl_before = await rate_limiter.connection().pttl(rate_limiter.key_for(target))

        for _ in range(20):
            with pytest.raises(RateLimitedError):
                await rate_limiter.admit([target], message="x")

        assert await count_of(rate_limiter, target) == 2
        ttl_after = await rate_limiter.connection().pttl(rate_limiter.key_for(target))
        assert 0 < ttl_after <= ttl_before

    async def test_retry_after_follows_the_remaining_window(
        self, rate_limiter: RateLimiter
    ) -> None:
        target = bucket(limit=1, window=600)
        await rate_limiter.admit([target], message="x")
        await rate_limiter.connection().pexpire(rate_limiter.key_for(target), 2500)

        with pytest.raises(RateLimitedError) as refused:
            await rate_limiter.admit([target], message="x")

        assert refused.value.retry_after == 3  # 2.5 s left, rounded up

    async def test_the_window_really_expires(self, rate_limiter: RateLimiter) -> None:
        target = bucket(limit=1, window=1)
        await rate_limiter.admit([target], message="x")
        with pytest.raises(RateLimitedError):
            await rate_limiter.admit([target], message="x")

        await asyncio.sleep(1.2)

        await rate_limiter.admit([target], message="x")  # a fresh window

    async def test_scopes_and_subjects_are_counted_independently(
        self, rate_limiter: RateLimiter
    ) -> None:
        await rate_limiter.admit([bucket("a", scope="login:ip", limit=1)], message="x")

        # Same subject in another operation, and another subject in the same one.
        await rate_limiter.admit([bucket("a", scope="register:ip", limit=1)], message="x")
        await rate_limiter.admit([bucket("b", scope="login:ip", limit=1)], message="x")
        with pytest.raises(RateLimitedError):
            await rate_limiter.admit([bucket("a", scope="login:ip", limit=1)], message="x")


class TestSeveralBuckets:
    async def test_a_request_is_admitted_by_every_bucket_or_by_none(
        self, rate_limiter: RateLimiter
    ) -> None:
        wide = bucket("who", scope="test:wide", limit=100)
        narrow = bucket("who", scope="test:narrow", limit=1)
        await rate_limiter.admit([wide, narrow], message="x")

        with pytest.raises(RateLimitedError):
            await rate_limiter.admit([wide, narrow], message="x")

        # The narrow bucket refused, so the wide one was not spent either.
        assert await count_of(rate_limiter, wide) == 1
        assert await count_of(rate_limiter, narrow) == 1

    async def test_the_longest_wait_is_reported(self, rate_limiter: RateLimiter) -> None:
        short = bucket("who", scope="test:short", limit=1, window=30)
        long = bucket("who", scope="test:long", limit=1, window=900)
        await rate_limiter.admit([short, long], message="x")

        with pytest.raises(RateLimitedError) as refused:
            await rate_limiter.admit([short, long], message="x")

        assert (refused.value.retry_after or 0) > 30


class TestRefund:
    async def test_a_refund_takes_one_attempt_back_and_never_goes_below_zero(
        self, rate_limiter: RateLimiter
    ) -> None:
        target = bucket(limit=2)
        first = await rate_limiter.admit([target], message="x")
        await rate_limiter.admit([target], message="x")
        await first.refund()
        assert await count_of(rate_limiter, target) == 1

        await first.refund()
        await first.refund()
        await first.refund()
        assert await count_of(rate_limiter, target) == 0

    async def test_a_refund_keeps_the_window(self, rate_limiter: RateLimiter) -> None:
        target = bucket(limit=2, window=600)
        admission = await rate_limiter.admit([target], message="x")
        await rate_limiter.connection().pexpire(rate_limiter.key_for(target), 5000)

        await admission.refund()

        ttl = await rate_limiter.connection().pttl(rate_limiter.key_for(target))
        assert 0 < ttl <= 5000


class TestWhatIsStored:
    async def test_keys_hold_no_subject_in_the_clear_and_always_expire(
        self, rate_limiter: RateLimiter
    ) -> None:
        email = "victim.person@example.com"
        address = "203.0.113.77"
        await rate_limiter.admit(
            [
                Bucket("login:account-ip", f"{email}\0{address}", 5, 900),
                Bucket("login:account", email, 50, 3600),
                Bucket("login:ip", address, 40, 600),
            ],
            message="x",
        )

        keys = await stored_keys(rate_limiter)

        assert len(keys) == 3
        for key, (count, ttl_ms) in keys.items():
            assert key.startswith(rate_limiter.key_prefix + ":")
            assert "victim" not in key and "example.com" not in key and "203.0.113" not in key
            assert count == 1
            assert 0 < ttl_ms <= 3_600_000

    async def test_a_key_that_somehow_lost_its_ttl_gets_one_back(
        self, rate_limiter: RateLimiter
    ) -> None:
        target = bucket(limit=5, window=120)
        redis = rate_limiter.connection()
        await redis.set(rate_limiter.key_for(target), 2)  # no expiry
        assert await redis.pttl(rate_limiter.key_for(target)) == -1

        await rate_limiter.admit([target], message="x")

        assert 0 < await redis.pttl(rate_limiter.key_for(target)) <= 120_000

    async def test_the_same_subject_hashes_the_same_but_not_across_scopes_or_secrets(
        self, rate_limiter: RateLimiter
    ) -> None:
        a = rate_limiter.key_for(bucket("same", scope="x:one"))
        assert a == rate_limiter.key_for(bucket("same", scope="x:one"))
        assert a != rate_limiter.key_for(bucket("same", scope="x:two"))
        other_secret = RateLimiter(
            rate_limit_test_url(),
            key_prefix=rate_limiter.key_prefix,
            secret=b"a different server secret entirely",
            timeout_seconds=0.5,
        )
        assert a != other_secret.key_for(bucket("same", scope="x:one"))


class TestConcurrencyAndSharing:
    async def test_a_parallel_burst_cannot_exceed_the_limit(
        self, rate_limiter: RateLimiter
    ) -> None:
        target = bucket(limit=10, window=60)

        async def attempt() -> bool:
            try:
                await rate_limiter.admit([target], message="x")
            except RateLimitedError:
                return False
            return True

        results = await asyncio.gather(*(attempt() for _ in range(80)))

        assert results.count(True) == 10
        assert await count_of(rate_limiter, target) == 10

    async def test_separate_clients_share_one_counter(self, rate_limiter: RateLimiter) -> None:
        # Two limiter objects, each with its own connection pool, stand in for two
        # backend instances: the only thing they have in common is Redis.
        second = RateLimiter.from_settings(rate_limit_test_url(), rate_limiter.key_prefix)
        try:
            target = bucket("shared", limit=10)

            async def attempt(limiter: RateLimiter) -> bool:
                try:
                    await limiter.admit([target], message="x")
                except RateLimitedError:
                    return False
                return True

            results = await asyncio.gather(
                *(attempt(rate_limiter if n % 2 else second) for n in range(60))
            )

            assert results.count(True) == 10
        finally:
            await second.aclose()

    async def test_separate_processes_share_one_counter_and_a_restart_keeps_it(
        self, rate_limiter: RateLimiter
    ) -> None:
        target = bucket("process-shared", limit=8, window=120)
        script = textwrap.dedent(
            """
            import asyncio, sys
            from app.core.exceptions import RateLimitedError
            from app.core.ratelimit import Bucket, RateLimiter

            async def main() -> None:
                url, prefix, attempts = sys.argv[1], sys.argv[2], int(sys.argv[3])
                limiter = RateLimiter.from_settings(url, prefix)
                admitted = 0
                for _ in range(attempts):
                    try:
                        await limiter.admit(
                            [Bucket("test:op", "process-shared", 8, 120)], message="x"
                        )
                        admitted += 1
                    except RateLimitedError:
                        pass
                await limiter.aclose()
                print(admitted)

            asyncio.run(main())
            """
        )

        def run(attempts: int) -> subprocess.Popen[str]:
            return subprocess.Popen(
                [sys.executable, "-c", script, rate_limit_test_url(), rate_limiter.key_prefix,
                 str(attempts)],
                stdout=subprocess.PIPE,
                text=True,
            )

        first, second = run(6), run(6)  # two processes at once: 12 attempts, 8 allowed
        admitted = [int(p.communicate(timeout=60)[0]) for p in (first, second)]
        assert sum(admitted) == 8
        assert await count_of(rate_limiter, target) == 8

        # A brand-new process (a restarted backend) finds the counter where it was.
        restarted = run(3)
        assert int(restarted.communicate(timeout=60)[0]) == 0
        with pytest.raises(RateLimitedError):
            await rate_limiter.admit([target], message="x")


class DeadRedis:
    """Helpers that stand in for a Redis that cannot answer."""

    @staticmethod
    def refusing_limiter() -> RateLimiter:
        # Nothing listens on port 1.
        return RateLimiter(
            "redis://127.0.0.1:1/0",
            key_prefix="bt:rl:test:dead",
            secret=b"s" * 32,
            timeout_seconds=0.2,
        )


class TestRedisFailure:
    async def test_a_refused_connection_is_a_503_never_an_admission(self) -> None:
        limiter = DeadRedis.refusing_limiter()
        try:
            with pytest.raises(ServiceUnavailableError) as failure:
                await limiter.admit([bucket(limit=1000)], message="x")
        finally:
            await limiter.aclose()

        assert failure.value.status_code == 503
        assert failure.value.headers == {"Retry-After": "10"}

    async def test_a_redis_that_accepts_but_never_answers_is_cut_off_by_the_timeout(
        self,
    ) -> None:
        connections = 0

        async def hold_open(_reader: asyncio.StreamReader, _writer: asyncio.StreamWriter) -> None:
            nonlocal connections
            connections += 1
            await asyncio.sleep(30)

        server = await asyncio.start_server(hold_open, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        limiter = RateLimiter(
            f"redis://127.0.0.1:{port}/0",
            key_prefix="bt:rl:test:blackhole",
            secret=b"s" * 32,
            timeout_seconds=0.2,
        )
        try:
            started = time.monotonic()
            with pytest.raises(ServiceUnavailableError):
                await limiter.admit([bucket()], message="x")
            assert time.monotonic() - started < 1.5
            assert connections == 1
        finally:
            await limiter.aclose()
            server.close()

    async def test_after_a_failure_requests_fail_fast_and_redis_is_probed_again_later(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        attempts = 0

        async def count_and_drop(
            _reader: asyncio.StreamReader, writer: asyncio.StreamWriter
        ) -> None:
            nonlocal attempts
            attempts += 1
            writer.close()

        server = await asyncio.start_server(count_and_drop, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        limiter = RateLimiter(
            f"redis://127.0.0.1:{port}/0",
            key_prefix="bt:rl:test:cooldown",
            secret=b"s" * 32,
            timeout_seconds=0.2,
        )
        try:
            with pytest.raises(ServiceUnavailableError):
                await limiter.admit([bucket()], message="x")
            first_round = attempts
            assert first_round >= 1

            # A burst during the cool-down: answered at once, Redis not contacted.
            started = time.monotonic()
            for _ in range(50):
                with pytest.raises(ServiceUnavailableError):
                    await limiter.admit([bucket()], message="x")
            assert time.monotonic() - started < 0.5
            assert attempts == first_round

            await asyncio.sleep(UNAVAILABLE_COOLDOWN_SECONDS + 0.3)
            with pytest.raises(ServiceUnavailableError):
                await limiter.admit([bucket()], message="x")
            assert attempts > first_round  # it did try again
        finally:
            await limiter.aclose()
            server.close()

    async def test_a_failed_refund_does_not_fail_the_request(
        self, rate_limiter: RateLimiter
    ) -> None:
        admission = await rate_limiter.admit([bucket(limit=2)], message="x")
        rate_limiter._unavailable_until = time.monotonic() + 60  # Redis "goes away"

        await admission.refund()  # must not raise

    async def test_the_failure_log_carries_no_connection_details(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        # alembic's fileConfig (run by conftest to build the test database) disables
        # loggers that already exist; switch ours back on for this test.
        logging.getLogger("app.core.ratelimit").disabled = False
        limiter = DeadRedis.refusing_limiter()
        with caplog.at_level("WARNING"), pytest.raises(ServiceUnavailableError):
            await limiter.admit([bucket("hunter2@example.com")], message="x")
        await limiter.aclose()

        logged = " ".join(record.getMessage() for record in caplog.records)
        assert "unavailable" in logged
        assert "127.0.0.1" not in logged and "hunter2" not in logged and "redis://" not in logged


class TestRequesterAddress:
    @staticmethod
    def request(client: tuple[str, int] | None, headers: dict[str, str] | None = None) -> Request:
        raw = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
        return Request({"type": "http", "client": client, "headers": raw})

    def test_it_is_the_connection_peer(self) -> None:
        assert requester_address(self.request(("198.51.100.4", 5555))) == "198.51.100.4"

    def test_forwarding_headers_are_never_read(self) -> None:
        spoofed = {
            "X-Forwarded-For": "1.2.3.4",
            "X-Real-IP": "5.6.7.8",
            "Forwarded": "for=9.9.9.9",
            "CF-Connecting-IP": "8.8.8.8",
        }
        assert requester_address(self.request(("198.51.100.4", 1), spoofed)) == "198.51.100.4"

    def test_an_ipv6_caller_is_grouped_by_its_64(self) -> None:
        one = requester_address(self.request(("2001:db8:1:2:aaaa:bbbb:cccc:dddd", 1)))
        two = requester_address(self.request(("2001:db8:1:2:1111:2222:3333:4444", 1)))
        other = requester_address(self.request(("2001:db8:1:3::1", 1)))

        assert one == two == "2001:db8:1:2::/64"
        assert other != one

    def test_an_ipv4_mapped_ipv6_address_is_the_ipv4_address(self) -> None:
        assert requester_address(self.request(("::ffff:192.0.2.9", 1))) == "192.0.2.9"

    def test_an_unknown_peer_still_gets_a_stable_bucket(self) -> None:
        assert requester_address(self.request(None)) == "other:"
        assert requester_address(self.request(("not-an-ip", 1))) == "other:not-an-ip"


class TestFormatWait:
    @pytest.mark.parametrize(
        ("seconds", "text"),
        [
            (1, "1 second"),
            (40, "40 seconds"),
            (60, "1 minute"),
            (61, "2 minutes"),
            (900, "15 minutes"),
            (5399, "90 minutes"),
            (5400, "2 hours"),
            (7201, "3 hours"),
        ],
    )
    def test_reads_like_a_person_would_say_it(self, seconds: int, text: str) -> None:
        assert format_wait(seconds) == text


async def test_cleanup_removes_only_the_given_prefix(rate_limiter: RateLimiter) -> None:
    other = RateLimiter.from_settings(rate_limit_test_url(), f"bt:rl:test:{uuid4().hex}")
    try:
        await rate_limiter.admit([bucket("mine")], message="x")
        await other.admit([bucket("theirs")], message="x")

        await delete_keys_with_prefix(rate_limiter, rate_limiter.key_prefix)

        assert await stored_keys(rate_limiter) == {}
        assert len(await stored_keys(other)) == 1
    finally:
        await delete_keys_with_prefix(other, other.key_prefix)
        await other.aclose()
