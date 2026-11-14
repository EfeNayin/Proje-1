"""Rate limiting policy for the auth endpoints.

Which buckets each operation spends, and why. The numbers are settings (see
app/core/config.py); the mechanism is app/core/ratelimit.py.

Login
  1. requester: every attempt from one client address, checked before the body is
     even looked at and long before bcrypt runs. Caps the CPU a single caller can
     burn and how many accounts it can try.
  2. account + requester: failed attempts for one email from one address. This is
     what stops guessing, and because it is per address, a stranger who types a
     victim's email wrong over and over fills only their own bucket.
  3. account: failed attempts for one email from everywhere. It stops guessing
     spread over many addresses, at a ceiling high enough that locking someone out
     takes a sustained, distributed effort, and it lasts one window, not forever.
  Buckets 2 and 3 are admitted together and refunded together when the password
  turns out right, so only failures stay counted. They are spent before the
  password is checked, which is what makes a parallel burst unable to overshoot.
  They are keyed by the email as typed (case-folded), not by whether it exists,
  so an unknown email and a wrong password are limited, and answered, identically.

Register
  requester only. Registration has no password to guess, but its "already taken"
  answer is an oracle for which emails exist, and every call runs bcrypt.

Refresh
  1. requester, as for login.
  2. account, but only after the refresh token's signature and expiry have been
     verified, so the account id comes from a token this server signed. A token
     that fails verification (forged, tampered, expired, or an access token) never
     reaches this bucket, so nobody can spend another account's allowance with a
     made-up token.

Sign in with Google / Apple (README.md, "Google ve Apple ile giriş")
  Requester only, checked before anything is verified, one bucket per entry point: nonces
  (one row each), sign-ins (a call to the provider each), account creation, and Apple's
  notifications. Linking an existing account by password reuses the login buckets above,
  keyed by the email typed, so it is no easier to guess a password through this door.

Password recovery (README.md, "Parola kurtarma")
  Request a code: requester, address as typed (case-folded) and a resend cooldown on that
  address, admitted together or not at all. Confirm a code: requester and address, spent
  before the code is looked at and given back when it was right. All of them are keyed by
  the typed address, never by whether an account exists, so an unknown address and a
  registered one are limited, and answered, identically. They are separate from every
  login bucket: asking for a code for an address never counts against signing in with it.
  A third, strict limit lives on the code itself (PASSWORD_RESET_MAX_ATTEMPTS, in the
  database; see recovery.py).
"""

from typing import Annotated
from uuid import UUID

from fastapi import Depends

from app.core.config import settings
from app.core.ratelimit import Admission, Bucket, Limiter, RateLimiter, Requester


