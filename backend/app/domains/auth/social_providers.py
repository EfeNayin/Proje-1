"""Talking to Google and Apple: turning what the phone hands over into a verified identity.

Nothing here knows about accounts or the database; app/domains/auth/social.py does. Every
network call is HTTPS to the provider's own host with a short timeout, and nothing a
provider sent (codes, tokens, claims) is ever logged: failures are reported by kind only.

What counts as proof, per provider
----------------------------------
Google: the app sends a one-time *server auth code* (the SDK mints it for our web client
id). The server redeems it at Google's token endpoint with its client secret, over TLS, and
gets the ID token straight from Google, so a token captured from a phone, a log or a proxy
is of no use: it is never accepted from the client. The code is single-use at Google, which
is the replay protection (the free @react-native-google-signin library cannot put a nonce
in the token; the paid one can). The returned ID token's signature, issuer, audience,
expiry and subject are still checked here.

Apple: the app sends the identity token (a JWT signed by Apple) together with the raw nonce
it obtained from POST /auth/social/nonce and passed to Apple. The token's signature, issuer,
audience, expiry and subject are checked against Apple's published keys, and its `nonce`
claim must match that nonce. The claim holds either the value as given or its SHA-256 hex
digest depending on the client library, so both are accepted; either way it cannot be
produced without the nonce, and the service spends the nonce exactly once.

Email claims (contact data, never an identifier, never a way into an account)
-------------------------------------------------------------------------------
* Google: `sub` identifies the person; `email` can change and is not unique over time. An
  address qualifies as the new account's email only with `email_verified` true. Non-Gmail
  addresses without an `hd` claim are still accepted when verified (consumer Google accounts
  can use any address Google verified), because the address is only a contact detail here.
* Apple: an address is present only if the person shared it, and Apple only supplies
  verified ones. `is_private_email` marks a relay address (...@privaterelay.appleid.com),
  which reaches the person but is not one they type anywhere else, so it never suggests a
  match with an existing account.
"""

import asyncio
import hashlib
import hmac
import json
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx
from jose import jwt
from jose.exceptions import JOSEError

logger = logging.getLogger(__name__)

GOOGLE_ISSUERS = ("accounts.google.com", "https://accounts.google.com")
APPLE_ISSUER = "https://appleid.apple.com"

_MAX_SUBJECT_LENGTH = 255
_CLOCK_LEEWAY_SECONDS = 60
_APPLE_SECRET_LIFETIME_SECONDS = 300


class CredentialRejected(Exception):
    """The credential is not valid (forged, expired, wrong audience, replayed, ...)."""


class ProviderUnavailable(Exception):
    """The provider could not be reached or gave an answer that cannot be used."""


@dataclass(frozen=True)
class VerifiedIdentity:
    """Who the provider vouched for. Holds personal data, so it never prints itself."""

    provider: str
    subject: str
    email: str | None = None
    email_verified: bool = False
    is_private_email: bool = False
    first_name: str | None = None
    last_name: str | None = None
    # Apple only, and only when the authorization code was exchanged.
    apple_refresh_token: str | None = field(default=None, repr=False)

    def __repr__(self) -> str:
        return f"VerifiedIdentity(provider={self.provider!r}, subject=<redacted>)"


@dataclass(frozen=True)
class AppleNotification:
    event_type: str
    subject: str


class SocialProviders(Protocol):
    """What the service needs. The live class below implements it; tests substitute a fake."""

    @property
    def google_enabled(self) -> bool: ...

    @property
    def apple_enabled(self) -> bool: ...

    async def verify_google(self, authorization_code: str) -> VerifiedIdentity: ...

    async def verify_apple(self, identity_token: str, nonce: str) -> VerifiedIdentity: ...

    async def apple_refresh_token(self, authorization_code: str) -> str | None: ...

    async def revoke_apple(self, refresh_token: str) -> bool: ...

    async def verify_apple_notification(self, payload: str) -> AppleNotification: ...


