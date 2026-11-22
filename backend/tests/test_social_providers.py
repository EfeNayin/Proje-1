"""The provider boundary itself: real signatures, real claims, a fake network.

Everything the account tests take on trust is checked here against genuinely signed tokens:
signature, algorithm, issuer, audience, expiry, subject, the Apple nonce, the client secret
Apple is sent, and how each failure of the network is told apart (a refused credential is not
an outage). Google and Apple are replaced only by an httpx MockTransport.
"""

import hashlib
import json
import time
from collections.abc import Callable
from typing import Any
from urllib.parse import parse_qs

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from jose import jwt
from jose.utils import long_to_base64

from app.domains.auth.social_providers import (
    APPLE_ISSUER,
    CredentialRejected,
    JwksCache,
    LiveSocialProviders,
    ProviderUnavailable,
    SocialConfig,
    nonce_matches,
)

GOOGLE_CLIENT = "web-client.apps.googleusercontent.com"
APPLE_CLIENT = "com.example.aures"
GOOGLE_JWKS = "https://keys.google.test/certs"
GOOGLE_TOKEN = "https://token.google.test/token"
APPLE_BASE = "https://appleid.apple.test"
NONCE = "n" * 32


class Signer:
    """An RSA key pair that signs tokens and publishes itself as a JWKS entry."""

    def __init__(self, kid: str) -> None:
        self.kid = kid
        self._key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.pem = self._key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode()
        numbers = self._key.public_key().public_numbers()
        self.jwk = {
            "kty": "RSA",
            "alg": "RS256",
            "use": "sig",
            "kid": kid,
            "n": long_to_base64(numbers.n).decode(),
            "e": long_to_base64(numbers.e).decode(),
        }

    def sign(self, claims: dict[str, Any], *, alg: str = "RS256", kid: str | None = None) -> str:
        return jwt.encode(claims, self.pem, algorithm=alg, headers={"kid": kid or self.kid})


def claims(iss: str, aud: str, **extra: Any) -> dict[str, Any]:
    now = int(time.time())
    return {"iss": iss, "aud": aud, "sub": "subject-1", "iat": now, "exp": now + 600, **extra}


class Network:
    """Routes the providers' URLs to canned answers and remembers what was sent."""

    def __init__(self) -> None:
        self.google_signer = Signer("g-key")
        self.apple_signer = Signer("a-key")
        self.google_keys = [self.google_signer.jwk]
        self.apple_keys = [self.apple_signer.jwk]
        self.token_answer: Callable[[httpx.Request], httpx.Response] = lambda r: httpx.Response(
            200,
            json={
                "id_token": self.google_signer.sign(
                    claims("https://accounts.google.com", GOOGLE_CLIENT)
                )
            },
        )
        self.apple_token_answer: Callable[[httpx.Request], httpx.Response] = (
            lambda r: httpx.Response(200, json={"refresh_token": "apple-refresh"})
        )
        self.revoke_answer: Callable[[httpx.Request], httpx.Response] = lambda r: httpx.Response(
            200
        )
        self.jwks_down = False
        self.requests: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        url = str(request.url)
        if url == GOOGLE_JWKS or url == f"{APPLE_BASE}/auth/keys":
            if self.jwks_down:
                raise httpx.ConnectError("down")
            keys = self.google_keys if url == GOOGLE_JWKS else self.apple_keys
            return httpx.Response(200, json={"keys": keys})
        if url == GOOGLE_TOKEN:
            return self.token_answer(request)
        if url == f"{APPLE_BASE}/auth/token":
            return self.apple_token_answer(request)
        if url == f"{APPLE_BASE}/auth/revoke":
            return self.revoke_answer(request)
        raise AssertionError(f"unexpected request to {url}")

    def form(self, url: str) -> dict[str, str]:
        request = next(r for r in self.requests if str(r.url) == url)
        return {k: v[0] for k, v in parse_qs(request.content.decode()).items()}

    def count(self, url: str) -> int:
        return sum(1 for r in self.requests if str(r.url) == url)


@pytest.fixture
def apple_p8() -> tuple[str, ec.EllipticCurvePublicKey]:
    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    return pem, key.public_key()


@pytest.fixture
def net() -> Network:
    return Network()