class AuthThrottle:
    def __init__(self, limiter: RateLimiter, requester: str) -> None:
        self._limiter = limiter
        self._requester = requester

    async def login_requester(self) -> None:
        await self._limiter.admit(
            [
                Bucket(
                    "login:ip",
                    self._requester,
                    settings.RATE_LIMIT_LOGIN_IP_LIMIT,
                    settings.RATE_LIMIT_LOGIN_IP_WINDOW_SECONDS,
                )
            ],
            message="Too many sign-in attempts.",
        )

    async def register_requester(self) -> None:
        await self._limiter.admit(
            [
                Bucket(
                    "register:ip",
                    self._requester,
                    settings.RATE_LIMIT_REGISTER_IP_LIMIT,
                    settings.RATE_LIMIT_REGISTER_IP_WINDOW_SECONDS,
                )
            ],
            message="Too many sign-up attempts.",
        )

    async def refresh_requester(self) -> None:
        await self._limiter.admit(
            [
                Bucket(
                    "refresh:ip",
                    self._requester,
                    settings.RATE_LIMIT_REFRESH_IP_LIMIT,
                    settings.RATE_LIMIT_REFRESH_IP_WINDOW_SECONDS,
                )
            ],
            message="Too many session refreshes.",
        )

    async def social_nonce_requester(self) -> None:
        await self._social("nonce", "Too many sign-in attempts.")

    async def social_signin_requester(self) -> None:
        await self._social("signin", "Too many sign-in attempts.")

    async def social_complete_requester(self) -> None:
        await self._social("complete", "Too many sign-up attempts.")

    async def social_notify_requester(self) -> None:
        await self._social("notify", "Too many notifications.")

    async def _social(self, kind: str, message: str) -> None:
        limit, window = {
            "nonce": (
                settings.RATE_LIMIT_SOCIAL_NONCE_IP_LIMIT,
                settings.RATE_LIMIT_SOCIAL_NONCE_IP_WINDOW_SECONDS,
            ),
            "signin": (
                settings.RATE_LIMIT_SOCIAL_SIGNIN_IP_LIMIT,
                settings.RATE_LIMIT_SOCIAL_SIGNIN_IP_WINDOW_SECONDS,
            ),
            "complete": (
                settings.RATE_LIMIT_SOCIAL_COMPLETE_IP_LIMIT,
                settings.RATE_LIMIT_SOCIAL_COMPLETE_IP_WINDOW_SECONDS,
            ),
            "notify": (
                settings.RATE_LIMIT_SOCIAL_NOTIFY_IP_LIMIT,
                settings.RATE_LIMIT_SOCIAL_NOTIFY_IP_WINDOW_SECONDS,
            ),
        }[kind]
        await self._limiter.admit(
            [Bucket(f"social-{kind}:ip", self._requester, limit, window)], message=message
        )

    async def login_account(self, email: str) -> Admission:
        """Count a login attempt for this email. Refund it if the password was right."""
        account = email.strip().casefold()
        return await self._limiter.admit(
            [
                Bucket(
                    "login:account-ip",
                    f"{account}\0{self._requester}",
                    settings.RATE_LIMIT_LOGIN_ACCOUNT_IP_LIMIT,
                    settings.RATE_LIMIT_LOGIN_ACCOUNT_IP_WINDOW_SECONDS,
                ),
                Bucket(
                    "login:account",
                    account,
                    settings.RATE_LIMIT_LOGIN_ACCOUNT_LIMIT,
                    settings.RATE_LIMIT_LOGIN_ACCOUNT_WINDOW_SECONDS,
                ),
            ],
            message="Too many sign-in attempts.",
        )

    async def recovery_request(self, email: str) -> None:
        """Count a request for a recovery code (also a resend). Refused: 429, nothing counted."""
        account = email.strip().casefold()
        await self._limiter.admit(
            [
                Bucket(
                    "recovery-request:ip",
                    self._requester,
                    settings.RATE_LIMIT_RECOVERY_REQUEST_IP_LIMIT,
                    settings.RATE_LIMIT_RECOVERY_REQUEST_IP_WINDOW_SECONDS,
                ),
                Bucket(
                    "recovery-request:account",
                    account,
                    settings.RATE_LIMIT_RECOVERY_REQUEST_ACCOUNT_LIMIT,
                    settings.RATE_LIMIT_RECOVERY_REQUEST_ACCOUNT_WINDOW_SECONDS,
                ),
                Bucket(
                    "recovery-request:cooldown",
                    account,
                    1,
                    settings.RATE_LIMIT_RECOVERY_RESEND_COOLDOWN_SECONDS,
                ),
            ],
            message="A recovery code was requested recently.",
        )

    async def recovery_confirm(self, email: str) -> Admission:
        """Count an attempt to use a code. Refund it if the code was right."""
        account = email.strip().casefold()
        return await self._limiter.admit(
            [
                Bucket(
                    "recovery-confirm:ip",
                    self._requester,
                    settings.RATE_LIMIT_RECOVERY_CONFIRM_IP_LIMIT,
                    settings.RATE_LIMIT_RECOVERY_CONFIRM_IP_WINDOW_SECONDS,
                ),
                Bucket(
                    "recovery-confirm:account",
                    account,
                    settings.RATE_LIMIT_RECOVERY_CONFIRM_ACCOUNT_LIMIT,
                    settings.RATE_LIMIT_RECOVERY_CONFIRM_ACCOUNT_WINDOW_SECONDS,
                ),
            ],
            message="Too many attempts to use a recovery code.",
        )

    async def refresh_user(self, verified_user_id: UUID) -> None:
        """Count a refresh for an account id taken from a verified token."""
        await self._limiter.admit(
            [
                Bucket(
                    "refresh:user",
                    str(verified_user_id),
                    settings.RATE_LIMIT_REFRESH_USER_LIMIT,
                    settings.RATE_LIMIT_REFRESH_USER_WINDOW_SECONDS,
                )
            ],
            message="Too many session refreshes.",
        )


def get_auth_throttle(limiter: Limiter, requester: Requester) -> AuthThrottle:
    return AuthThrottle(limiter, requester)


Throttle = Annotated[AuthThrottle, Depends(get_auth_throttle)]


# Route dependencies: they run before the handler, so a refused caller never
# reaches the database or bcrypt.
async def limit_login_requester(throttle: Throttle) -> None:
    await throttle.login_requester()


async def limit_register_requester(throttle: Throttle) -> None:
    await throttle.register_requester()


async def limit_refresh_requester(throttle: Throttle) -> None:
    await throttle.refresh_requester()


async def limit_social_nonce_requester(throttle: Throttle) -> None:
    await throttle.social_nonce_requester()


async def limit_social_signin_requester(throttle: Throttle) -> None:
    await throttle.social_signin_requester()


async def limit_social_complete_requester(throttle: Throttle) -> None:
    await throttle.social_complete_requester()


async def limit_social_notify_requester(throttle: Throttle) -> None:
    await throttle.social_notify_requester()
