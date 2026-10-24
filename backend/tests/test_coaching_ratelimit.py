"""The failure limiter on its own, with a fake clock."""

from uuid import uuid4

import pytest

from app.core.exceptions import RateLimitedError
from app.domains.coaching.ratelimit import FailureLimiter


def test_blocks_after_the_limit_and_recovers_when_the_window_passes() -> None:
    now = [0.0]
    limiter = FailureLimiter(max_failures=3, window_seconds=60, clock=lambda: now[0])
    user = uuid4()

    for _ in range(3):
        limiter.begin(user)
    with pytest.raises(RateLimitedError):
        limiter.begin(user)

    now[0] = 61.0
    limiter.begin(user)  # the old failures have aged out


def test_users_are_counted_separately() -> None:
    limiter = FailureLimiter(max_failures=1, window_seconds=60)
    first, second = uuid4(), uuid4()
    limiter.begin(first)

    with pytest.raises(RateLimitedError):
        limiter.begin(first)
    limiter.begin(second)


def test_a_forgiven_attempt_does_not_count() -> None:
    limiter = FailureLimiter(max_failures=2, window_seconds=60)
    user = uuid4()

    for _ in range(10):
        limiter.begin(user)
        limiter.forgive(user)  # every attempt was a real code

    limiter.begin(user)
    limiter.begin(user)
    with pytest.raises(RateLimitedError):
        limiter.begin(user)
