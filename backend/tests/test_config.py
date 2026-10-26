"""Startup safety checks in app.core.config and the database engine's logging."""

import pytest
from pydantic import ValidationError

from app.core.config import MIN_JWT_SECRET_BYTES, Settings
from app.core.config import settings as app_settings
from app.core.database import engine

SHORT_KEY = "k" * (MIN_JWT_SECRET_BYTES - 1)
LONG_KEY = "k" * MIN_JWT_SECRET_BYTES


def make_settings(**overrides: object) -> Settings:
    """Settings built only from the arguments, ignoring the process's .env file."""
    values: dict[str, object] = {
        "DATABASE_URL": "postgresql+asyncpg://user:pw@db/app",
        "JWT_SECRET_KEY": LONG_KEY,
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