@dataclass(frozen=True)
class SocialConfig:
    google_enabled: bool = False
    google_web_client_id: str | None = None
    google_web_client_secret: str | None = None
    google_code_redirect_uri: str = ""
    google_token_url: str = "https://oauth2.googleapis.com/token"
    google_jwks_url: str = "https://www.googleapis.com/oauth2/v3/certs"

    apple_enabled: bool = False
    apple_client_id: str | None = None
    apple_extra_audiences: tuple[str, ...] = ()
    apple_team_id: str | None = None
    apple_key_id: str | None = None
    apple_private_key: str | None = None
    apple_base_url: str = APPLE_ISSUER

    http_timeout_seconds: float = 5.0

    @property
    def apple_audiences(self) -> list[str]:
        return [a for a in (self.apple_client_id, *self.apple_extra_audiences) if a]


def _as_bool(value: object) -> bool:
    return value is True or (isinstance(value, str) and value.lower() == "true")


def _text(value: object, limit: int = 200) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned[:limit] if cleaned else None


def nonce_matches(claim: object, nonce: str) -> bool:
    """Whether a token's `nonce` claim is this nonce, as given or as its SHA-256 hex digest."""
    if not isinstance(claim, str) or not nonce:
        return False
    digest = hashlib.sha256(nonce.encode()).hexdigest()
    return hmac.compare_digest(claim, nonce) or hmac.compare_digest(claim, digest)


class JwksCache:
    """A provider's public signing keys, fetched over HTTPS and kept for a while.

    Providers rotate keys, so an unknown key id triggers one refetch (at most once per
    cooldown, so a flood of forged key ids cannot make us hammer the provider). If the
    provider cannot be reached, keys already held keep working until they are replaced.
    """

    def __init__(
        self,
        url: str,
        http_factory: Callable[[], httpx.AsyncClient],
        *,
        ttl_seconds: float = 3600,
        refetch_cooldown_seconds: float = 30,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._url = url
        self._http_factory = http_factory
        self._ttl = ttl_seconds
        self._cooldown = refetch_cooldown_seconds
        self._clock = clock
        self._keys: dict[str, dict[str, Any]] | None = None
        self._fetched_at = 0.0
        self._lock = asyncio.Lock()

    async def key(self, kid: str) -> dict[str, Any]:
        now = self._clock()
        if self._keys is None or now - self._fetched_at > self._ttl:
            await self._refresh()
        found = self._keys.get(kid) if self._keys is not None else None
        if found is None and self._clock() - self._fetched_at >= self._cooldown:
            await self._refresh()
            found = self._keys.get(kid) if self._keys is not None else None
        if found is None:
            raise CredentialRejected("unknown signing key")
        return found

    async def _refresh(self) -> None:
        async with self._lock:
            try:
                async with self._http_factory() as http:
                    response = await http.get(self._url)
                if response.status_code != 200:
                    raise ProviderUnavailable("keys")
                fetched = {
                    str(key["kid"]): key
                    for key in response.json()["keys"]
                    if isinstance(key, dict) and "kid" in key
                }
            except (httpx.HTTPError, ValueError, KeyError, TypeError, ProviderUnavailable):
                # Keys already held keep working; with none, the sign-in cannot be checked.
                self._fetched_at = self._clock() - self._ttl + self._cooldown
                if self._keys is None:
                    raise ProviderUnavailable("keys") from None
                return
            self._keys = fetched
            self._fetched_at = self._clock()


async def verify_signed_token(
    token: str,
    keys: JwksCache,
    *,
    issuers: tuple[str, ...],
    audiences: list[str],
) -> dict[str, Any]:
    """Signature (RS256 only), expiry, issued-at, issuer, audience and subject of an ID token."""
    try:
        header = jwt.get_unverified_header(token)
    except JOSEError:
        raise CredentialRejected("malformed token") from None
    kid = header.get("kid")
    if header.get("alg") != "RS256" or not isinstance(kid, str):
        raise CredentialRejected("unsupported token")
    key = await keys.key(kid)
    try:
        claims: dict[str, Any] = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            options={
                "verify_aud": False,
                "verify_iss": False,
                "verify_at_hash": False,
                "require_exp": True,
                "require_iat": True,
                "require_sub": True,
                "leeway": _CLOCK_LEEWAY_SECONDS,
            },
        )
    except JOSEError:
        # JWTError for a bad token; JWKError if the published key itself is unusable.
        raise CredentialRejected("invalid token") from None
    if claims.get("iss") not in issuers:
        raise CredentialRejected("wrong issuer")
    audience = claims.get("aud")
    presented = [audience] if isinstance(audience, str) else audience
    if not isinstance(presented, list) or not set(presented) & set(audiences):
        raise CredentialRejected("wrong audience")
    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject or len(subject) > _MAX_SUBJECT_LENGTH:
        raise CredentialRejected("bad subject")
    return claims