def make(
    net: Network, apple_pem: str = "unused", *, clock: Callable[[], float] = time.time, **over: Any
) -> LiveSocialProviders:
    config = SocialConfig(
        google_enabled=True,
        google_web_client_id=GOOGLE_CLIENT,
        google_web_client_secret="google-secret",
        google_token_url=GOOGLE_TOKEN,
        google_jwks_url=GOOGLE_JWKS,
        apple_enabled=True,
        apple_client_id=APPLE_CLIENT,
        apple_team_id="TEAM123456",
        apple_key_id="KEY1234567",
        apple_private_key=apple_pem,
        apple_base_url=APPLE_BASE,
        **over,
    )
    return LiveSocialProviders(
        config,
        lambda: httpx.AsyncClient(transport=httpx.MockTransport(net.handler)),
        clock=clock,
    )


def google_token(net: Network, **extra: Any) -> str:
    return net.google_signer.sign(claims("https://accounts.google.com", GOOGLE_CLIENT, **extra))


def apple_identity(net: Network, **extra: Any) -> str:
    return net.apple_signer.sign(claims(APPLE_ISSUER, APPLE_CLIENT, nonce=NONCE, **extra))


def answer_with(token: str) -> Callable[[httpx.Request], httpx.Response]:
    return lambda r: httpx.Response(200, json={"id_token": token})


# ── Google ───────────────────────────────────────────────────────────────


