"""Tests for workout and set endpoints.

Two things get disproportionate attention here:

- Ownership, because a gap there leaks real user data and fails silently.
- The denormalised totals on `workouts`, because when they drift the detail
  screen still looks right and only the history list is wrong.
"""

from typing import Any

from httpx import AsyncClient


async def _create_workout(
    client: AsyncClient, headers: dict[str, str], **kwargs: Any
) -> dict[str, Any]:
    response = await client.post("/workouts", headers=headers, json=kwargs)
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


class TestCreateWorkout:
    async def test_creates_an_empty_session(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        body = await _create_workout(client, auth_headers, title="Push Day A")

        assert body["title"] == "Push Day A"
        assert body["sets"] == []
        assert body["total_sets"] == 0
        assert body["total_volume_kg"] == "0.00"

    async def test_defaults_to_private(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        body = await _create_workout(client, auth_headers)
        assert body["is_private"] is True

    async def test_accepts_sets_inline(
        self, client: AsyncClient, auth_headers: dict[str, str], bench_press_id: str
    ) -> None:
        """A client that logged a session offline syncs it in one request."""
        body = await _create_workout(
            client,
            auth_headers,
            title="Push Day A",
            sets=[
                {"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8},
                {"exercise_id": bench_press_id, "weight_kg": 100, "reps": 7},
            ],
        )

        assert len(body["sets"]) == 2
        assert body["total_sets"] == 2
        assert body["total_volume_kg"] == "1500.00"  # 100*8 + 100*7

    async def test_numbers_sets_per_exercise(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        bench_press_id: str,
        squat_id: str,
    ) -> None:
        """Numbering restarts for each exercise, matching how the UI labels
        them ("Bench set 1", "Squat set 1")."""
        body = await _create_workout(
            client,
            auth_headers,
            sets=[
                {"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8},
                {"exercise_id": squat_id, "weight_kg": 140, "reps": 5},
                {"exercise_id": bench_press_id, "weight_kg": 100, "reps": 7},
            ],
        )

        numbers = [(s["exercise_id"], s["set_number"]) for s in body["sets"]]
        assert numbers == [
            (bench_press_id, 1),
            (squat_id, 1),
            (bench_press_id, 2),
        ]

    async def test_rejects_unknown_exercise(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """The foreign key would also refuse this, but as a 500."""
        response = await client.post(
            "/workouts",
            headers=auth_headers,
            json={
                "sets": [
                    {
                        "exercise_id": "00000000-0000-0000-0000-000000000000",
                        "weight_kg": 100,
                        "reps": 8,
                    }
                ]
            },
        )
        assert response.status_code == 422

    async def test_rejects_negative_weight(
        self, client: AsyncClient, auth_headers: dict[str, str], bench_press_id: str
    ) -> None:
        response = await client.post(
            "/workouts",
            headers=auth_headers,
            json={"sets": [{"exercise_id": bench_press_id, "weight_kg": -5, "reps": 8}]},
        )
        assert response.status_code == 422

    async def test_rejects_rpe_out_of_range(
        self, client: AsyncClient, auth_headers: dict[str, str], bench_press_id: str
    ) -> None:
        response = await client.post(
            "/workouts",
            headers=auth_headers,
            json={
                "sets": [
                    {"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8, "rpe": 15}
                ]
            },
        )
        assert response.status_code == 422

    async def test_requires_authentication(self, client: AsyncClient) -> None:
        response = await client.post("/workouts", json={"title": "x"})
        assert response.status_code == 401


class TestTotals:
    async def test_warmups_are_excluded(
        self, client: AsyncClient, auth_headers: dict[str, str], bench_press_id: str
    ) -> None:
        """Counting warmups would inflate weekly volume and trigger bogus
        "over MRV" warnings."""
        body = await _create_workout(
            client,
            auth_headers,
            sets=[
                {
                    "exercise_id": bench_press_id,
                    "weight_kg": 60,
                    "reps": 12,
                    "is_warmup": True,
                },
                {"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8},
            ],
        )

        assert len(body["sets"]) == 2  # both stored
        assert body["total_sets"] == 1  # only the working set counts
        assert body["total_volume_kg"] == "800.00"

    async def test_totals_update_when_a_set_is_added(
        self, client: AsyncClient, auth_headers: dict[str, str], bench_press_id: str
    ) -> None:
        workout = await _create_workout(client, auth_headers)

        response = await client.post(
            f"/workouts/{workout['id']}/sets",
            headers=auth_headers,
            json={"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8},
        )

        assert response.status_code == 201, response.text
        assert response.json()["total_volume_kg"] == "800.00"
        assert response.json()["total_sets"] == 1

    async def test_totals_update_when_a_set_is_edited(
        self, client: AsyncClient, auth_headers: dict[str, str], bench_press_id: str
    ) -> None:
        workout = await _create_workout(
            client,
            auth_headers,
            sets=[{"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8}],
        )
        set_id = workout["sets"][0]["id"]

        response = await client.patch(
            f"/workouts/{workout['id']}/sets/{set_id}",
            headers=auth_headers,
            json={"reps": 10},
        )

        assert response.json()["total_volume_kg"] == "1000.00"

    async def test_totals_update_when_a_set_becomes_a_warmup(
        self, client: AsyncClient, auth_headers: dict[str, str], bench_press_id: str
    ) -> None:
        """Flipping the flag has to move volume, not just relabel the row."""
        workout = await _create_workout(
            client,
            auth_headers,
            sets=[{"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8}],
        )
        set_id = workout["sets"][0]["id"]

        response = await client.patch(
            f"/workouts/{workout['id']}/sets/{set_id}",
            headers=auth_headers,
            json={"is_warmup": True},
        )

        assert response.json()["total_volume_kg"] == "0.00"
        assert response.json()["total_sets"] == 0

    async def test_totals_update_when_a_set_is_deleted(
        self, client: AsyncClient, auth_headers: dict[str, str], bench_press_id: str
    ) -> None:
        workout = await _create_workout(
            client,
            auth_headers,
            sets=[
                {"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8},
                {"exercise_id": bench_press_id, "weight_kg": 100, "reps": 7},
            ],
        )
        set_id = workout["sets"][0]["id"]

        response = await client.delete(
            f"/workouts/{workout['id']}/sets/{set_id}", headers=auth_headers
        )

        assert response.json()["total_volume_kg"] == "700.00"
        assert response.json()["total_sets"] == 1

    async def test_list_and_detail_agree(
        self, client: AsyncClient, auth_headers: dict[str, str], bench_press_id: str
    ) -> None:
        """The list reads stored totals while the detail carries the sets; if
        they ever disagree the denormalised columns have drifted."""
        workout = await _create_workout(
            client,
            auth_headers,
            sets=[{"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8}],
        )

        listing = (await client.get("/workouts", headers=auth_headers)).json()
        summary = listing["items"][0]
        detail = (
            await client.get(f"/workouts/{workout['id']}", headers=auth_headers)
        ).json()

        assert summary["total_volume_kg"] == detail["total_volume_kg"]
        assert summary["total_sets"] == detail["total_sets"]
        working = [s for s in detail["sets"] if not s["is_warmup"]]
        assert summary["total_sets"] == len(working)


class TestSetNumbering:
    async def test_deleting_a_middle_set_closes_the_gap(
        self, client: AsyncClient, auth_headers: dict[str, str], bench_press_id: str
    ) -> None:
        """The UI labels sets by this number, so 1-3 with 2 missing looks broken."""
        workout = await _create_workout(
            client,
            auth_headers,
            sets=[
                {"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8},
                {"exercise_id": bench_press_id, "weight_kg": 100, "reps": 7},
                {"exercise_id": bench_press_id, "weight_kg": 100, "reps": 6},
            ],
        )
        middle = workout["sets"][1]["id"]

        body = (
            await client.delete(
                f"/workouts/{workout['id']}/sets/{middle}", headers=auth_headers
            )
        ).json()

        assert [s["set_number"] for s in body["sets"]] == [1, 2]

    async def test_renumbering_leaves_other_exercises_alone(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        bench_press_id: str,
        squat_id: str,
    ) -> None:
        workout = await _create_workout(
            client,
            auth_headers,
            sets=[
                {"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8},
                {"exercise_id": bench_press_id, "weight_kg": 100, "reps": 7},
                {"exercise_id": squat_id, "weight_kg": 140, "reps": 5},
                {"exercise_id": squat_id, "weight_kg": 140, "reps": 5},
            ],
        )
        first_bench = workout["sets"][0]["id"]

        body = (
            await client.delete(
                f"/workouts/{workout['id']}/sets/{first_bench}", headers=auth_headers
            )
        ).json()

        squat_numbers = [
            s["set_number"] for s in body["sets"] if s["exercise_id"] == squat_id
        ]
        assert squat_numbers == [1, 2]

    async def test_added_set_continues_the_sequence(
        self, client: AsyncClient, auth_headers: dict[str, str], bench_press_id: str
    ) -> None:
        workout = await _create_workout(
            client,
            auth_headers,
            sets=[{"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8}],
        )

        body = (
            await client.post(
                f"/workouts/{workout['id']}/sets",
                headers=auth_headers,
                json={"exercise_id": bench_press_id, "weight_kg": 100, "reps": 7},
            )
        ).json()

        assert [s["set_number"] for s in body["sets"]] == [1, 2]


class TestOwnership:
    """One account must never reach another's sessions.

    All of these expect 404 rather than 403: replying "exists, but not yours"
    would confirm which ids are real.
    """

    async def test_list_only_shows_your_own(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        other_auth_headers: dict[str, str],
    ) -> None:
        await _create_workout(client, auth_headers, title="Mine")
        await _create_workout(client, other_auth_headers, title="Theirs")

        listing = (await client.get("/workouts", headers=auth_headers)).json()

        assert listing["total"] == 1
        assert listing["items"][0]["title"] == "Mine"

    async def test_cannot_read_another_users_workout(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        other_auth_headers: dict[str, str],
    ) -> None:
        workout = await _create_workout(client, auth_headers, title="Private")

        response = await client.get(
            f"/workouts/{workout['id']}", headers=other_auth_headers
        )

        assert response.status_code == 404

    async def test_cannot_edit_another_users_workout(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        other_auth_headers: dict[str, str],
    ) -> None:
        workout = await _create_workout(client, auth_headers, title="Private")

        response = await client.patch(
            f"/workouts/{workout['id']}", headers=other_auth_headers, json={"title": "Hacked"}
        )

        assert response.status_code == 404

    async def test_cannot_delete_another_users_workout(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        other_auth_headers: dict[str, str],
    ) -> None:
        workout = await _create_workout(client, auth_headers, title="Private")

        response = await client.delete(
            f"/workouts/{workout['id']}", headers=other_auth_headers
        )

        assert response.status_code == 404
        # And it is still there for its owner.
        assert (
            await client.get(f"/workouts/{workout['id']}", headers=auth_headers)
        ).status_code == 200

    async def test_cannot_add_a_set_to_another_users_workout(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        other_auth_headers: dict[str, str],
        bench_press_id: str,
    ) -> None:
        workout = await _create_workout(client, auth_headers)

        response = await client.post(
            f"/workouts/{workout['id']}/sets",
            headers=other_auth_headers,
            json={"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8},
        )

        assert response.status_code == 404

    async def test_cannot_edit_a_set_in_another_users_workout(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        other_auth_headers: dict[str, str],
        bench_press_id: str,
    ) -> None:
        """Set ids are sequential integers, so they are easy to guess; the
        check has to be on the workout, not the set id."""
        workout = await _create_workout(
            client,
            auth_headers,
            sets=[{"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8}],
        )
        set_id = workout["sets"][0]["id"]

        response = await client.patch(
            f"/workouts/{workout['id']}/sets/{set_id}",
            headers=other_auth_headers,
            json={"reps": 999},
        )

        assert response.status_code == 404

    async def test_cannot_reach_a_set_through_your_own_workout(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        other_auth_headers: dict[str, str],
        bench_press_id: str,
    ) -> None:
        """Owning *a* workout must not grant access to a set id belonging to
        someone else's."""
        victim = await _create_workout(
            client,
            auth_headers,
            sets=[{"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8}],
        )
        victim_set_id = victim["sets"][0]["id"]
        attacker = await _create_workout(client, other_auth_headers)

        response = await client.patch(
            f"/workouts/{attacker['id']}/sets/{victim_set_id}",
            headers=other_auth_headers,
            json={"reps": 999},
        )

        assert response.status_code == 404


class TestUpdateAndDelete:
    async def test_updates_only_the_fields_sent(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        workout = await _create_workout(
            client, auth_headers, title="Push Day A", notes="felt strong"
        )

        body = (
            await client.patch(
                f"/workouts/{workout['id']}",
                headers=auth_headers,
                json={"title": "Push Day B"},
            )
        ).json()

        assert body["title"] == "Push Day B"
        assert body["notes"] == "felt strong"

    async def test_delete_removes_the_workout(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        workout = await _create_workout(client, auth_headers)

        response = await client.delete(f"/workouts/{workout['id']}", headers=auth_headers)

        assert response.status_code == 204
        assert (
            await client.get(f"/workouts/{workout['id']}", headers=auth_headers)
        ).status_code == 404

    async def test_delete_cascades_to_sets(
        self, client: AsyncClient, auth_headers: dict[str, str], bench_press_id: str
    ) -> None:
        """Deleting a session must not leave orphaned sets behind, or they
        would keep counting toward volume analytics."""
        workout = await _create_workout(
            client,
            auth_headers,
            sets=[{"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8}],
        )

        await client.delete(f"/workouts/{workout['id']}", headers=auth_headers)

        listing = (await client.get("/workouts", headers=auth_headers)).json()
        assert listing["total"] == 0

    async def test_unknown_workout_returns_404(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.get(
            "/workouts/00000000-0000-0000-0000-000000000000", headers=auth_headers
        )
        assert response.status_code == 404

    async def test_unknown_set_returns_404(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        workout = await _create_workout(client, auth_headers)

        response = await client.delete(
            f"/workouts/{workout['id']}/sets/999999", headers=auth_headers
        )

        assert response.status_code == 404


class TestListing:
    async def test_orders_by_most_recent_first(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        await _create_workout(
            client, auth_headers, title="Older", performed_at="2026-08-01T10:00:00Z"
        )
        await _create_workout(
            client, auth_headers, title="Newer", performed_at="2026-08-15T10:00:00Z"
        )

        listing = (await client.get("/workouts", headers=auth_headers)).json()

        assert [w["title"] for w in listing["items"]] == ["Newer", "Older"]

    async def test_paginates(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        for index in range(5):
            await _create_workout(client, auth_headers, title=f"W{index}")

        page = (await client.get("/workouts?limit=2&offset=0", headers=auth_headers)).json()

        assert len(page["items"]) == 2
        assert page["total"] == 5

    async def test_requires_authentication(self, client: AsyncClient) -> None:
        response = await client.get("/workouts")
        assert response.status_code == 401


class TestFinish:
    async def test_finish_sets_finished_at(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        workout = await _create_workout(client, auth_headers)
        assert workout["finished_at"] is None

        response = await client.post(
            f"/workouts/{workout['id']}/finish", headers=auth_headers
        )

        assert response.status_code == 200, response.text
        assert response.json()["finished_at"] is not None

    async def test_finish_is_idempotent(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """A retried finish call must not move the end time forward."""
        workout = await _create_workout(client, auth_headers)

        first = await client.post(f"/workouts/{workout['id']}/finish", headers=auth_headers)
        second = await client.post(f"/workouts/{workout['id']}/finish", headers=auth_headers)

        assert first.status_code == 200
        assert second.status_code == 200
        assert first.json()["finished_at"] == second.json()["finished_at"]

    async def test_cannot_finish_another_users_workout(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        other_auth_headers: dict[str, str],
    ) -> None:
        workout = await _create_workout(client, auth_headers)

        response = await client.post(
            f"/workouts/{workout['id']}/finish", headers=other_auth_headers
        )

        assert response.status_code == 404


class TestActive:
    async def test_returns_the_unfinished_workout(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        workout = await _create_workout(client, auth_headers, title="In progress")

        response = await client.get("/workouts/active", headers=auth_headers)

        assert response.status_code == 200
        assert response.json()["id"] == workout["id"]

    async def test_returns_null_after_finishing(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        workout = await _create_workout(client, auth_headers)
        await client.post(f"/workouts/{workout['id']}/finish", headers=auth_headers)

        response = await client.get("/workouts/active", headers=auth_headers)

        assert response.status_code == 200
        assert response.json() is None

    async def test_returns_null_when_no_workouts_exist(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.get("/workouts/active", headers=auth_headers)

        assert response.status_code == 200
        assert response.json() is None

    async def test_only_sees_your_own(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        other_auth_headers: dict[str, str],
    ) -> None:
        await _create_workout(client, other_auth_headers, title="Theirs")

        response = await client.get("/workouts/active", headers=auth_headers)

        assert response.json() is None

    async def test_requires_authentication(self, client: AsyncClient) -> None:
        response = await client.get("/workouts/active")
        assert response.status_code == 401


class TestClosesDanglingWorkouts:
    """Starting a new session must not leave an old one open forever.

    The device-local active-workout id can be lost (reinstall, a second
    device), and nothing else ever closes a workout it can't point at — so
    starting fresh is the one moment the server can be sure the old one is
    over.
    """

    async def test_starting_a_workout_finishes_the_previous_one(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        forgotten = await _create_workout(client, auth_headers, title="Forgotten")

        await _create_workout(client, auth_headers, title="New session")

        response = await client.get(f"/workouts/{forgotten['id']}", headers=auth_headers)
        assert response.json()["finished_at"] is not None

    async def test_active_returns_only_the_new_workout(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        await _create_workout(client, auth_headers, title="Forgotten")
        new_session = await _create_workout(client, auth_headers, title="New session")

        response = await client.get("/workouts/active", headers=auth_headers)

        assert response.status_code == 200
        assert response.json()["id"] == new_session["id"]