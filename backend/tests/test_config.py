"""Startup safety checks in app.core.config and the database engine's logging."""

import re
from pathlib import Path
from uuid import uuid4

import pytest
from jose import jwt
from pydantic import ValidationError

from app.core.config import MIN_JWT_SECRET_BYTES, Settings
from app.core.config import settings as app_settings
from app.core.database import engine
from app.core.security import JWTError, create_access_token, decode_token

SHORT_KEY = "k" * (MIN_JWT_SECRET_BYTES - 1)
LONG_KEY = "k" * MIN_JWT_SECRET_BYTES


def make_settings(**overrides: object) -> Settings:
    """Settings built only from the arguments, ignoring the process's .env file."""
    values: dict[str, object] = {
        "DATABASE_URL": "postgresql+asyncpg://user:pw@db/app?ssl=verify-full",
        "REDIS_URL": "rediss://default:pw@redis.example.test:6379",
        "JWT_SECRET_KEY": LONG_KEY,
        "SMTP_HOST": "smtp.example.test",
        **overrides,
    }
    return Settings(_env_file=None, **values)  # type: ignore[arg-type]


class TestJwtSecretOutsideDevelopment:
    def test_development_accepts_a_short_key(self) -> None:
        make_settings(ENVIRONMENT="development", JWT_SECRET_KEY=SHORT_KEY).check_deployment_safety()

    @pytest.mark.parametrize("environment", ["staging", "production"])
    def test_other_environments_reject_a_short_key(self, environment: str) -> None:
        settings = make_settings(ENVIRONMENT=environment, JWT_SECRET_KEY=SHORT_KEY)

        with pytest.raises(RuntimeError) as raised:
            settings.check_deployment_safety()

        assert str(MIN_JWT_SECRET_BYTES) in str(raised.value)
        # The message must never repeat the key it is complaining about.
        assert SHORT_KEY not in str(raised.value)

    @pytest.mark.parametrize("environment", ["staging", "production"])
    def test_other_environments_accept_a_full_length_key(self, environment: str) -> None:
        make_settings(ENVIRONMENT=environment, JWT_SECRET_KEY=LONG_KEY).check_deployment_safety()

    def test_length_is_counted_in_bytes(self) -> None:
        # 16 two-byte characters are 32 bytes; 31 ASCII characters are 31.
        make_settings(ENVIRONMENT="production", JWT_SECRET_KEY="ş" * 16).check_deployment_safety()
        with pytest.raises(RuntimeError):
            make_settings(
                ENVIRONMENT="production", JWT_SECRET_KEY="a" * 31
            ).check_deployment_safety()


class TestJwtAlgorithm:
    @pytest.mark.parametrize("algorithm", ["HS256", "HS384", "HS512"])
    def test_hmac_algorithms_are_accepted(self, algorithm: str) -> None:
        assert make_settings(JWT_ALGORITHM=algorithm).JWT_ALGORITHM == algorithm

    @pytest.mark.parametrize("algorithm", ["none", "None", "RS256", "ES256", ""])
    def test_anything_else_is_rejected(self, algorithm: str) -> None:
        with pytest.raises(ValidationError):
            make_settings(JWT_ALGORITHM=algorithm)


class TestSqlLogging:
    def test_bound_parameters_are_never_logged(self) -> None:
        """Parameters carry emails, password hashes, token hashes and health data."""
        assert engine.sync_engine.hide_parameters is True

    def test_the_running_engine_echoes_statements_only_in_development(self) -> None:
        assert engine.sync_engine.echo is app_settings.is_development

    def test_only_the_development_environment_counts_as_development(self) -> None:
        for environment, expected in (
            ("development", True),
            ("staging", False),
            ("production", False),
        ):
            assert make_settings(ENVIRONMENT=environment).is_development is expected


