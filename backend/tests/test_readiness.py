"""Tests for the daily readiness check-in.

Ownership and the upsert-not-append behaviour get the most attention, for the
same reason they get it in test_workouts.py: a gap in either fails silently
and only shows up later as wrong or leaked data.

log_date is never accepted from the client — it is computed server-side from
the user's timezone, the same way weekly volume cuts its week boundary. That
is tested by freezing the clock rather than depending on when the test suite
happens to run, so the assertion holds regardless of wall-clock time.
"""

from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ReadinessLog


class TestGetToday:
    async def test_returns_an_empty_shell_when_nothing_logged_yet(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.get("/readiness/today", headers=auth_headers)

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["id"] is None
        assert body["sleep_hours"] is None
        assert body["soreness"] is None

    async def test_returns_the_logged_values_after_upsert(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        await client.put(
            "/readiness/today", headers=auth_headers, json={"sleep_hours": 7.5, "mood": 4}
        )

        response = await client.get("/readiness/today", headers=auth_headers)

        body = response.json()
        assert body["id"] is not None
        assert body["sleep_hours"] == "7.5"
        assert body["mood"] == 4


class TestUpsertToday:
    async def test_empty_body_is_accepted(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """The whole point of the feature: sleep alone, or nothing at all."""
        response = await client.put("/readiness/today", headers=auth_headers, json={})

        assert response.status_code == 200, response.text
        assert response.json()["sleep_hours"] is None

    async def test_second_upsert_same_day_updates_the_same_row(
        self, client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        await client.put("/readiness/today", headers=auth_headers, json={"energy": 2})
        second = await client.put("/readiness/today", headers=auth_headers, json={"energy": 5})

        assert second.status_code == 200, second.text
        assert second.json()["energy"] == 5

        row_count = await db.scalar(select(func.count()).select_from(ReadinessLog))
        assert row_count == 1

    async def test_rejects_out_of_range_rating(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.put("/readiness/today", headers=auth_headers, json={"mood": 6})
        assert response.status_code == 422, response.text


class TestSorenessValidation:
    async def test_accepts_known_muscle_group_keys(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.put(
            "/readiness/today",
            headers=auth_headers,
            json={"soreness": {"chest": 3, "quads": 5}},
        )

        assert response.status_code == 200, response.text
        assert response.json()["soreness"] == {"chest": 3, "quads": 5}

    async def test_rejects_unknown_muscle_group_key(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.put(
            "/readiness/today",
            headers=auth_headers,
            json={"soreness": {"not_a_muscle": 3}},
        )

        assert response.status_code == 422, response.text

    async def test_rejects_out_of_range_soreness_value(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.put(
            "/readiness/today", headers=auth_headers, json={"soreness": {"chest": 9}}
        )
        assert response.status_code == 422, response.text


class TestOwnership:
    async def test_cannot_see_another_users_log(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        other_auth_headers: dict[str, str],
    ) -> None:
        await client.put("/readiness/today", headers=auth_headers, json={"sleep_hours": 9.0})

        response = await client.get("/readiness/today", headers=other_auth_headers)

        assert response.status_code == 200, response.text
        assert response.json()["id"] is None  # the intruder has no log of their own


class TestHistory:
    async def test_lists_only_this_users_recent_logs(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        other_auth_headers: dict[str, str],
    ) -> None:
        await client.put("/readiness/today", headers=auth_headers, json={"mood": 3})
        await client.put("/readiness/today", headers=other_auth_headers, json={"mood": 5})

        response = await client.get("/readiness?days=7", headers=auth_headers)

        assert response.status_code == 200, response.text
        items = response.json()["items"]
        assert len(items) == 1
        assert items[0]["mood"] == 3


class TestLogDateTimezone:
    async def test_log_date_follows_the_users_timezone_not_utc(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        """23:30 UTC on Jan 1st is already Jan 2nd for a user 14 hours ahead.

        The clock is frozen so this holds regardless of when the suite runs.
        """
        response = await client.post(
            "/auth/register", json={**register_payload, "timezone": "Pacific/Kiritimati"}
        )
        token = response.json()["tokens"]["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        frozen_utc = datetime(2026, 1, 1, 23, 30, tzinfo=ZoneInfo("UTC"))

        with patch("app.domains.readiness.service.datetime") as mock_datetime:
            mock_datetime.now.side_effect = lambda tz: frozen_utc.astimezone(tz)
            put_response = await client.put("/readiness/today", headers=headers, json={})

        assert put_response.status_code == 200, put_response.text
        assert put_response.json()["log_date"] == "2026-01-02"

    async def test_moving_timezone_changes_which_day_a_new_upsert_lands_on(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """Same instant, opposite conclusion once the user is 12 hours behind."""
        frozen_utc = datetime(2026, 1, 1, 23, 30, tzinfo=ZoneInfo("UTC"))

        with patch("app.domains.readiness.service.datetime") as mock_datetime:
            mock_datetime.now.side_effect = lambda tz: frozen_utc.astimezone(tz)

            istanbul_response = await client.put("/readiness/today", headers=auth_headers, json={})
            assert istanbul_response.json()["log_date"] == "2026-01-02"

            await client.patch("/users/me", headers=auth_headers, json={"timezone": "Etc/GMT+12"})

            behind_response = await client.put("/readiness/today", headers=auth_headers, json={})
            assert behind_response.json()["log_date"] == "2026-01-01"
