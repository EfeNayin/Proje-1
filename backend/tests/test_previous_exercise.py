"""Previous exercise records: chronology, ownership and honest record scope."""

from typing import Any
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Workout


async def create(
    client: AsyncClient,
    headers: dict[str, str],
    day: int,
    sets: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    response = await client.post(
        "/workouts",
        headers=headers,
        json={
            "performed_at": f"2026-08-{day:02d}T12:00:00Z",
            "sets": sets or [],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()  # type: ignore[no-any-return]


def logged(exercise: str, **changes: Any) -> dict[str, Any]:
    return {"exercise_id": exercise, "weight_kg": 20, "reps": 8, **changes}


async def previous(
    client: AsyncClient,
    headers: dict[str, str],
    workout: str,
    exercise: str,
) -> Any:
    response = await client.get(
        f"/workouts/{workout}/exercises/{exercise}/previous",
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_returns_latest_earlier_session_and_only_its_working_sets(
    client: AsyncClient,
    auth_headers: dict[str, str],
    bench_press_id: str,
    squat_id: str,
) -> None:
    await create(client, auth_headers, 1, [logged(bench_press_id)])
    expected = await create(
        client,
        auth_headers,
        2,
        [
            logged(bench_press_id, is_warmup=True),
            logged(bench_press_id, reps=0),
            logged(squat_id),
            logged(bench_press_id, weight_kg=0, rir=0),
            logged(bench_press_id, rir=None),
        ],
    )
    await client.post(f"/workouts/{expected['id']}/finish", headers=auth_headers)
    current = await create(client, auth_headers, 3, [logged(bench_press_id)])
    result = await previous(client, auth_headers, current["id"], bench_press_id)
    assert result["workout_id"] == expected["id"]
    assert result["finished_automatically"] is False
    assert [s["set_number"] for s in result["sets"]] == [3, 4]
    assert [s["rir"] for s in result["sets"]] == [0, None]
    assert result["sets"][0]["weight_kg"] == "0.00"


async def test_skips_empty_warmup_zero_rep_and_other_exercise_sessions(
    client: AsyncClient,
    auth_headers: dict[str, str],
    bench_press_id: str,
    squat_id: str,
) -> None:
    expected = await create(client, auth_headers, 1, [logged(bench_press_id)])
    for day, sets in enumerate(
        [
            [],
            [logged(bench_press_id, is_warmup=True)],
            [logged(bench_press_id, reps=0)],
            [logged(squat_id)],
        ],
        2,
    ):
        await create(client, auth_headers, day, sets)
    current = await create(client, auth_headers, 6)
    result = await previous(client, auth_headers, current["id"], bench_press_id)
    assert result["workout_id"] == expected["id"]
    assert result["finished_automatically"] is True


async def test_old_workout_excludes_future_equal_and_open_sessions(
    client: AsyncClient,
    auth_headers: dict[str, str],
    bench_press_id: str,
    db: AsyncSession,
) -> None:
    expected = await create(client, auth_headers, 1, [logged(bench_press_id)])
    earlier_open = await create(client, auth_headers, 2, [logged(bench_press_id)])
    current = await create(client, auth_headers, 3, [logged(bench_press_id)])
    await create(client, auth_headers, 3, [logged(bench_press_id)])
    await create(client, auth_headers, 4, [logged(bench_press_id)])
    row = await db.get(Workout, UUID(earlier_open["id"]))
    assert row is not None
    row.finished_at = None
    row.finished_automatically = None
    await db.commit()
    result = await previous(client, auth_headers, current["id"], bench_press_id)
    assert result["workout_id"] == expected["id"]


async def test_returns_null_without_previous_eligible_records(
    client: AsyncClient,
    auth_headers: dict[str, str],
    bench_press_id: str,
) -> None:
    current = await create(client, auth_headers, 1, [logged(bench_press_id)])
    assert await previous(client, auth_headers, current["id"], bench_press_id) is None


async def test_never_reads_another_accounts_records_or_reference_workout(
    client: AsyncClient,
    auth_headers: dict[str, str],
    bench_press_id: str,
    register_payload: dict[str, str],
) -> None:
    response = await client.post(
        "/auth/register",
        json={
            **register_payload,
            "email": "other@example.com",
            "username": "other",
        },
    )
    other = {"Authorization": f"Bearer {response.json()['tokens']['access_token']}"}
    hidden = await create(client, other, 1, [logged(bench_press_id)])
    await client.post(f"/workouts/{hidden['id']}/finish", headers=other)
    current = await create(client, auth_headers, 2)
    assert await previous(client, auth_headers, current["id"], bench_press_id) is None
    for reference in [hidden["id"], str(uuid4())]:
        denied = await client.get(
            f"/workouts/{reference}/exercises/{bench_press_id}/previous",
            headers=auth_headers,
        )
        assert denied.status_code == 404
    unauthenticated = await client.get(
        f"/workouts/{current['id']}/exercises/{bench_press_id}/previous",
    )
    assert unauthenticated.status_code == 401


async def test_unknown_exercise_is_404(
    client: AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    current = await create(client, auth_headers, 1)
    response = await client.get(
        f"/workouts/{current['id']}/exercises/{uuid4()}/previous",
        headers=auth_headers,
    )
    assert response.status_code == 404


@pytest.mark.parametrize("closure", [True, None])
async def test_preserves_automatic_and_legacy_closure_metadata(
    client: AsyncClient,
    auth_headers: dict[str, str],
    bench_press_id: str,
    db: AsyncSession,
    closure: bool | None,
) -> None:
    old = await create(client, auth_headers, 1, [logged(bench_press_id)])
    current = await create(client, auth_headers, 2)
    row = await db.get(Workout, UUID(old["id"]))
    assert row is not None
    row.finished_automatically = closure
    await db.commit()
    result = await previous(client, auth_headers, current["id"], bench_press_id)
    assert result["finished_automatically"] is closure


async def test_lookup_reaches_beyond_the_first_history_page_and_reflects_corrections(
    client: AsyncClient,
    auth_headers: dict[str, str],
    bench_press_id: str,
) -> None:
    old = await create(client, auth_headers, 1, [logged(bench_press_id)])
    for day in range(2, 24):
        await create(client, auth_headers, day)
    current = await create(client, auth_headers, 24)
    result = await previous(client, auth_headers, current["id"], bench_press_id)
    assert result["workout_id"] == old["id"]
    response = await client.patch(
        f"/workouts/{old['id']}/sets/{old['sets'][0]['id']}",
        headers=auth_headers,
        json={"rir": 0, "reps": 9},
    )
    assert response.status_code == 200
    result = await previous(client, auth_headers, current["id"], bench_press_id)
    assert result["sets"][0]["rir"] == 0
    assert result["sets"][0]["reps"] == 9
    await client.delete(f"/workouts/{old['id']}", headers=auth_headers)
    assert await previous(client, auth_headers, current["id"], bench_press_id) is None
