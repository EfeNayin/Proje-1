"""Cursor history: privacy, stable boundaries, filtering and fresh records."""

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
    exercise: str,
    **values: Any,
) -> dict[str, Any]:
    response = await client.post(
        "/workouts",
        headers=headers,
        json={
            "title": f"Session {day}",
            "performed_at": f"2026-08-{day:02d}T12:00:00Z",
            "sets": [{"exercise_id": exercise, "weight_kg": 20, "reps": 8, **values}],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()  # type: ignore[no-any-return]


def url(workout: str, exercise: str) -> str:
    return f"/workouts/{workout}/exercises/{exercise}/history"


async def test_all_pages_reach_beyond_twenty_sessions_without_duplicates(
    client: AsyncClient,
    auth_headers: dict[str, str],
    bench_press_id: str,
) -> None:
    workouts = [await create(client, auth_headers, day, bench_press_id) for day in range(1, 27)]
    endpoint = url(workouts[-1]["id"], bench_press_id)
    ids: list[str] = []
    params: dict[str, str | int] = {"limit": 10}
    sizes = []
    while True:
        response = await client.get(endpoint, headers=auth_headers, params=params)
        assert response.status_code == 200, response.text
        page = response.json()
        sizes.append(len(page["items"]))
        ids.extend(item["workout_id"] for item in page["items"])
        if page["next_cursor"] is None:
            break
        params["cursor"] = page["next_cursor"]
    assert sizes == [10, 10, 5]
    assert ids == [workout["id"] for workout in reversed(workouts[:-1])]
    assert len(set(ids)) == 25


async def test_tied_dates_and_deleted_cursor_record_do_not_skip_remaining_sessions(
    client: AsyncClient,
    auth_headers: dict[str, str],
    bench_press_id: str,
) -> None:
    old = [await create(client, auth_headers, 1, bench_press_id) for _ in range(3)]
    current = await create(client, auth_headers, 2, bench_press_id)
    endpoint = url(current["id"], bench_press_id)
    first = await client.get(endpoint, headers=auth_headers, params={"limit": 1})
    page = first.json()
    ordered = sorted((workout["id"] for workout in old), reverse=True)
    assert page["items"][0]["workout_id"] == ordered[0]
    await client.delete(f"/workouts/{ordered[0]}", headers=auth_headers)
    # A new record ahead of the cursor must not shift older page boundaries.
    await create(client, auth_headers, 1, bench_press_id)
    second = await client.get(
        endpoint,
        headers=auth_headers,
        params={
            "cursor": page["next_cursor"],
            "limit": 50,
        },
    )
    ids = [item["workout_id"] for item in second.json()["items"]]
    assert all(item in ids for item in ordered[1:])
    assert ordered[0] not in ids
    assert ids == sorted(ids, reverse=True)
    assert second.json()["next_cursor"] is None


async def test_scope_excludes_other_exercises_warmups_zero_reps_equal_future_and_open(
    client: AsyncClient,
    auth_headers: dict[str, str],
    bench_press_id: str,
    squat_id: str,
    db: AsyncSession,
) -> None:
    old = await create(client, auth_headers, 1, bench_press_id, weight_kg=0, rir=0)
    response = await client.post(
        f"/workouts/{old['id']}/sets",
        headers=auth_headers,
        json={"exercise_id": bench_press_id, "weight_kg": 20, "reps": 9, "rir": None},
    )
    assert response.status_code == 201
    await create(client, auth_headers, 2, bench_press_id, is_warmup=True)
    await create(client, auth_headers, 3, bench_press_id, reps=0)
    await create(client, auth_headers, 4, squat_id)
    open_session = await create(client, auth_headers, 5, bench_press_id)
    current = await create(client, auth_headers, 6, bench_press_id)
    await create(client, auth_headers, 6, bench_press_id)
    await create(client, auth_headers, 7, bench_press_id)
    row = await db.get(Workout, UUID(open_session["id"]))
    assert row is not None
    row.finished_at = None
    await db.commit()
    response = await client.get(url(current["id"], bench_press_id), headers=auth_headers)
    items = response.json()["items"]
    assert [item["workout_id"] for item in items] == [old["id"]]
    assert [s["rir"] for s in items[0]["sets"]] == [0, None]
    assert items[0]["sets"][0]["weight_kg"] == "0.00"
    assert [s["set_number"] for s in items[0]["sets"]] == [1, 2]
    assert items[0]["finished_automatically"] is True
    assert response.json()["next_cursor"] is None


async def test_ownership_authentication_and_cursor_never_grant_access(
    client: AsyncClient,
    auth_headers: dict[str, str],
    other_auth_headers: dict[str, str],
    bench_press_id: str,
) -> None:
    secret = await create(client, other_auth_headers, 1, bench_press_id)
    await create(client, other_auth_headers, 2, bench_press_id)
    other_current = await create(client, other_auth_headers, 3, bench_press_id)
    other_page = await client.get(
        url(other_current["id"], bench_press_id), headers=other_auth_headers, params={"limit": 1}
    )
    current = await create(client, auth_headers, 4, bench_press_id)
    endpoint = url(current["id"], bench_press_id)
    for params in [{}, {"cursor": other_page.json()["next_cursor"]}]:
        response = await client.get(endpoint, headers=auth_headers, params=params)
        assert response.status_code == 200
        assert response.json() == {"items": [], "next_cursor": None}
    for reference in [secret["id"], str(uuid4())]:
        assert (
            await client.get(url(reference, bench_press_id), headers=auth_headers)
        ).status_code == 404
    assert (await client.get(endpoint)).status_code == 401
    assert (
        await client.get(url(current["id"], str(uuid4())), headers=auth_headers)
    ).status_code == 404


@pytest.mark.parametrize(
    "params",
    [
        {"limit": 0},
        {"limit": 51},
        {"cursor": "garbage"},
        {"cursor": "e30="},
        {"cursor": ""},
        {"cursor": "a" * 513},
    ],
)
async def test_invalid_pagination_is_rejected(
    client: AsyncClient,
    auth_headers: dict[str, str],
    bench_press_id: str,
    params: dict[str, Any],
) -> None:
    current = await create(client, auth_headers, 1, bench_press_id)
    response = await client.get(
        url(current["id"], bench_press_id), headers=auth_headers, params=params
    )
    assert response.status_code == 422, response.text


async def test_refresh_reflects_set_edits_deletions_and_legacy_closure(
    client: AsyncClient,
    auth_headers: dict[str, str],
    bench_press_id: str,
    db: AsyncSession,
) -> None:
    old = await create(client, auth_headers, 1, bench_press_id)
    current = await create(client, auth_headers, 2, bench_press_id)
    row = await db.get(Workout, UUID(old["id"]))
    assert row is not None
    row.finished_automatically = None
    await db.commit()
    response = await client.patch(
        f"/workouts/{old['id']}/sets/{old['sets'][0]['id']}",
        headers=auth_headers,
        json={"rir": 0, "weight_kg": 22.5},
    )
    assert response.status_code == 200
    endpoint = url(current["id"], bench_press_id)
    page = (await client.get(endpoint, headers=auth_headers)).json()
    assert page["items"][0]["finished_automatically"] is None
    assert page["items"][0]["sets"][0]["weight_kg"] == "22.50"
    assert page["items"][0]["sets"][0]["rir"] == 0
    await client.delete(f"/workouts/{old['id']}/sets/{old['sets'][0]['id']}", headers=auth_headers)
    assert (await client.get(endpoint, headers=auth_headers)).json() == {
        "items": [],
        "next_cursor": None,
    }
