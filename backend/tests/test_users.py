"""Tests for /users/me."""

from httpx import AsyncClient


class TestReadMe:
    async def test_returns_the_signed_in_profile(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.get("/users/me", headers=auth_headers)

        assert response.status_code == 200, response.text
        assert response.json()["username"] == "efe"

    async def test_requires_a_token(self, client: AsyncClient) -> None:
        response = await client.get("/users/me")
        assert response.status_code == 401

    async def test_rejects_a_refresh_token(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        """Refresh tokens exist only to mint access tokens; they must not open
        protected endpoints."""
        tokens = (await client.post("/auth/register", json=register_payload)).json()["tokens"]

        response = await client.get(
            "/users/me", headers={"Authorization": f"Bearer {tokens['refresh_token']}"}
        )

        assert response.status_code == 401

    async def test_rejects_a_malformed_token(self, client: AsyncClient) -> None:
        response = await client.get(
            "/users/me", headers={"Authorization": "Bearer not.a.real.token"}
        )
        assert response.status_code == 401


class TestUpdateMe:
    async def test_updates_only_the_fields_sent(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """PATCH semantics: omitted fields keep their value. Getting this wrong
        would silently wipe a profile when the app sends a partial form."""
        response = await client.patch(
            "/users/me", headers=auth_headers, json={"bio": "Natural bodybuilder"}
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["bio"] == "Natural bodybuilder"
        assert body["display_name"] == "Efe"  # untouched

    async def test_explicit_null_clears_a_field(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """Sending null is different from omitting: it means "clear this"."""
        await client.patch("/users/me", headers=auth_headers, json={"bio": "temporary"})

        response = await client.patch("/users/me", headers=auth_headers, json={"bio": None})

        assert response.json()["bio"] is None

    async def test_changes_persist(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        await client.patch("/users/me", headers=auth_headers, json={"weight_unit": "lb"})

        response = await client.get("/users/me", headers=auth_headers)

        assert response.json()["weight_unit"] == "lb"

    async def test_can_switch_timezone(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """Users travel and relocate, so this has to be changeable."""
        response = await client.patch(
            "/users/me", headers=auth_headers, json={"timezone": "Europe/Berlin"}
        )

        assert response.status_code == 200
        assert response.json()["timezone"] == "Europe/Berlin"

    async def test_rejects_unknown_timezone(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.patch(
            "/users/me", headers=auth_headers, json={"timezone": "Foo/Bar"}
        )
        assert response.status_code == 422

    async def test_rejects_invalid_weight_unit(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.patch(
            "/users/me", headers=auth_headers, json={"weight_unit": "stones"}
        )
        assert response.status_code == 422

    async def test_requires_a_token(self, client: AsyncClient) -> None:
        response = await client.patch("/users/me", json={"bio": "anything"})
        assert response.status_code == 401