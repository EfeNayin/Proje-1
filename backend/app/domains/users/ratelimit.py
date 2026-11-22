"""Throttle for account deletion, which re-checks the current password.

A stolen access token must not become a way to guess the password, so every
deletion attempt spends one attempt before the password is looked at. The counters
live in Redis (app/core/ratelimit.py), shared with sign-in and invites, so the cap
holds across worker processes and restarts.

An attempt is counted in two buckets: the signed-in account (only that account can
spend it, so nobody can lock someone else out) and the requester's address. A right
password gives the attempt back; only wrong ones stay counted.
"""

from typing import Annotated

from fastapi import Depends

from app.core.config import settings
from app.core.ratelimit import Admission, Bucket, Limiter, RateLimiter, Requester
from app.models import User


class AccountDeletionThrottle:
    def __init__(self, limiter: RateLimiter, requester: str) -> None:
        self._limiter = limiter
        self._requester = requester

    async def begin(self, caller: User) -> Admission:
        """Count an attempt now, or raise 429 if this account or address is used up.

        Counted before the password is checked: counting only afterwards would let a
        burst of parallel requests all pass the check first and overshoot.
        """
        return await self._limiter.admit(
            [
                Bucket(
                    "account-delete:user",
                    str(caller.id),
                    settings.RATE_LIMIT_DELETE_USER_LIMIT,
                    settings.RATE_LIMIT_DELETE_USER_WINDOW_SECONDS,
                ),
                Bucket(
                    "account-delete:ip",
                    self._requester,
                    settings.RATE_LIMIT_DELETE_IP_LIMIT,
                    settings.RATE_LIMIT_DELETE_IP_WINDOW_SECONDS,
                ),
            ],
            message="Too many attempts to delete the account.",
        )


def get_account_deletion_throttle(
    limiter: Limiter, requester: Requester
) -> AccountDeletionThrottle:
    return AccountDeletionThrottle(limiter, requester)


Throttle = Annotated[AccountDeletionThrottle, Depends(get_account_deletion_throttle)]