class TestGoogle:
    async def test_the_code_is_redeemed_server_side_and_the_token_checked(
        self, net: Network
    ) -> None:
        net.token_answer = answer_with(
            google_token(
                net,
                email="Lifter@Gmail.com",
                email_verified=True,
                given_name="Efe",
                family_name="Nayin",
            )
        )
        who = await make(net).verify_google("the-code")
        assert (who.provider, who.subject, who.email) == ("google", "subject-1", "Lifter@Gmail.com")
        assert who.email_verified is True and who.first_name == "Efe" and who.last_name == "Nayin"
        sent = net.form(GOOGLE_TOKEN)
        assert sent == {
            "code": "the-code",
            "client_id": GOOGLE_CLIENT,
            "client_secret": "google-secret",
            "grant_type": "authorization_code",
        }

    async def test_a_redirect_uri_is_sent_only_when_configured(self, net: Network) -> None:
        await make(net, google_code_redirect_uri="https://app.example/cb").verify_google("c")
        assert net.form(GOOGLE_TOKEN)["redirect_uri"] == "https://app.example/cb"

    async def test_email_verified_may_arrive_as_a_string(self, net: Network) -> None:
        net.token_answer = answer_with(google_token(net, email="a@b.co", email_verified="true"))
        assert (await make(net).verify_google("c")).email_verified is True
        net.token_answer = answer_with(google_token(net, email="a@b.co", email_verified="false"))
        assert (await make(net).verify_google("c")).email_verified is False
        net.token_answer = answer_with(google_token(net, email="a@b.co"))
        assert (await make(net).verify_google("c")).email_verified is False

    @pytest.mark.parametrize(
        "bad",
        [
            lambda n: n.google_signer.sign(claims("https://evil.test", GOOGLE_CLIENT)),
            lambda n: n.google_signer.sign(claims("https://accounts.google.com", "someone-elses")),
            lambda n: n.google_signer.sign(
                {
                    **claims("https://accounts.google.com", GOOGLE_CLIENT),
                    "exp": int(time.time()) - 3600,
                }
            ),
            lambda n: n.google_signer.sign(
                {
                    k: v
                    for k, v in claims("https://accounts.google.com", GOOGLE_CLIENT).items()
                    if k != "sub"
                }
            ),
            lambda n: n.google_signer.sign(
                {
                    k: v
                    for k, v in claims("https://accounts.google.com", GOOGLE_CLIENT).items()
                    if k != "exp"
                }
            ),
            lambda n: n.google_signer.sign(
                {**claims("https://accounts.google.com", GOOGLE_CLIENT), "sub": ""}
            ),
            lambda n: n.google_signer.sign(
                {**claims("https://accounts.google.com", GOOGLE_CLIENT), "sub": "x" * 300}
            ),
            lambda n: Signer("g-key").sign(claims("https://accounts.google.com", GOOGLE_CLIENT)),
            lambda n: "not-a-jwt",
        ],
        ids=[
            "issuer",
            "audience",
            "expired",
            "no-subject",
            "no-expiry",
            "empty-subject",
            "huge-subject",
            "forged-signature",
            "garbage",
        ],
    )
    async def test_a_token_that_fails_any_check_is_rejected(
        self, net: Network, bad: Callable[[Network], str]
    ) -> None:
        net.token_answer = answer_with(bad(net))
        with pytest.raises(CredentialRejected):
            await make(net).verify_google("c")

    async def test_the_token_may_name_either_form_of_the_issuer(self, net: Network) -> None:
        net.token_answer = answer_with(
            net.google_signer.sign(claims("accounts.google.com", GOOGLE_CLIENT))
        )
        assert (await make(net).verify_google("c")).subject == "subject-1"

    async def test_an_audience_list_is_accepted_only_if_it_includes_ours(
        self, net: Network
    ) -> None:
        good = net.google_signer.sign(
            {
                **claims("https://accounts.google.com", GOOGLE_CLIENT),
                "aud": ["other", GOOGLE_CLIENT],
            }
        )
        net.token_answer = answer_with(good)
        assert (await make(net).verify_google("c")).subject == "subject-1"
        bad = net.google_signer.sign(
            {**claims("https://accounts.google.com", GOOGLE_CLIENT), "aud": ["other"]}
        )
        net.token_answer = answer_with(bad)
        with pytest.raises(CredentialRejected):
            await make(net).verify_google("c")

    @pytest.mark.parametrize("alg", ["HS256", "none"])
    async def test_algorithm_confusion_is_refused(self, net: Network, alg: str) -> None:
        """A token 'signed' with the PUBLIC key as an HMAC secret, or not signed at all."""
        body = claims("https://accounts.google.com", GOOGLE_CLIENT)
        if alg == "HS256":
            forged = jwt.encode(
                body, json.dumps(net.google_signer.jwk), algorithm="HS256", headers={"kid": "g-key"}
            )
        else:
            import base64

            def part(data: dict[str, Any]) -> str:
                return base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()

            forged = f"{part({'alg': 'none', 'kid': 'g-key'})}.{part(body)}."
        net.token_answer = answer_with(forged)
        with pytest.raises(CredentialRejected):
            await make(net).verify_google("c")

    async def test_a_token_without_a_key_id_is_refused(self, net: Network) -> None:
        body = claims("https://accounts.google.com", GOOGLE_CLIENT)
        net.token_answer = answer_with(jwt.encode(body, net.google_signer.pem, algorithm="RS256"))
        with pytest.raises(CredentialRejected):
            await make(net).verify_google("c")

    async def test_a_code_google_refuses_is_a_rejected_credential_not_an_outage(
        self, net: Network
    ) -> None:
        net.token_answer = lambda r: httpx.Response(400, json={"error": "invalid_grant"})
        with pytest.raises(CredentialRejected):
            await make(net).verify_google("used-before")

    @pytest.mark.parametrize("status", [401, 403, 429, 500, 503])
    async def test_other_failures_are_outages_so_the_person_is_not_told_their_login_is_wrong(
        self, net: Network, status: int
    ) -> None:
        net.token_answer = lambda r: httpx.Response(status, json={"error": "x"})
        with pytest.raises(ProviderUnavailable):
            await make(net).verify_google("c")

    async def test_a_network_failure_or_garbage_body_is_an_outage(self, net: Network) -> None:
        def boom(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("slow")

        net.token_answer = boom
        with pytest.raises(ProviderUnavailable):
            await make(net).verify_google("c")
        net.token_answer = lambda r: httpx.Response(200, content=b"<html>")
        with pytest.raises(ProviderUnavailable):
            await make(net).verify_google("c")

    async def test_an_answer_without_an_id_token_is_rejected(self, net: Network) -> None:
        net.token_answer = lambda r: httpx.Response(200, json={"access_token": "x"})
        with pytest.raises(CredentialRejected):
            await make(net).verify_google("c")

    async def test_it_refuses_to_run_unconfigured(self, net: Network) -> None:
        providers = LiveSocialProviders(
            SocialConfig(google_enabled=True),
            lambda: httpx.AsyncClient(transport=httpx.MockTransport(net.handler)),
        )
        assert providers.google_enabled is False
        with pytest.raises(ProviderUnavailable):
            await providers.verify_google("c")
        assert net.requests == []

    async def test_nothing_the_provider_said_leaks_into_the_error(self, net: Network) -> None:
        net.token_answer = answer_with(
            net.google_signer.sign(
                claims("https://accounts.google.com", "someone-elses", email="secret@gmail.com")
            )
        )
        with pytest.raises(CredentialRejected) as raised:
            await make(net).verify_google("super-secret-code")
        assert "secret" not in str(raised.value) + repr(raised.value)


# ── signing keys ─────────────────────────────────────────────────────────


class TestKeyCache:
    async def test_keys_are_fetched_once_and_reused(self, net: Network) -> None:
        providers = make(net)
        for _ in range(3):
            net.token_answer = answer_with(google_token(net))
            await providers.verify_google("c")
        assert net.count(GOOGLE_JWKS) == 1

    async def test_a_rotated_key_is_picked_up_once_the_cooldown_has_passed(
        self, net: Network
    ) -> None:
        now = [1000.0]
        cache = JwksCache(
            GOOGLE_JWKS,
            lambda: httpx.AsyncClient(transport=httpx.MockTransport(net.handler)),
            clock=lambda: now[0],
        )
        assert (await cache.key("g-key"))["kid"] == "g-key"
        rotated = Signer("g-key-2")
        net.google_keys = [net.google_signer.jwk, rotated.jwk]
        with pytest.raises(CredentialRejected):
            await cache.key("g-key-2")  # unknown, but we refetched a moment ago: no hammering
        assert net.count(GOOGLE_JWKS) == 1
        now[0] += 31
        assert (await cache.key("g-key-2"))["kid"] == "g-key-2"
        assert net.count(GOOGLE_JWKS) == 2

    async def test_a_flood_of_forged_key_ids_does_not_flood_the_provider(
        self, net: Network
    ) -> None:
        now = [1000.0]
        cache = JwksCache(
            GOOGLE_JWKS,
            lambda: httpx.AsyncClient(transport=httpx.MockTransport(net.handler)),
            clock=lambda: now[0],
        )
        await cache.key("g-key")
        for i in range(20):
            with pytest.raises(CredentialRejected):
                await cache.key(f"forged-{i}")
        assert net.count(GOOGLE_JWKS) == 1

    async def test_keys_already_held_survive_an_outage(self, net: Network) -> None:
        now = [1000.0]
        cache = JwksCache(
            GOOGLE_JWKS,
            lambda: httpx.AsyncClient(transport=httpx.MockTransport(net.handler)),
            clock=lambda: now[0],
        )
        await cache.key("g-key")
        net.jwks_down = True
        now[0] += 10_000  # long past the ttl
        assert (await cache.key("g-key"))["kid"] == "g-key"
        with pytest.raises(CredentialRejected):
            await cache.key("never-seen")

    async def test_with_no_keys_and_no_provider_it_is_an_outage(self, net: Network) -> None:
        net.jwks_down = True
        cache = JwksCache(
            GOOGLE_JWKS, lambda: httpx.AsyncClient(transport=httpx.MockTransport(net.handler))
        )
        with pytest.raises(ProviderUnavailable):
            await cache.key("g-key")


# ── Apple ────────────────────────────────────────────────────────────────


class TestApple:
    async def test_a_valid_identity_token_with_its_nonce(self, net: Network) -> None:
        token = apple_identity(
            net, email="x@privaterelay.appleid.com", email_verified="true", is_private_email="true"
        )
        who = await make(net).verify_apple(token, NONCE)
        assert who.provider == "apple" and who.subject == "subject-1"
        assert who.email == "x@privaterelay.appleid.com"
        assert who.email_verified is True and who.is_private_email is True

    async def test_a_token_without_an_email_is_still_an_identity(self, net: Network) -> None:
        who = await make(net).verify_apple(apple_identity(net), NONCE)
        assert who.email is None and who.email_verified is False and who.is_private_email is False

    async def test_the_nonce_may_be_carried_raw_or_as_its_sha256(self, net: Network) -> None:
        digest = hashlib.sha256(NONCE.encode()).hexdigest()
        hashed = net.apple_signer.sign(claims(APPLE_ISSUER, APPLE_CLIENT, nonce=digest))
        assert (await make(net).verify_apple(hashed, NONCE)).subject == "subject-1"

    async def test_a_different_or_missing_nonce_is_rejected(self, net: Network) -> None:
        with pytest.raises(CredentialRejected):
            await make(net).verify_apple(apple_identity(net), "o" * 32)
        no_nonce = net.apple_signer.sign(claims(APPLE_ISSUER, APPLE_CLIENT))
        with pytest.raises(CredentialRejected):
            await make(net).verify_apple(no_nonce, NONCE)
        with pytest.raises(CredentialRejected):
            await make(net).verify_apple(apple_identity(net), "")

    async def test_wrong_issuer_audience_expiry_and_signature_are_rejected(
        self, net: Network
    ) -> None:
        cases = [
            net.apple_signer.sign(claims("https://evil.test", APPLE_CLIENT, nonce=NONCE)),
            net.apple_signer.sign(claims(APPLE_ISSUER, "com.someone.else", nonce=NONCE)),
            net.apple_signer.sign(
                {**claims(APPLE_ISSUER, APPLE_CLIENT, nonce=NONCE), "exp": int(time.time()) - 3600}
            ),
            Signer("a-key").sign(claims(APPLE_ISSUER, APPLE_CLIENT, nonce=NONCE)),
        ]
        for token in cases:
            with pytest.raises(CredentialRejected):
                await make(net).verify_apple(token, NONCE)

    async def test_extra_audiences_are_honoured_for_development_builds(self, net: Network) -> None:
        token = net.apple_signer.sign(claims(APPLE_ISSUER, "host.exp.Exponent", nonce=NONCE))
        with pytest.raises(CredentialRejected):
            await make(net).verify_apple(token, NONCE)
        providers = make(net, apple_extra_audiences=("host.exp.Exponent",))
        assert (await providers.verify_apple(token, NONCE)).subject == "subject-1"

    async def test_apple_keys_do_not_vouch_for_google_tokens_or_the_reverse(
        self, net: Network
    ) -> None:
        net.token_answer = answer_with(
            net.apple_signer.sign(claims("https://accounts.google.com", GOOGLE_CLIENT, kid="a-key"))
        )
        with pytest.raises(CredentialRejected):
            await make(net).verify_google("c")  # signed by Apple's key, not in Google's set
        google_signed = net.google_signer.sign(claims(APPLE_ISSUER, APPLE_CLIENT, nonce=NONCE))
        with pytest.raises(CredentialRejected):
            await make(net).verify_apple(google_signed, NONCE)

    async def test_it_refuses_to_run_unconfigured(self, net: Network) -> None:
        providers = LiveSocialProviders(
            SocialConfig(apple_enabled=True),
            lambda: httpx.AsyncClient(transport=httpx.MockTransport(net.handler)),
        )
        assert providers.apple_enabled is False
        with pytest.raises(ProviderUnavailable):
            await providers.verify_apple("t", NONCE)


class TestClientSecret:
    async def test_it_is_an_es256_jwt_with_apples_required_claims(
        self, net: Network, apple_p8: tuple[str, ec.EllipticCurvePublicKey]
    ) -> None:
        pem, public = apple_p8
        providers = make(net, pem, clock=lambda: 1_700_000_000)
        secret = providers.client_secret()
        header = jwt.get_unverified_header(secret)
        assert header["alg"] == "ES256" and header["kid"] == "KEY1234567"
        public_pem = public.public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        ).decode()
        decoded = jwt.decode(
            secret,
            public_pem,
            algorithms=["ES256"],
            audience=APPLE_ISSUER,
            options={"verify_exp": False},
        )
        assert decoded == {
            "iss": "TEAM123456",
            "iat": 1_700_000_000,
            "exp": 1_700_000_300,
            "aud": APPLE_ISSUER,
            "sub": APPLE_CLIENT,
        }

    async def test_it_needs_the_whole_configuration(self, net: Network) -> None:
        bare = LiveSocialProviders(
            SocialConfig(apple_enabled=True, apple_client_id=APPLE_CLIENT),
            lambda: httpx.AsyncClient(transport=httpx.MockTransport(net.handler)),
        )
        with pytest.raises(ProviderUnavailable):
            bare.client_secret()


