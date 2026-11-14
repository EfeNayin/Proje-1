"""PATCH /readiness/today: a partial update for screens that edit only some fields.

The standalone daily check-in edits sleep (and nothing else) without starting a workout,
so it must not wipe mood, notes or soreness that were recorded earlier the same day, and
it must never create a workout. PUT keeps replacing the whole row (the pre-workout flow
and its tests are unchanged); PATCH is the merge.
"""

import asyncio
from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ReadinessLog, Workout

FULL = {
    "sleep_hours": 6.5,
    "sleep_quality": 3,
    "energy": 4,
    "mood": 2,
    "soreness": {"chest": 3, "quads": 5},
    "notes": "slept badly",
}


async def _count(db: AsyncSession, model: type) -> int:
    return int(await db.scalar(select(func.count()).select_from(model)) or 0)


async def test_patch_changes_only_the_sent_field(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    await client.put("/readiness/today", headers=auth_headers, json=FULL)

    response = await client.patch("/readiness/today", headers=auth_headers, json={"sleep_hours": 8})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["sleep_hours"] == "8.0"
    assert body["sleep_quality"] == 3
    assert body["energy"] == 4
    assert body["mood"] == 2
    assert body["soreness"] == {"chest": 3, "quads": 5}
    assert body["notes"] == "slept badly"
    again = (await client.get("/readiness/today", headers=auth_headers)).json()
    assert again == body


async def test_patch_with_an_explicit_null_clears_only_that_field(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    await client.put("/readiness/today", headers=auth_headers, json=FULL)

    body = (
        await client.patch("/readiness/today", headers=auth_headers, json={"sleep_hours": None})
    ).json()

    assert body["sleep_hours"] is None
    assert body["sleep_quality"] == 3 and body["mood"] == 2 and body["notes"] == "slept badly"


async def test_patch_creates_today_when_nothing_was_logged(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
) -> None:
    response = await client.patch(
        "/readiness/today", headers=auth_headers, json={"sleep_hours": 7.5}
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] is not None and body["sleep_hours"] == "7.5"
    assert body["energy"] is None and body["mood"] is None and body["soreness"] is None
    assert await _count(db, ReadinessLog) == 1


async def test_zero_hours_of_sleep_is_a_valid_recorded_value(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await client.patch("/readiness/today", headers=auth_headers, json={"sleep_hours": 0})

    assert response.status_code == 200, response.text
    assert response.json()["sleep_hours"] == "0.0"


async def test_patch_never_creates_a_workout_even_when_repeated(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
) -> None:
    for hours in (7, 7, 8, None):
        response = await client.patch(
            "/readiness/today", headers=auth_headers, json={"sleep_hours": hours}
        )
        assert response.status_code == 200, response.text

    assert await _count(db, Workout) == 0
    assert await _count(db, ReadinessLog) == 1


async def test_repeating_the_same_patch_is_idempotent(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    first = (
        await client.patch("/readiness/today", headers=auth_headers, json={"sleep_hours": 7})
    ).json()
    second = (
        await client.patch("/readiness/today", headers=auth_headers, json={"sleep_hours": 7})
    ).json()

    assert first == second


async def test_concurrent_patches_of_different_fields_both_survive(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    await client.put("/readiness/today", headers=auth_headers, json={})
    results = await asyncio.gather(
        client.patch("/readiness/today", headers=auth_headers, json={"sleep_hours": 7}),
        client.patch("/readiness/today", headers=auth_headers, json={"energy": 5}),
        client.patch("/readiness/today", headers=auth_headers, json={"mood": 4}),
    )
    assert all(result.status_code == 200 for result in results)

    body = (await client.get("/readiness/today", headers=auth_headers)).json()
    assert body["sleep_hours"] == "7.0" and body["energy"] == 5 and body["mood"] == 4


async def test_an_empty_patch_is_refused_and_writes_nothing(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
) -> None:
    response = await client.patch("/readiness/today", headers=auth_headers, json={})

    assert response.status_code == 422, response.text
    assert await _count(db, ReadinessLog) == 0


async def test_existing_validation_still_applies(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
) -> None:
    for payload in (
        {"sleep_hours": 25},
        {"sleep_hours": -1},
        {"sleep_hours": 7.55},
        {"energy": 6},
        {"soreness": {"not_a_muscle": 3}},
        {"soreness": {"chest": 9}},
    ):
        response = await client.patch("/readiness/today", headers=auth_headers, json=payload)
        assert response.status_code == 422, (payload, response.text)

    assert await _count(db, ReadinessLog) == 0


async def test_a_changed_local_day_refuses_the_draft_instead_of_moving_it(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
) -> None:
    frozen = datetime(2026, 1, 1, 23, 30, tzinfo=ZoneInfo("UTC"))  # Jan 2 in Istanbul.
    with patch("app.domains.readiness.service.datetime") as clock:
        clock.now.side_effect = lambda tz: frozen.astimezone(tz)

        stale = await client.patch(
            "/readiness/today",
            headers=auth_headers,
            json={"sleep_hours": 7, "expected_log_date": "2026-01-01"},
        )
        assert stale.status_code == 409, stale.text
        assert await _count(db, ReadinessLog) == 0

        fresh = await client.patch(
            "/readiness/today",
            headers=auth_headers,
            json={"sleep_hours": 7, "expected_log_date": "2026-01-02"},
        )
        assert fresh.status_code == 200, fresh.text
        assert fresh.json()["log_date"] == "2026-01-02"


async def test_the_day_follows_the_users_timezone_not_the_clients_claim(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    frozen = datetime(2026, 1, 1, 23, 30, tzinfo=ZoneInfo("UTC"))
    with patch("app.domains.readiness.service.datetime") as clock:
        clock.now.side_effect = lambda tz: frozen.astimezone(tz)
        istanbul = await client.patch("/readiness/today", headers=auth_headers, json={"energy": 3})
        assert istanbul.json()["log_date"] == "2026-01-02"

        await client.patch("/users/me", headers=auth_headers, json={"timezone": "Etc/GMT+12"})
        behind = await client.patch("/readiness/today", headers=auth_headers, json={"energy": 4})
        assert behind.json()["log_date"] == "2026-01-01"


async def test_patch_cannot_touch_another_users_log(
    client: AsyncClient,
    db: AsyncSession,
    auth_headers: dict[str, str],
    other_auth_headers: dict[str, str],
) -> None:
    await client.put("/readiness/today", headers=other_auth_headers, json=FULL)

    await client.patch("/readiness/today", headers=auth_headers, json={"sleep_hours": 3})

    theirs = (await client.get("/readiness/today", headers=other_auth_headers)).json()
    assert theirs["sleep_hours"] == "6.5" and theirs["notes"] == "slept badly"
    assert await _count(db, ReadinessLog) == 2


async def test_patch_requires_authentication(client: AsyncClient) -> None:
    response = await client.patch("/readiness/today", json={"sleep_hours": 7})
    assert response.status_code == 401


async def test_put_still_replaces_the_whole_row(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The pre-workout check-in keeps its documented replace semantics."""
    await client.put("/readiness/today", headers=auth_headers, json=FULL)

    body = (
        await client.put("/readiness/today", headers=auth_headers, json={"energy": 2})
    ).json()

    assert body["energy"] == 2 and body["sleep_hours"] is None and body["notes"] is None
