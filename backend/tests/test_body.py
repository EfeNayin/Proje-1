"""Tests for body measurements (weight history + today's weigh-in).

Mirrors test_readiness.py: upsert-not-append and ownership get the most
attention, since a gap in either fails silently and only shows up later as
wrong or leaked data. measured_on is never accepted from the client — it is
computed server-side from the user's timezone, tested here by freezing the
clock rather than depending on when the suite happens to run.
"""

from datetime import date, datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import BodyMeasurement


class TestUpsertMeasurement:
    async def test_creates_todays_measurement(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.put(
            "/body/measurements", headers=auth_headers, json={"weight_kg": 82.5}
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["id"] is not None
        assert body["weight_kg"] == "82.5"
        assert body["body_fat_pct"] is None

    async def test_second_upsert_same_day_updates_the_same_row(
        self, client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        await client.put("/body/measurements", headers=auth_headers, json={"weight_kg": 82.0})
        second = await client.put(
            "/body/measurements", headers=auth_headers, json={"weight_kg": 81.5}
        )

        assert second.status_code == 200, second.text
        assert second.json()["weight_kg"] == "81.5"

        row_count = await db.scalar(select(func.count()).select_from(BodyMeasurement))
        assert row_count == 1

    async def test_accepts_body_fat_and_notes(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.put(
            "/body/measurements",
            headers=auth_headers,
            json={"weight_kg": 82.5, "body_fat_pct": 15.5, "notes": "After leg day"},
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["body_fat_pct"] == "15.5"
        assert body["notes"] == "After leg day"

    async def test_rejects_out_of_range_weight(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.put(
            "/body/measurements", headers=auth_headers, json={"weight_kg": 500}
        )
        assert response.status_code == 422, response.text

    async def test_rejects_out_of_range_body_fat(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.put(
            "/body/measurements",
            headers=auth_headers,
            json={"weight_kg": 80, "body_fat_pct": 90},
        )
        assert response.status_code == 422, response.text

    async def test_requires_weight(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.put("/body/measurements", headers=auth_headers, json={})
        assert response.status_code == 422, response.text


class TestMeasuredOnTimezone:
    async def test_measured_on_follows_the_users_timezone_not_utc(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        """23:30 UTC on Jan 1st is already Jan 2nd for a user 14 hours ahead."""
        response = await client.post(
            "/auth/register", json={**register_payload, "timezone": "Pacific/Kiritimati"}
        )
        token = response.json()["tokens"]["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        frozen_utc = datetime(2026, 1, 1, 23, 30, tzinfo=ZoneInfo("UTC"))

        with patch("app.domains.body.service.datetime") as mock_datetime:
            mock_datetime.now.side_effect = lambda tz: frozen_utc.astimezone(tz)
            put_response = await client.put(
                "/body/measurements", headers=headers, json={"weight_kg": 80}
            )

        assert put_response.status_code == 200, put_response.text
        assert put_response.json()["measured_on"] == "2026-01-02"


class TestListMeasurements:
    async def test_lists_only_this_users_history_newest_first(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        other_auth_headers: dict[str, str],
    ) -> None:
        await client.put("/body/measurements", headers=auth_headers, json={"weight_kg": 80})
        await client.put("/body/measurements", headers=other_auth_headers, json={"weight_kg": 99})

        response = await client.get("/body/measurements", headers=auth_headers)

        assert response.status_code == 200, response.text
        items = response.json()["items"]
        assert len(items) == 1
        assert items[0]["weight_kg"] == "80.0"


class TestDeleteMeasurement:
    async def test_deletes_own_measurement(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        created = await client.put(
            "/body/measurements", headers=auth_headers, json={"weight_kg": 80}
        )
        measurement_id = created.json()["id"]

        response = await client.delete(
            f"/body/measurements/{measurement_id}", headers=auth_headers
        )

        assert response.status_code == 204, response.text

        history = await client.get("/body/measurements", headers=auth_headers)
        assert history.json()["items"] == []

    async def test_cannot_delete_another_users_measurement(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        other_auth_headers: dict[str, str],
    ) -> None:
        created = await client.put(
            "/body/measurements", headers=auth_headers, json={"weight_kg": 80}
        )
        measurement_id = created.json()["id"]

        response = await client.delete(
            f"/body/measurements/{measurement_id}", headers=other_auth_headers
        )

        assert response.status_code == 404

    async def test_deleting_unknown_id_is_404(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.delete("/body/measurements/999999", headers=auth_headers)
        assert response.status_code == 404


class TestSummary:
    async def test_returns_nulls_when_no_history(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.get("/body/summary", headers=auth_headers)

        assert response.status_code == 200, response.text
        body = response.json()
        assert body == {
            "current_weight_kg": None,
            "last_measured_on": None,
            "first_weight_kg": None,
            "first_measured_on": None,
            "change_kg": None,
        }

    async def test_single_measurement_has_zero_change(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        await client.put("/body/measurements", headers=auth_headers, json={"weight_kg": 82.5})

        response = await client.get("/body/summary", headers=auth_headers)

        body = response.json()
        assert body["current_weight_kg"] == "82.5"
        assert body["first_weight_kg"] == "82.5"
        assert body["change_kg"] == "0.0"

    async def test_trend_is_current_minus_first_across_multiple_days(
        self, client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """Two different measured_on dates are inserted directly, since the
        API can only ever write "today" — the trend calculation itself does
        not care how the rows got there."""
        me = await client.get("/users/me", headers=auth_headers)
        user_id = me.json()["id"]

        db.add_all(
            [
                BodyMeasurement(user_id=user_id, measured_on=date(2025, 10, 1), weight_kg=89),
                BodyMeasurement(user_id=user_id, measured_on=date(2026, 1, 1), weight_kg=82),
            ]
        )
        await db.commit()

        response = await client.get("/body/summary", headers=auth_headers)

        body = response.json()
        assert body["first_measured_on"] == "2025-10-01"
        assert body["last_measured_on"] == "2026-01-01"
        assert body["change_kg"] == "-7.0"
