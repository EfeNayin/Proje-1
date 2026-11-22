"""The optional registration phone number: normalization, ownership, editing, privacy.

The number is unverified contact information typed by the account owner. These tests pin
what that means: it is normalized to E.164 or refused, blank stays valid, older clients that
never send it keep working, only the owner ever sees it (not a coach, not an athlete, not an
error body), the owner can correct and clear it, and deleting the account removes it.

The normalizer cases in `NORMALIZATION` are the shared contract with the mobile client
(mobile/src/account/phoneNumber.ts, mobile/tests/phone-number.test.cjs): the same inputs
must give the same result in both places.
"""

import json

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.domains.auth.schemas import (
    PHONE_COUNTRY_CODE_HINT,
    PHONE_INPUT_MAX_LENGTH,
    normalize_phone_number,
)
from tests.test_coaching import Headers, _connect, _register
from tests.test_coaching_workouts import _log, _share

# (what the person typed, what is stored)
NORMALIZATION: list[tuple[str, str | None]] = [
    ("+905321234567", "+905321234567"),
    ("+90 532 123 45 67", "+905321234567"),
    ("+90 (532) 123-45-67", "+905321234567"),
    ("+90.532.123.45.67", "+905321234567"),
    ("  +90 532 123 45 67  ", "+905321234567"),
    ("00905321234567", "+905321234567"),
    ("0090 532 123 45 67", "+905321234567"),
    ("+1 (415) 555-0132", "+14155550132"),
    ("+44 7911 123456", "+447911123456"),
    ("+49 151 23456789", "+4915123456789"),
    ("+12345678", "+12345678"),  # shortest accepted: 8 digits
    ("+123456789012345", "+123456789012345"),  # longest accepted: 15 digits
    ("", None),
    ("   ", None),
]

# Rejected, each for a different reason.
REJECTED = [
    "05321234567",  # no country code: a national number is never guessed
    "532 123 45 67",
    "90 532 123 45 67",  # country code without the +
    "+",
    "+ - ( )",
    "+0 532 123 45 67",  # country codes never start with 0
    "+0905321234567",
    "+9053212",  # 7 digits: too short
    "+1234567890123456",  # 16 digits: too long
    "+90 532 abc 45 67",
    "+90 532 123 45 67 ext 5",
    "+90 532 123 45 67 #",
    "+٩٠٥٣٢١٢٣٤٥٦٧",  # Arabic-Indic digits: ASCII digits only
    "+90²5321234567",  # superscript two passes str.isdigit()
    "++905321234567",
    "+90+5321234567",
    "+90 532 123 45 67\n+90 532 123 45 68",
]


class TestNormalizer:
    @pytest.mark.parametrize(("typed", "stored"), NORMALIZATION)
    def test_normalizes(self, typed: str, stored: str | None) -> None:
        assert normalize_phone_number(typed) == stored

    @pytest.mark.parametrize("typed", REJECTED)
    def test_rejects(self, typed: str) -> None:
        with pytest.raises(ValueError) as caught:
            normalize_phone_number(typed)
        # The message reaches logs and clients; it must not repeat what was typed. (The fixed
        # hint carries its own example number, which is not the person's input.)
        message = str(caught.value).replace(PHONE_COUNTRY_CODE_HINT, "")
        if any(character.isdigit() for character in typed):
            assert typed.strip() not in message

    def test_it_asks_for_a_country_code_instead_of_assuming_one(self) -> None:
        with pytest.raises(ValueError, match="country code"):
            normalize_phone_number("0532 123 45 67")


