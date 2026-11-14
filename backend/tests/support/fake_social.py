"""A stand-in for Google and Apple for the account-flow tests.

The provider boundary is mocked here on purpose: the verification itself (signatures,
issuer, audience, expiry, nonce) is tested against real signed tokens in
tests/test_social_providers.py. This fake decides only WHO a credential vouches for, and
enforces the two properties the account flows rely on: a Google code works once, and an
Apple token is bound to the nonce it was requested with.

Credential formats (strings the tests build with the helpers below):
  google code   "g|<sub>|<email or ''>|<verified 1/0>|<given name or ''>|<unique>"
  apple token   "a|<sub>|<email or ''>|<private 1/0>|<nonce>"
  apple notice  "n|<event type>|<sub>"
  "bad" anywhere is refused; "down" simulates a provider outage.
"""

from dataclasses import dataclass, field
from uuid import uuid4

from cryptography.fernet import Fernet

from app.core.secretbox import SecretBox
from app.domains.auth.social import Social
from app.domains.auth.social_providers import (
    AppleNotification,
    CredentialRejected,
    ProviderUnavailable,
    VerifiedIdentity,
)


def google_code(
    sub: str = "g-1",
    email: str = "lifter@gmail.com",
    *,
    verified: bool = True,
    name: str = "",
) -> str:
    return f"g|{sub}|{email}|{int(verified)}|{name}|{uuid4().hex}"


def apple_token(
    nonce: str, sub: str = "a-1", email: str = "lifter@example.com", *, private: bool = False
) -> str:
    return f"a|{sub}|{email}|{int(private)}|{nonce}"


def notice(event: str, sub: str) -> str:
    return f"n|{event}|{sub}"


@dataclass
class FakeProviders:
    google_enabled: bool = True
    apple_enabled: bool = True
    revoke_fails: bool = False
    exchange_fails: bool = False
    used_codes: set[str] = field(default_factory=set)
    exchanged: list[str] = field(default_factory=list)
    revoked: list[str] = field(default_factory=list)

    async def verify_google(self, authorization_code: str) -> VerifiedIdentity:
        parts = authorization_code.split("|")
        # Only the identity fields are inspected: the trailing unique part is random and could
        # contain "bad" or "down" by chance.
        if "down" in "|".join(parts[:5]):
            raise ProviderUnavailable("down")
        if len(parts) != 6 or parts[0] != "g" or "bad" in "|".join(parts[:5]):
            raise CredentialRejected("bad")
        if authorization_code in self.used_codes:
            raise CredentialRejected("used")  # a server auth code redeems once
        self.used_codes.add(authorization_code)
        _, sub, email, verified, name, _unique = parts
        return VerifiedIdentity(
            provider="google",
            subject=sub,
            email=email or None,
            email_verified=verified == "1",
            first_name=name or None,
        )

    async def verify_apple(self, identity_token: str, nonce: str) -> VerifiedIdentity:
        parts = identity_token.split("|")
        # The nonce (last part) is random; only the identity fields are inspected.
        if "down" in "|".join(parts[:4]):
            raise ProviderUnavailable("down")
        if len(parts) != 5 or parts[0] != "a" or "bad" in "|".join(parts[:4]):
            raise CredentialRejected("bad")
        _, sub, email, private, bound_nonce = parts
        if bound_nonce != nonce:
            raise CredentialRejected("nonce mismatch")
        return VerifiedIdentity(
            provider="apple",
            subject=sub,
            email=email or None,
            email_verified=bool(email),
            is_private_email=private == "1",
        )

    async def apple_refresh_token(self, authorization_code: str) -> str | None:
        self.exchanged.append(authorization_code)
        return None if self.exchange_fails else f"refresh-for-{authorization_code}"

    async def revoke_apple(self, refresh_token: str) -> bool:
        if self.revoke_fails:
            return False
        self.revoked.append(refresh_token)
        return True

    async def verify_apple_notification(self, payload: str) -> AppleNotification:
        parts = payload.split("|")
        if len(parts) != 3 or parts[0] != "n":
            raise CredentialRejected("bad")
        return AppleNotification(event_type=parts[1], subject=parts[2])


def make_social(providers: FakeProviders | None = None) -> tuple[Social, FakeProviders]:
    fake = providers or FakeProviders()
    return Social(providers=fake, box=SecretBox(Fernet.generate_key().decode())), fake
