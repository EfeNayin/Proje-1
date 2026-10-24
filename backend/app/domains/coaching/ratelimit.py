"""Throttle for endpoints that turn a secret code into information.

Invite codes carry ~60 bits of randomness and expire, so guessing is already
impractical; this caps how many wrong guesses one account can make anyway.

The project had no rate limiting before this, so this is deliberately small:
an in-process sliding window of lookups per user, of which only the ones that
match no code stay counted. It is per worker process, not shared across
processes or restarts, which is acceptable for the current single-process
deployment; moving it to Redis (already in the stack) is the upgrade path if
the API is ever scaled out.
"""

import time
from collections import defaultdict, deque
from collections.abc import Callable
from uuid import UUID

from app.core.exceptions import RateLimitedError


class FailureLimiter:
    def __init__(
        self,
        max_failures: int,
        window_seconds: float,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._max = max_failures
        self._window = window_seconds
        self._clock = clock
        self._failures: dict[UUID, deque[float]] = defaultdict(deque)

    def _prune(self, key: UUID) -> deque[float]:
        events = self._failures[key]
        cutoff = self._clock() - self._window
        while events and events[0] <= cutoff:
            events.popleft()
        if not events:
            self._failures.pop(key, None)
            return deque()
        return events

    def begin(self, key: UUID) -> None:
        """Count an attempt now, or raise if this user has used theirs up.

        The attempt is counted before the lookup it guards, with no await in
        between: counting only after the lookup lets a burst of parallel
        requests all pass the check first and overshoot the limit.
        """
        events = self._prune(key)
        if len(events) >= self._max:
            raise RateLimitedError("Too many wrong codes. Try again in a few minutes.")
        self._failures[key].append(self._clock())

    def forgive(self, key: UUID) -> None:
        """Take back the latest attempt: the code turned out to be a real one."""
        events = self._failures.get(key)
        if events:
            events.pop()
            if not events:
                self._failures.pop(key, None)

    def reset(self) -> None:
        self._failures.clear()


# 10 wrong codes per 10 minutes per account.
invite_code_limiter = FailureLimiter(max_failures=10, window_seconds=600)
