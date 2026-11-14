"""The development-only browser preview: which origins may call the API, and which never.

Browser access is for a local Expo web preview. Nothing here is on by default; the
setting accepts only explicit loopback http origins and only in development.
"""

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.main import add_dev_cors
from tests.test_config import make_settings

ORIGIN = "http://localhost:8081"


def make_app(origins: list[str]) -> FastAPI:
    app = FastAPI()

    @app.get("/ping")
    async def ping() -> dict[str, str]:
        return {"ok": "yes"}

    add_dev_cors(app, origins)
    return app


async def preflight(app: FastAPI, origin: str, headers: str = "authorization,content-type"):  # type: ignore[no-untyped-def]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        return await client.options(
            "/ping",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": headers,
            },
        )


class TestMiddleware:
    async def test_a_configured_origin_passes_the_preflight(self) -> None:
        response = await preflight(make_app([ORIGIN]), ORIGIN)

        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == ORIGIN
        assert "authorization" in response.headers["access-control-allow-headers"].lower()
        # Bearer tokens only: cookies must never be allowed cross-origin.
        assert "access-control-allow-credentials" not in response.headers

    async def test_another_origin_is_refused(self) -> None:
        response = await preflight(make_app([ORIGIN]), "https://evil.example")

        assert response.status_code == 400
        assert "access-control-allow-origin" not in response.headers

    async def test_a_header_outside_the_list_is_refused(self) -> None:
        response = await preflight(make_app([ORIGIN]), ORIGIN, headers="x-anything")

        assert response.status_code == 400

    async def test_the_actual_response_carries_the_header_for_a_configured_origin_only(
        self,
    ) -> None:
        async with AsyncClient(
            transport=ASGITransport(app=make_app([ORIGIN])), base_url="http://test"
        ) as client:
            allowed = await client.get("/ping", headers={"Origin": ORIGIN})
            other = await client.get("/ping", headers={"Origin": "https://evil.example"})

        assert allowed.headers["access-control-allow-origin"] == ORIGIN
        assert "access-control-allow-origin" not in other.headers

    async def test_without_origins_no_cors_header_is_ever_sent(self) -> None:
        response = await preflight(make_app([]), ORIGIN)

        assert "access-control-allow-origin" not in response.headers


class TestSettings:
    def test_empty_by_default(self) -> None:
        settings = make_settings()

        assert settings.cors_origins == []
        settings.check_deployment_safety()

    def test_several_loopback_origins_are_accepted_in_development(self) -> None:
        settings = make_settings(
            ENVIRONMENT="development",
            CORS_ALLOWED_ORIGINS=" http://localhost:8081 , http://127.0.0.1:8082,http://localhost ",
        )

        settings.check_deployment_safety()

        assert settings.cors_origins == [
            "http://localhost:8081",
            "http://127.0.0.1:8082",
            "http://localhost",
        ]

    @pytest.mark.parametrize(
        "origin",
        [
            "*",
            "https://localhost:8081",
            "http://example.com",
            "http://localhost.evil.example",
            "http://localhost:8081/",
            "http://localhost:8081/path",
            "http://user@localhost:8081",
            "http://localhost:notaport",
            "http://192.168.1.34:8081",
            "localhost:8081",
        ],
    )
    def test_anything_but_a_plain_loopback_origin_is_refused(self, origin: str) -> None:
        settings = make_settings(ENVIRONMENT="development", CORS_ALLOWED_ORIGINS=origin)

        with pytest.raises(RuntimeError, match="CORS_ALLOWED_ORIGINS"):
            settings.check_deployment_safety()

    @pytest.mark.parametrize("environment", ["staging", "production"])
    def test_other_environments_refuse_any_origin(self, environment: str) -> None:
        settings = make_settings(ENVIRONMENT=environment, CORS_ALLOWED_ORIGINS=ORIGIN)

        with pytest.raises(RuntimeError, match="development-only"):
            settings.check_deployment_safety()

    def test_the_shipped_example_leaves_the_setting_off(self) -> None:
        from pathlib import Path

        example = Path(__file__).resolve().parents[1] / ".env.example"
        active = [
            line
            for line in example.read_text().splitlines()
            if line.startswith("CORS_ALLOWED_ORIGINS=")
        ]

        assert active == []