class TestRegistration:
    async def test_without_a_phone_number(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        response = await client.post("/auth/register", json=register_payload)

        assert response.status_code == 201, response.text
        assert response.json()["user"]["phone_number"] is None

    @pytest.mark.parametrize("blank", [None, "", "   "])
    async def test_a_blank_phone_number_is_valid_and_stored_as_nothing(
        self, client: AsyncClient, register_payload: dict[str, str], blank: str | None
    ) -> None:
        response = await client.post(
            "/auth/register", json={**register_payload, "phone_number": blank}
        )

        assert response.status_code == 201, response.text
        assert response.json()["user"]["phone_number"] is None

    async def test_a_phone_number_is_normalized_before_it_is_stored(
        self, client: AsyncClient, db: AsyncSession, register_payload: dict[str, str]
    ) -> None:
        response = await client.post(
            "/auth/register", json={**register_payload, "phone_number": "+90 (532) 123-45-67"}
        )

        assert response.status_code == 201, response.text
        assert response.json()["user"]["phone_number"] == "+905321234567"
        stored = (
            await db.execute(text("SELECT phone_number FROM users WHERE username = 'efe'"))
        ).scalar_one()
        assert stored == "+905321234567"

    async def test_international_numbers_are_not_assumed_to_be_turkish(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        response = await client.post(
            "/auth/register", json={**register_payload, "phone_number": "+1 415 555 0132"}
        )

        assert response.json()["user"]["phone_number"] == "+14155550132"

    @pytest.mark.parametrize("typed", ["05321234567", "+9053212", "+90 532 abc 45 67"])
    async def test_an_invalid_phone_number_is_refused_without_creating_the_account(
        self, client: AsyncClient, db: AsyncSession, register_payload: dict[str, str], typed: str
    ) -> None:
        response = await client.post(
            "/auth/register", json={**register_payload, "phone_number": typed}
        )

        assert response.status_code == 422
        assert response.json()["detail"][0]["loc"] == ["body", "phone_number"]
        # The submitted value is never echoed back.
        assert typed not in response.text
        count = (await db.execute(text("SELECT count(*) FROM users"))).scalar_one()
        assert count == 0

    async def test_an_overlong_phone_number_is_refused(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        response = await client.post(
            "/auth/register",
            json={**register_payload, "phone_number": "+" + "1" * PHONE_INPUT_MAX_LENGTH},
        )

        assert response.status_code == 422

    async def test_the_phone_number_does_not_weaken_the_other_rules(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        response = await client.post(
            "/auth/register",
            json={**register_payload, "username": "x!", "phone_number": "+905321234567"},
        )

        assert response.status_code == 422
        assert response.json()["detail"][0]["loc"] == ["body", "username"]

    async def test_two_accounts_may_share_a_number(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        # Unverified contact information, not an identifier: no uniqueness, so signing up
        # with a number also reveals nothing about whether someone else already uses it.
        first = await client.post(
            "/auth/register", json={**register_payload, "phone_number": "+905321234567"}
        )
        second = await client.post(
            "/auth/register",
            json={
                **register_payload,
                "email": "other@example.com",
                "username": "other",
                "phone_number": "+905321234567",
            },
        )

        assert first.status_code == second.status_code == 201

    async def test_login_returns_it_to_its_owner_only(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        await client.post(
            "/auth/register", json={**register_payload, "phone_number": "+905321234567"}
        )

        response = await client.post(
            "/auth/login",
            json={"email": register_payload["email"], "password": register_payload["password"]},
        )

        assert response.status_code == 200, response.text
        assert response.json()["user"]["phone_number"] == "+905321234567"

    async def test_signing_in_with_the_number_is_not_a_thing(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        await client.post(
            "/auth/register", json={**register_payload, "phone_number": "+905321234567"}
        )

        response = await client.post(
            "/auth/login",
            json={"email": "+905321234567", "password": register_payload["password"]},
        )

        assert response.status_code == 422


class TestOlderClients:
    async def test_an_account_without_a_number_reads_and_updates_as_before(
        self, client: AsyncClient, auth_headers: Headers
    ) -> None:
        profile = await client.get("/users/me", headers=auth_headers)
        patched = await client.patch("/users/me", headers=auth_headers, json={"bio": "lifting"})

        assert profile.status_code == patched.status_code == 200
        assert profile.json()["phone_number"] is None
        assert patched.json()["bio"] == "lifting"

    async def test_a_register_body_from_before_the_field_existed_still_works(
        self, client: AsyncClient
    ) -> None:
        response = await client.post(
            "/auth/register",
            json={
                "email": "old@example.com",
                "username": "oldclient",
                "password": "supersecret123",
                "timezone": "Europe/Istanbul",
                "locale": "tr",
            },
        )

        assert response.status_code == 201, response.text

    async def test_an_update_that_does_not_mention_the_number_keeps_it(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        registered = await client.post(
            "/auth/register", json={**register_payload, "phone_number": "+905321234567"}
        )
        headers = {"Authorization": f"Bearer {registered.json()['tokens']['access_token']}"}

        patched = await client.patch("/users/me", headers=headers, json={"first_name": "Efe C."})

        assert patched.json()["phone_number"] == "+905321234567"


class TestOwnerEditing:
    @pytest.fixture
    async def headers(self, client: AsyncClient, register_payload: dict[str, str]) -> Headers:
        registered = await client.post(
            "/auth/register", json={**register_payload, "phone_number": "+905321234567"}
        )
        return {"Authorization": f"Bearer {registered.json()['tokens']['access_token']}"}

    async def test_the_owner_reads_it_back(self, client: AsyncClient, headers: Headers) -> None:
        response = await client.get("/users/me", headers=headers)

        assert response.json()["phone_number"] == "+905321234567"

    async def test_correcting_it_stores_the_normalized_value(
        self, client: AsyncClient, headers: Headers
    ) -> None:
        response = await client.patch(
            "/users/me", headers=headers, json={"phone_number": "+44 7911 123456"}
        )

        assert response.status_code == 200, response.text
        assert response.json()["phone_number"] == "+447911123456"
        assert (await client.get("/users/me", headers=headers)).json()["phone_number"] == (
            "+447911123456"
        )

    @pytest.mark.parametrize("clearing", [None, "", "   "])
    async def test_clearing_it(
        self, client: AsyncClient, headers: Headers, clearing: str | None
    ) -> None:
        response = await client.patch("/users/me", headers=headers, json={"phone_number": clearing})

        assert response.status_code == 200, response.text
        assert response.json()["phone_number"] is None
        assert (await client.get("/users/me", headers=headers)).json()["phone_number"] is None

    async def test_it_can_be_added_after_registering_without_one(
        self, client: AsyncClient, auth_headers: Headers
    ) -> None:
        response = await client.patch(
            "/users/me", headers=auth_headers, json={"phone_number": "00 49 151 23456789"}
        )

        assert response.json()["phone_number"] == "+4915123456789"

    async def test_an_invalid_correction_is_refused_and_changes_nothing(
        self, client: AsyncClient, headers: Headers
    ) -> None:
        response = await client.patch(
            "/users/me", headers=headers, json={"phone_number": "05321234567"}
        )

        assert response.status_code == 422
        assert "05321234567" not in response.text
        assert (await client.get("/users/me", headers=headers)).json()["phone_number"] == (
            "+905321234567"
        )

    async def test_a_mixed_update_is_all_or_nothing(
        self, client: AsyncClient, headers: Headers
    ) -> None:
        response = await client.patch(
            "/users/me", headers=headers, json={"bio": "new bio", "phone_number": "nope"}
        )

        assert response.status_code == 422
        profile = (await client.get("/users/me", headers=headers)).json()
        assert profile["bio"] is None
        assert profile["phone_number"] == "+905321234567"

    async def test_someone_else_cannot_change_it(
        self, client: AsyncClient, headers: Headers, other_auth_headers: Headers
    ) -> None:
        # /users/me is always the caller's own account: there is no way to name another.
        await client.patch(
            "/users/me", headers=other_auth_headers, json={"phone_number": "+14155550132"}
        )

        assert (await client.get("/users/me", headers=headers)).json()["phone_number"] == (
            "+905321234567"
        )
        assert (await client.get("/users/me", headers=other_auth_headers)).json()[
            "phone_number"
        ] == "+14155550132"


class TestDatabaseRule:
    """The CHECK constraint backs the API up: nothing free-form can reach the column."""

    @pytest.mark.parametrize(
        "value", ["05321234567", "+0905321234567", "+9053212", "+1234567890123456", "+90 532", ""]
    )
    async def test_refuses_what_is_not_e164(
        self, client: AsyncClient, db: AsyncSession, auth_headers: Headers, value: str
    ) -> None:
        with pytest.raises(IntegrityError):
            await db.execute(
                text("UPDATE users SET phone_number = :value WHERE username = 'efe'"),
                {"value": value},
            )
        await db.rollback()

    async def test_accepts_null_and_e164(
        self, client: AsyncClient, db: AsyncSession, auth_headers: Headers
    ) -> None:
        await db.execute(text("UPDATE users SET phone_number = '+905321234567'"))
        await db.execute(text("UPDATE users SET phone_number = NULL"))
        await db.commit()


class TestPrivacy:
    NUMBERS = {"coach": "+905321234567", "athlete": "+14155550132"}

    async def _signup(self, client: AsyncClient, username: str, number: str) -> Headers:
        response = await client.post(
            "/auth/register",
            json={
                "email": f"{username}@example.com",
                "username": username,
                "password": "supersecret123",
                "first_name": username.capitalize(),
                "phone_number": number,
            },
        )
        assert response.status_code == 201, response.text
        return {"Authorization": f"Bearer {response.json()['tokens']['access_token']}"}

    async def test_a_coach_never_receives_an_athletes_number_and_the_reverse(
        self, client: AsyncClient
    ) -> None:
        coach = await self._signup(client, "coachy", self.NUMBERS["coach"])
        athlete = await self._signup(client, "athletey", self.NUMBERS["athlete"])
        assert (await client.post("/coaching/enable", headers=coach)).status_code == 200
        link_id = await _connect(client, coach, athlete)
        # Sharing on, with one finished workout, so the coach's views have something to show.
        assert (await _share(client, athlete, link_id)).status_code == 200
        workout_id = await _log(client, athlete, title="Push", days_ago=1)

        seen: dict[str, str] = {}
        for who, headers, path in [
            ("coach", coach, "/coaching/athletes"),
            ("coach", coach, "/coaching/athletes/overview"),
            ("coach", coach, f"/coaching/athletes/{link_id}/workouts"),
            ("coach", coach, f"/coaching/athletes/{link_id}/workouts/{workout_id}"),
            ("coach", coach, f"/coaching/athletes/{link_id}/program-offers"),
            ("athlete", athlete, "/coaching/coaches"),
            ("athlete", athlete, "/coaching/program-offers"),
        ]:
            response = await client.get(path, headers=headers)
            assert response.status_code == 200, (path, response.text)
            seen[f"{who} {path}"] = response.text

        digits = {number.lstrip("+") for number in self.NUMBERS.values()}
        for where, body in seen.items():
            assert "phone" not in body.lower(), where
            for number in digits:
                assert number not in body, where

    async def test_an_invite_preview_does_not_carry_the_coachs_number(
        self, client: AsyncClient
    ) -> None:
        coach = await self._signup(client, "coachy", self.NUMBERS["coach"])
        athlete = await _register(client, "athletey")
        await client.post("/coaching/enable", headers=coach)
        code = (await client.post("/coaching/invites", headers=coach)).json()["code"]

        preview = await client.post(
            "/coaching/invites/preview", headers=athlete, json={"code": code}
        )

        assert preview.status_code == 200, preview.text
        assert "phone" not in preview.text.lower()
        assert "905321234567" not in preview.text

    async def test_enabling_coach_tools_returns_only_the_callers_own_profile(
        self, client: AsyncClient
    ) -> None:
        coach = await self._signup(client, "coachy", self.NUMBERS["coach"])

        response = await client.post("/coaching/enable", headers=coach)

        assert response.json()["phone_number"] == self.NUMBERS["coach"]

    async def test_a_rejected_request_never_echoes_the_number(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        typed = "05321234567"

        response = await client.post(
            "/auth/register", json={**register_payload, "phone_number": typed}
        )

        assert typed not in json.dumps(response.json())
        assert typed not in response.text

    async def test_the_number_is_not_written_to_the_logs(
        self,
        client: AsyncClient,
        register_payload: dict[str, str],
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        caplog.set_level("DEBUG")

        await client.post(
            "/auth/register", json={**register_payload, "phone_number": "+90 532 123 45 67"}
        )
        await client.post(
            "/auth/register",
            json={**register_payload, "username": "bad1", "phone_number": "05321234567"},
        )

        assert "905321234567" not in caplog.text
        assert "532 123 45 67" not in caplog.text
        assert "05321234567" not in caplog.text


class TestAccountDeletion:
    async def test_deleting_the_account_removes_the_number_and_leaves_other_accounts(
        self, client: AsyncClient, db: AsyncSession, register_payload: dict[str, str]
    ) -> None:
        mine = await client.post(
            "/auth/register", json={**register_payload, "phone_number": "+905321234567"}
        )
        other = await client.post(
            "/auth/register",
            json={
                **register_payload,
                "email": "other@example.com",
                "username": "other",
                "phone_number": "+14155550132",
            },
        )
        headers = {"Authorization": f"Bearer {mine.json()['tokens']['access_token']}"}
        assert other.status_code == 201

        response = await client.post(
            "/users/me/delete-account", headers=headers, json={"password": "supersecret123"}
        )

        assert response.status_code in (200, 204), response.text
        rows = (await db.execute(text("SELECT phone_number FROM users"))).scalars().all()
        assert rows == ["+14155550132"]
        # The number is not left behind anywhere else in the database.
        for table in (
            await db.execute(
                text(
                    "SELECT table_name FROM information_schema.columns "
                    "WHERE table_schema = 'public' AND data_type IN ('text', 'jsonb', 'json', "
                    "'character varying', 'USER-DEFINED') AND table_name <> 'alembic_version'"
                )
            )
        ).scalars():
            if table == "users":
                continue
            query = text(f'SELECT count(*) FROM "{table}" t WHERE t::text LIKE :needle')
            found = (await db.execute(query, {"needle": "%905321234567%"})).scalar_one()
            assert found == 0, table