class TestAppleServerCalls:
    async def test_the_authorization_code_becomes_a_refresh_token(
        self, net: Network, apple_p8: tuple[str, ec.EllipticCurvePublicKey]
    ) -> None:
        assert await make(net, apple_p8[0]).apple_refresh_token("auth-code") == "apple-refresh"
        sent = net.form(f"{APPLE_BASE}/auth/token")
        assert sent["code"] == "auth-code" and sent["grant_type"] == "authorization_code"
        assert sent["client_id"] == APPLE_CLIENT
        assert jwt.get_unverified_header(sent["client_secret"])["alg"] == "ES256"

    async def test_failures_of_the_exchange_return_none_and_never_raise(
        self, net: Network, apple_p8: tuple[str, ec.EllipticCurvePublicKey]
    ) -> None:
        providers = make(net, apple_p8[0])
        net.apple_token_answer = lambda r: httpx.Response(400, json={"error": "invalid_grant"})
        assert await providers.apple_refresh_token("c") is None
        net.apple_token_answer = lambda r: httpx.Response(200, content=b"not json")
        assert await providers.apple_refresh_token("c") is None
        net.apple_token_answer = lambda r: httpx.Response(200, json={"refresh_token": 5})
        assert await providers.apple_refresh_token("c") is None

        def down(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectTimeout("slow")

        net.apple_token_answer = down
        assert await providers.apple_refresh_token("c") is None
        # A broken key is the same: best effort, not a failed sign-in.
        assert await make(net, "not a key").apple_refresh_token("c") is None

    async def test_revocation_succeeds_only_when_apple_says_so(
        self, net: Network, apple_p8: tuple[str, ec.EllipticCurvePublicKey]
    ) -> None:
        providers = make(net, apple_p8[0])
        assert await providers.revoke_apple("apple-refresh") is True
        sent = net.form(f"{APPLE_BASE}/auth/revoke")
        assert sent["token"] == "apple-refresh" and sent["token_type_hint"] == "refresh_token"
        net.revoke_answer = lambda r: httpx.Response(400)
        assert await providers.revoke_apple("apple-refresh") is False

        def down(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("down")

        net.revoke_answer = down
        assert await providers.revoke_apple("apple-refresh") is False
        assert await make(net, "not a key").revoke_apple("apple-refresh") is False

    async def test_the_refresh_token_is_never_logged(
        self,
        net: Network,
        apple_p8: tuple[str, ec.EllipticCurvePublicKey],
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        caplog.set_level("DEBUG")
        providers = make(net, apple_p8[0])
        net.revoke_answer = lambda r: httpx.Response(400, json={"error": "apple-refresh"})
        await providers.revoke_apple("apple-refresh")
        net.apple_token_answer = lambda r: httpx.Response(500)
        await providers.apple_refresh_token("auth-code-marker")
        assert "apple-refresh" not in caplog.text and "auth-code-marker" not in caplog.text


class TestAppleNotifications:
    def signed(self, net: Network, events: Any, **extra: Any) -> str:
        return net.apple_signer.sign(claims(APPLE_ISSUER, APPLE_CLIENT, events=events, **extra))

    async def test_the_events_claim_may_be_a_json_string_or_an_object(self, net: Network) -> None:
        providers = make(net)
        as_text = self.signed(net, json.dumps({"type": "consent-revoked", "sub": "apple-sub"}))
        as_object = self.signed(net, {"type": "account-delete", "sub": "apple-sub"})
        first = await providers.verify_apple_notification(as_text)
        second = await providers.verify_apple_notification(as_object)
        assert (first.event_type, first.subject) == ("consent-revoked", "apple-sub")
        assert (second.event_type, second.subject) == ("account-delete", "apple-sub")

    async def test_it_falls_back_to_the_token_subject(self, net: Network) -> None:
        note = await make(net).verify_apple_notification(
            self.signed(net, {"type": "email-enabled"})
        )
        assert note.subject == "subject-1"

    @pytest.mark.parametrize(
        "events", [None, "not json", [1], {"sub": "x"}, {"type": 1, "sub": "x"}]
    )
    async def test_malformed_events_are_rejected(self, net: Network, events: Any) -> None:
        with pytest.raises(CredentialRejected):
            await make(net).verify_apple_notification(self.signed(net, events))

    async def test_a_notification_must_be_signed_by_apple_for_this_app(self, net: Network) -> None:
        providers = make(net)
        forged = Signer("a-key").sign(
            claims(APPLE_ISSUER, APPLE_CLIENT, events={"type": "consent-revoked", "sub": "v"})
        )
        other_app = net.apple_signer.sign(
            claims(APPLE_ISSUER, "com.someone.else", events={"type": "consent-revoked", "sub": "v"})
        )
        for payload in (forged, other_app, "garbage"):
            with pytest.raises(CredentialRejected):
                await providers.verify_apple_notification(payload)


# ── helpers ──────────────────────────────────────────────────────────────


class TestNonceMatching:
    def test_raw_and_digest_match_nothing_else_does(self) -> None:
        digest = hashlib.sha256(NONCE.encode()).hexdigest()
        assert nonce_matches(NONCE, NONCE) and nonce_matches(digest, NONCE)
        assert not nonce_matches("other", NONCE)
        assert not nonce_matches(None, NONCE) and not nonce_matches(5, NONCE)
        assert not nonce_matches("", "") and not nonce_matches(NONCE, "")
        assert not nonce_matches(digest.upper(), NONCE)