class LiveSocialProviders:
    def __init__(
        self,
        config: SocialConfig,
        http_factory: Callable[[], httpx.AsyncClient] | None = None,
        *,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._config = config
        self._clock = clock
        self._http_factory = http_factory or (
            lambda: httpx.AsyncClient(
                timeout=config.http_timeout_seconds, follow_redirects=False
            )
        )
        self._google_keys = JwksCache(config.google_jwks_url, self._http_factory)
        self._apple_keys = JwksCache(f"{config.apple_base_url}/auth/keys", self._http_factory)

    @property
    def google_enabled(self) -> bool:
        c = self._config
        return bool(c.google_enabled and c.google_web_client_id and c.google_web_client_secret)

    @property
    def apple_enabled(self) -> bool:
        c = self._config
        return bool(
            c.apple_enabled
            and c.apple_client_id
            and c.apple_team_id
            and c.apple_key_id
            and c.apple_private_key
        )

    # ── Google ────────────────────────────────────────────────────────────

    async def verify_google(self, authorization_code: str) -> VerifiedIdentity:
        c = self._config
        if not self.google_enabled or not c.google_web_client_id or not c.google_web_client_secret:
            raise ProviderUnavailable("google not configured")
        form = {
            "code": authorization_code,
            "client_id": c.google_web_client_id,
            "client_secret": c.google_web_client_secret,
            "grant_type": "authorization_code",
        }
        if c.google_code_redirect_uri:
            form["redirect_uri"] = c.google_code_redirect_uri
        try:
            async with self._http_factory() as http:
                response = await http.post(c.google_token_url, data=form)
        except httpx.HTTPError:
            raise ProviderUnavailable("google token endpoint") from None
        if response.status_code == 400:
            raise CredentialRejected("code refused")  # invalid_grant: used, expired or foreign
        if response.status_code != 200:
            # 401/403 means Google refused OUR client credentials: a deployment problem.
            logger.error("google token endpoint answered %s", response.status_code)
            raise ProviderUnavailable("google token endpoint")
        try:
            id_token = response.json().get("id_token")
        except ValueError:
            raise ProviderUnavailable("google token endpoint") from None
        if not isinstance(id_token, str):
            raise CredentialRejected("no id token")
        claims = await verify_signed_token(
            id_token, self._google_keys, issuers=GOOGLE_ISSUERS, audiences=[c.google_web_client_id]
        )
        return VerifiedIdentity(
            provider="google",
            subject=claims["sub"],
            email=_text(claims.get("email"), 320),
            email_verified=_as_bool(claims.get("email_verified")),
            first_name=_text(claims.get("given_name"), 100),
            last_name=_text(claims.get("family_name"), 100),
        )

    # ── Apple ─────────────────────────────────────────────────────────────

    async def verify_apple(self, identity_token: str, nonce: str) -> VerifiedIdentity:
        if not self.apple_enabled:
            raise ProviderUnavailable("apple not configured")
        claims = await verify_signed_token(
            identity_token,
            self._apple_keys,
            issuers=(APPLE_ISSUER,),
            audiences=self._config.apple_audiences,
        )
        if not nonce_matches(claims.get("nonce"), nonce):
            raise CredentialRejected("nonce mismatch")
        return VerifiedIdentity(
            provider="apple",
            subject=claims["sub"],
            email=_text(claims.get("email"), 320),
            email_verified=_as_bool(claims.get("email_verified")),
            is_private_email=_as_bool(claims.get("is_private_email")),
        )

    def client_secret(self) -> str:
        """The short-lived ES256 JWT that authenticates this server to Apple."""
        c = self._config
        if not (c.apple_team_id and c.apple_key_id and c.apple_private_key and c.apple_client_id):
            raise ProviderUnavailable("apple not configured")
        now = int(self._clock())
        claims = {
            "iss": c.apple_team_id,
            "iat": now,
            "exp": now + _APPLE_SECRET_LIFETIME_SECONDS,
            "aud": APPLE_ISSUER,
            "sub": c.apple_client_id,
        }
        try:
            return jwt.encode(
                claims, c.apple_private_key, algorithm="ES256", headers={"kid": c.apple_key_id}
            )
        except JOSEError:
            # A malformed .p8: a deployment problem, never something to echo.
            raise ProviderUnavailable("apple key unusable") from None

    async def apple_refresh_token(self, authorization_code: str) -> str | None:
        """Exchange the sign-in's authorization code for a refresh token, or None.

        Best effort: a sign-in does not depend on it, it only makes revocation possible
        later. Never raises.
        """
        c = self._config
        try:
            form = {
                "client_id": c.apple_client_id or "",
                "client_secret": self.client_secret(),
                "code": authorization_code,
                "grant_type": "authorization_code",
            }
            async with self._http_factory() as http:
                response = await http.post(f"{c.apple_base_url}/auth/token", data=form)
            if response.status_code != 200:
                logger.warning("apple token exchange answered %s", response.status_code)
                return None
            token = response.json().get("refresh_token")
        except (httpx.HTTPError, ValueError, ProviderUnavailable):
            logger.warning("apple token exchange failed")
            return None
        return token if isinstance(token, str) and token else None

    async def revoke_apple(self, refresh_token: str) -> bool:
        """Revoke the person's authorization for this app. True only if Apple said so."""
        c = self._config
        try:
            form = {
                "client_id": c.apple_client_id or "",
                "client_secret": self.client_secret(),
                "token": refresh_token,
                "token_type_hint": "refresh_token",
            }
            async with self._http_factory() as http:
                response = await http.post(f"{c.apple_base_url}/auth/revoke", data=form)
        except (httpx.HTTPError, ProviderUnavailable):
            logger.warning("apple revocation failed")
            return False
        if response.status_code != 200:
            logger.warning("apple revocation answered %s", response.status_code)
        return response.status_code == 200

    async def verify_apple_notification(self, payload: str) -> AppleNotification:
        """A server-to-server notification from Apple (consent revoked, account deleted)."""
        if not self.apple_enabled:
            raise ProviderUnavailable("apple not configured")
        claims = await verify_signed_token(
            payload,
            self._apple_keys,
            issuers=(APPLE_ISSUER,),
            audiences=self._config.apple_audiences,
        )
        events = claims.get("events")
        if isinstance(events, str):
            try:
                events = json.loads(events)
            except ValueError:
                raise CredentialRejected("bad events") from None
        if not isinstance(events, dict):
            raise CredentialRejected("bad events")
        event_type = events.get("type")
        subject = events.get("sub", claims.get("sub"))
        if not isinstance(event_type, str) or not isinstance(subject, str) or not subject:
            raise CredentialRejected("bad events")
        return AppleNotification(event_type=event_type, subject=subject)


def social_config_from_settings(s: Any) -> SocialConfig:
    """Build the config from app.core.config.Settings (typed Any to keep this module free of it)."""
    secret = s.GOOGLE_WEB_CLIENT_SECRET
    key = s.APPLE_PRIVATE_KEY
    return SocialConfig(
        google_enabled=s.SOCIAL_GOOGLE_ENABLED,
        google_web_client_id=s.GOOGLE_WEB_CLIENT_ID,
        google_web_client_secret=secret.get_secret_value() if secret else None,
        google_code_redirect_uri=s.GOOGLE_CODE_REDIRECT_URI,
        google_token_url=s.GOOGLE_TOKEN_URL,
        google_jwks_url=s.GOOGLE_JWKS_URL,
        apple_enabled=s.SOCIAL_APPLE_ENABLED,
        apple_client_id=s.APPLE_CLIENT_ID,
        apple_extra_audiences=tuple(s.apple_extra_audiences),
        apple_team_id=s.APPLE_TEAM_ID,
        apple_key_id=s.APPLE_KEY_ID,
        apple_private_key=(key.get_secret_value().replace("\\n", "\n") if key else None),
        apple_base_url=s.APPLE_BASE_URL,
        http_timeout_seconds=s.SOCIAL_HTTP_TIMEOUT_SECONDS,
    )