def example_jwt_key() -> str:
    """The placeholder key shipped (publicly) in backend/.env.example."""
    example = Path(__file__).resolve().parents[1] / ".env.example"
    for line in example.read_text().splitlines():
        if line.startswith("JWT_SECRET_KEY="):
            return line.split("=", 1)[1]
    raise AssertionError("backend/.env.example has no JWT_SECRET_KEY")


class TestShippedExampleKey:
    @pytest.mark.parametrize("environment", ["staging", "production"])
    def test_the_example_key_can_never_start_a_non_development_environment(
        self, environment: str
    ) -> None:
        """A copied .env.example must not be usable outside development."""
        settings = make_settings(ENVIRONMENT=environment, JWT_SECRET_KEY=example_jwt_key())

        with pytest.raises(RuntimeError):
            settings.check_deployment_safety()


class TestTokenSignature:
    def test_a_token_signed_with_another_key_is_rejected(self) -> None:
        claims = {"sub": str(uuid4()), "type": "access", "exp": 4_102_444_800, "jti": "x"}
        forged = jwt.encode(claims, example_jwt_key(), algorithm="HS256")

        with pytest.raises(JWTError):
            decode_token(forged)

    def test_a_token_signed_with_the_running_key_is_accepted(self) -> None:
        assert decode_token(create_access_token(uuid4()))["type"] == "access"


class TestSmtpOutsideDevelopment:
    """Password recovery needs an outgoing mail server, and its codes must not cross a
    network in clear."""

    def test_development_may_run_without_any_mail_server_or_with_a_plain_one(self) -> None:
        make_settings(SMTP_HOST=None).check_deployment_safety()
        make_settings(SMTP_SECURITY="none").check_deployment_safety()

    @pytest.mark.parametrize("environment", ["staging", "production"])
    def test_other_environments_require_a_host(self, environment: str) -> None:
        with pytest.raises(RuntimeError, match="SMTP_HOST"):
            make_settings(ENVIRONMENT=environment, SMTP_HOST=None).check_deployment_safety()

    @pytest.mark.parametrize("environment", ["staging", "production"])
    def test_other_environments_refuse_unencrypted_delivery(self, environment: str) -> None:
        with pytest.raises(RuntimeError, match="SMTP_SECURITY"):
            make_settings(ENVIRONMENT=environment, SMTP_SECURITY="none").check_deployment_safety()

    @pytest.mark.parametrize("security", ["starttls", "implicit"])
    def test_encrypted_delivery_is_accepted(self, security: str) -> None:
        make_settings(ENVIRONMENT="production", SMTP_SECURITY=security).check_deployment_safety()

    def test_the_default_is_starttls(self) -> None:
        assert make_settings().SMTP_SECURITY == "starttls"

    def test_the_smtp_password_is_not_shown_by_repr_or_str(self) -> None:
        shown = make_settings(SMTP_PASSWORD="hunter2-smtp")

        assert "hunter2-smtp" not in repr(shown) and "hunter2-smtp" not in str(shown)
        assert shown.SMTP_PASSWORD is not None
        assert shown.SMTP_PASSWORD.get_secret_value() == "hunter2-smtp"

    def test_env_example_has_placeholders_only(self) -> None:
        text = (Path(__file__).resolve().parent.parent / ".env.example").read_text()
        values = dict(
            line.split("=", 1) for line in text.splitlines() if re.match(r"#?\s*SMTP_\w+=", line)
        )
        names = {key.lstrip("# ").strip() for key in values}

        assert {
            "SMTP_HOST",
            "SMTP_PORT",
            "SMTP_SECURITY",
            "SMTP_USERNAME",
            "SMTP_PASSWORD",
            "SMTP_FROM",
        } <= names
        for key, value in values.items():
            name = key.lstrip("# ").strip()
            if name in ("SMTP_PASSWORD", "SMTP_USERNAME", "SMTP_HOST"):
                assert value.strip() in ("", "change-me", "smtp.example.com", "your-username"), name
