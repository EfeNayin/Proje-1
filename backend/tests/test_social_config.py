"""Startup checks for the social sign-in settings, and the encryption of stored tokens.

A provider that is switched on but incomplete must stop the server from starting rather than
show a button that cannot work, and the refusal must name variables, never print values.
"""

import pytest
from cryptography.fernet import Fernet

from app.core.secretbox import SecretBox, is_valid_key
from tests.test_config import make_settings

KEY = Fernet.generate_key().decode()
SECRET = "super-secret-value-9f3a"

GOOGLE = {
    "SOCIAL_GOOGLE_ENABLED": True,
    "GOOGLE_WEB_CLIENT_ID": "web.apps.googleusercontent.com",
    "GOOGLE_WEB_CLIENT_SECRET": SECRET,
    "GOOGLE_IOS_CLIENT_ID": "ios.apps.googleusercontent.com",
}
APPLE = {
    "SOCIAL_APPLE_ENABLED": True,
    "APPLE_CLIENT_ID": "com.example.aures",
    "APPLE_TEAM_ID": "TEAM123456",
    "APPLE_KEY_ID": "KEY1234567",
    "APPLE_PRIVATE_KEY": SECRET,
    "SOCIAL_TOKEN_ENCRYPTION_KEY": KEY,
}


class TestOffByDefault:
    def test_nothing_is_required_while_both_flags_are_off(self) -> None:
        for environment in ("development", "staging", "production"):
            make_settings(ENVIRONMENT=environment).check_deployment_safety()

    def test_the_flags_default_to_off(self) -> None:
        settings = make_settings()
        assert settings.SOCIAL_GOOGLE_ENABLED is False and settings.SOCIAL_APPLE_ENABLED is False


class TestCompleteConfigurationStarts:
    @pytest.mark.parametrize("environment", ["development", "staging", "production"])
    def test_both_providers(self, environment: str) -> None:
        make_settings(ENVIRONMENT=environment, **GOOGLE, **APPLE).check_deployment_safety()


class TestHalfConfiguredRefuses:
    @pytest.mark.parametrize("environment", ["development", "staging", "production"])
    @pytest.mark.parametrize(
        "missing", ["GOOGLE_WEB_CLIENT_ID", "GOOGLE_WEB_CLIENT_SECRET", "GOOGLE_IOS_CLIENT_ID"]
    )
    def test_google_names_what_is_missing(self, environment: str, missing: str) -> None:
        settings = make_settings(ENVIRONMENT=environment, **{**GOOGLE, missing: None})
        with pytest.raises(RuntimeError) as raised:
            settings.check_deployment_safety()
        assert missing in str(raised.value) and SECRET not in str(raised.value)

    @pytest.mark.parametrize(
        "missing",
        [
            "APPLE_CLIENT_ID",
            "APPLE_TEAM_ID",
            "APPLE_KEY_ID",
            "APPLE_PRIVATE_KEY",
            "SOCIAL_TOKEN_ENCRYPTION_KEY",
        ],
    )
    def test_apple_names_what_is_missing(self, missing: str) -> None:
        settings = make_settings(**{**APPLE, missing: None})
        with pytest.raises(RuntimeError) as raised:
            settings.check_deployment_safety()
        assert missing in str(raised.value) and SECRET not in str(raised.value)

    def test_an_empty_secret_counts_as_missing(self) -> None:
        with pytest.raises(RuntimeError, match="GOOGLE_WEB_CLIENT_SECRET"):
            make_settings(**{**GOOGLE, "GOOGLE_WEB_CLIENT_SECRET": ""}).check_deployment_safety()

    def test_several_missing_values_are_all_named(self) -> None:
        with pytest.raises(RuntimeError) as raised:
            make_settings(SOCIAL_APPLE_ENABLED=True).check_deployment_safety()
        for name in ("APPLE_CLIENT_ID", "APPLE_TEAM_ID", "SOCIAL_TOKEN_ENCRYPTION_KEY"):
            assert name in str(raised.value)

    def test_the_encryption_key_must_be_a_real_fernet_key(self) -> None:
        settings = make_settings(**{**APPLE, "SOCIAL_TOKEN_ENCRYPTION_KEY": "not-a-fernet-key"})
        with pytest.raises(RuntimeError) as raised:
            settings.check_deployment_safety()
        assert "SOCIAL_TOKEN_ENCRYPTION_KEY" in str(raised.value)
        assert "not-a-fernet-key" not in str(raised.value)


class TestOutsideDevelopment:
    @pytest.mark.parametrize("environment", ["staging", "production"])
    @pytest.mark.parametrize("name", ["GOOGLE_TOKEN_URL", "GOOGLE_JWKS_URL", "APPLE_BASE_URL"])
    def test_provider_urls_must_be_https(self, environment: str, name: str) -> None:
        settings = make_settings(ENVIRONMENT=environment, **{name: "http://provider.test/x"})
        with pytest.raises(RuntimeError, match=name):
            settings.check_deployment_safety()

    def test_development_may_point_at_a_local_fake(self) -> None:
        make_settings(
            ENVIRONMENT="development", GOOGLE_TOKEN_URL="http://localhost:9000/token"
        ).check_deployment_safety()

    @pytest.mark.parametrize("environment", ["staging", "production"])
    def test_the_expo_go_audience_is_development_only(self, environment: str) -> None:
        settings = make_settings(ENVIRONMENT=environment, APPLE_EXTRA_AUDIENCES="host.exp.Exponent")
        with pytest.raises(RuntimeError, match="APPLE_EXTRA_AUDIENCES"):
            settings.check_deployment_safety()
        assert make_settings(
            ENVIRONMENT="development", APPLE_EXTRA_AUDIENCES=" host.exp.Exponent , other "
        ).apple_extra_audiences == ["host.exp.Exponent", "other"]


class TestSecretBox:
    def test_round_trip_and_the_stored_form_hides_the_value(self) -> None:
        box = SecretBox(KEY)
        stored = box.encrypt("apple-refresh-token")
        assert "apple-refresh-token" not in stored
        assert box.decrypt(stored) == "apple-refresh-token"
        assert box.encrypt("apple-refresh-token") != stored  # a fresh IV each time

    def test_a_different_key_or_damaged_value_decrypts_to_nothing(self) -> None:
        stored = SecretBox(KEY).encrypt("x")
        assert SecretBox(Fernet.generate_key().decode()).decrypt(stored) is None
        assert SecretBox(KEY).decrypt(stored[:-4]) is None
        assert SecretBox(KEY).decrypt("") is None

    def test_key_validation(self) -> None:
        assert is_valid_key(KEY)
        assert not is_valid_key("") and not is_valid_key("short") and not is_valid_key(KEY[:-1])
