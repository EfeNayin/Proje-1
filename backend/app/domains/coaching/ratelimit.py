"""Throttle for endpoints that turn a secret code into information.

Invite codes carry ~60 bits of randomness and expire, so guessing is already
impractical; this caps how many wrong guesses can be made anyway. The counters
live in Redis (app/core/ratelimit.py), so the cap holds across worker processes
and restarts.

A lookup spends one attempt in two buckets before it runs: the signed-in account
(only that account can spend it, so nobody can lock someone else out) and the
requester's address (so registering many accounts does not multiply the
guesses). A lookup that finds a real code gives the attempt back; only wrong
guesses stay counted.
"""

from typing import Annotated

from fastapi import Depends

from app.core.config import settings
from app.core.ratelimit import Admission, Bucket, Limiter, RateLimiter, Requester
from app.models import User


class InviteThrottle:
    def __init__(self, limiter: RateLimiter, requester: str) -> None:
        self._limiter = limiter
        self._requester = requester

    async def begin(self, caller: User) -> Admission:
        """Count a code lookup now, or raise 429 if this account or address is used up.

        Counted before the lookup it guards: counting only afterwards would let a
        burst of parallel requests all pass the check first and overshoot.
        """
        return await self._limiter.admit(
            [
                Bucket(
                    "invite:user",
                    str(caller.id),
                    settings.RATE_LIMIT_INVITE_USER_LIMIT,
                    settings.RATE_LIMIT_INVITE_USER_WINDOW_SECONDS,
                ),
                Bucket(
                    "invite:ip",
                    self._requester,
                    settings.RATE_LIMIT_INVITE_IP_LIMIT,
                    settings.RATE_LIMIT_INVITE_IP_WINDOW_SECONDS,
                ),
            ],
            message="Too many wrong codes.",
        )


def get_invite_throttle(limiter: Limiter, requester: Requester) -> InviteThrottle:
    return InviteThrottle(limiter, requester)


Throttle = Annotated[InviteThrottle, Depends(get_invite_throttle)]
