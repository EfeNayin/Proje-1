"""The example-program library: browsing, and copying one into the user's programs.

Real PostgreSQL, real catalogue, real concurrent transactions. What is pinned here:

- the content itself (levels, frequencies, the A/B, Upper/Lower and PPL structure,
  set counts, sources) and that every exercise resolves to the real system catalogue;
- browsing writes nothing;
- a copy is complete, independent and INACTIVE (the active program is preserved);
- double taps, lost responses and concurrent requests make one program;
- a failure anywhere rolls everything back, receipt included, so a retry can succeed;
- ownership: nobody sees or replays anybody else's copy.
"""

import asyncio
from dataclasses import replace
from typing import Any
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domains.coaching import offers
from app.domains.example_programs import catalogue
from app.models import (
    ExampleProgramCopyRequest,
    Exercise,
    Program,
    TemplateExercise,
    WorkoutTemplate,
)

Headers = dict[str, str]
ACCOUNT_DELETE_URL = "/users/me/delete-account"
BEGINNER = "beginner-full-body-ab"
INTERMEDIATE = "intermediate-upper-lower"
ADVANCED = "advanced-push-pull-legs"


def url(request_id: UUID) -> str:
    return f"/example-programs/requests/{request_id}"


def body(example_id: str = BEGINNER, version: int = 1) -> dict[str, Any]:
    return {"example_id": example_id, "version": version}


async def copy(
    client: AsyncClient, headers: Headers, example_id: str = BEGINNER, *,
    request_id: UUID | None = None, version: int = 1,
) -> Any:
    return await client.put(
        url(request_id or uuid4()), headers=headers, json=body(example_id, version)
    )


async def counts(db: AsyncSession) -> tuple[int, int, int, int]:
    async def n(model: Any) -> int:
        return int(await db.scalar(select(func.count()).select_from(model)) or 0)

    return (
        await n(Program), await n(WorkoutTemplate), await n(TemplateExercise),
        await n(ExampleProgramCopyRequest),
    )


# ── The content ──────────────────────────────────────────────────────────


class TestTheContent:
    def test_the_catalogue_is_well_formed(self) -> None:
        assert catalogue.validate_catalogue() == []

    def test_three_examples_with_their_level_and_frequency(self) -> None:
        shown = [(e.id, e.level, e.sessions_per_week) for e in catalogue.EXAMPLES]
        assert shown == [
            (BEGINNER, "Beginner", 3),
            (INTERMEDIATE, "Intermediate", 4),
            (ADVANCED, "Advanced", 6),
        ]

    def test_the_structures_are_the_requested_ones(self) -> None:
        beginner, intermediate, advanced = catalogue.EXAMPLES
        assert [d.name for d in beginner.days] == ["Full Body A", "Full Body B"]
        assert beginner.sequence == ("Full Body A", "Full Body B")  # alternating
        assert [d.name for d in intermediate.days] == [
            "Upper A", "Lower A", "Upper B", "Lower B",
        ]
        assert intermediate.sequence == ("Upper A", "Lower A", "Upper B", "Lower B")
        assert [d.name for d in advanced.days] == ["Push", "Pull", "Legs"]
        assert advanced.sequence == ("Push", "Pull", "Legs", "Push", "Pull", "Legs")

    def test_set_counts_follow_the_level(self) -> None:
        beginner, intermediate, advanced = catalogue.EXAMPLES
        assert {m.sets for d in beginner.days for m in d.moves} == {2}
        for example in (intermediate, advanced):
            assert {m.sets for d in example.days for m in d.moves} == {3}

    def test_every_move_has_a_rep_range_and_an_rir_target(self) -> None:
        for example in catalogue.EXAMPLES:
            for day in example.days:
                for move in day.moves:
                    assert 1 <= move.reps_min < move.reps_max <= 20, move
                    assert 0 <= move.rir <= 3, move

    def test_weekly_working_sets(self) -> None:
        assert [catalogue.weekly_working_sets(e) for e in catalogue.EXAMPLES] == [42, 78, 108]

    def test_both_primary_sources_are_linked_and_findings_are_separate_from_choices(self) -> None:
        for example in catalogue.EXAMPLES:
            urls = {s.url for s in example.sources}
            assert "https://pubmed.ncbi.nlm.nih.gov/41843416/" in urls or (
                "https://pubmed.ncbi.nlm.nih.gov/38595233/" in urls
            )
            assert example.authored, "authored choices are stated separately from findings"
        assert {s.url for e in catalogue.EXAMPLES for s in e.sources} == {
            "https://pubmed.ncbi.nlm.nih.gov/41843416/",
            "https://pubmed.ncbi.nlm.nih.gov/38595233/",
        }

    async def test_every_exercise_is_a_real_system_catalogue_exercise(
        self, db: AsyncSession
    ) -> None:
        from app.domains.example_programs import service

        for example in catalogue.EXAMPLES:
            frozen = await service.resolve(db, example)
            assert [t.name for t in frozen.templates] == [d.name for d in example.days]
            ids = {i.exercise_id for t in frozen.templates for i in t.exercises}
            found = set(
                (await db.scalars(
                    select(Exercise.id).where(Exercise.id.in_(ids), Exercise.created_by.is_(None))
                )).all()
            )
            assert found == ids


# ── Browsing ─────────────────────────────────────────────────────────────


class TestBrowsing:
    async def test_the_list_shows_level_and_frequency(
        self, client: AsyncClient, auth_headers: Headers
    ) -> None:
        response = await client.get("/example-programs", headers=auth_headers)
        assert response.status_code == 200
        listed = response.json()["examples"]
        assert [(e["level"], e["sessions_per_week"]) for e in listed] == [
            ("Beginner", 3), ("Intermediate", 4), ("Advanced", 6),
        ]
        assert [e["weekly_working_sets"] for e in listed] == [42, 78, 108]

    async def test_the_preview_has_ordered_days_targets_and_sources(
        self, client: AsyncClient, auth_headers: Headers
    ) -> None:
        response = await client.get(f"/example-programs/{INTERMEDIATE}", headers=auth_headers)
        assert response.status_code == 200
        detail = response.json()
        assert [d["name"] for d in detail["days"]] == ["Upper A", "Lower A", "Upper B", "Lower B"]
        first = detail["days"][0]["exercises"][0]
        assert first == {
            "exercise_name": "Barbell Bench Press", "exercise_order": 0, "target_sets": 3,
            "target_reps_min": 6, "target_reps_max": 10, "target_rir": 2, "notes": None,
        }
        assert [d["day_order"] for d in detail["days"]] == [0, 1, 2, 3]
        assert {s["url"] for s in detail["sources"]} == {
            "https://pubmed.ncbi.nlm.nih.gov/41843416/",
            "https://pubmed.ncbi.nlm.nih.gov/38595233/",
        }
        assert all(s["finding"] for s in detail["sources"]) and detail["authored"]

    async def test_browsing_creates_no_records(
        self, client: AsyncClient, auth_headers: Headers, db: AsyncSession
    ) -> None:
        before = await counts(db)
        await client.get("/example-programs", headers=auth_headers)
        for example in catalogue.EXAMPLES:
            assert (
                await client.get(f"/example-programs/{example.id}", headers=auth_headers)
            ).status_code == 200
        assert await counts(db) == before == (0, 0, 0, 0)

    async def test_an_unknown_example_is_404(
        self, client: AsyncClient, auth_headers: Headers
    ) -> None:
        response = await client.get("/example-programs/no-such-thing", headers=auth_headers)
        assert response.status_code == 404

    async def test_sign_in_is_required(self, client: AsyncClient) -> None:
        assert (await client.get("/example-programs")).status_code == 401
        assert (await copy(client, {})).status_code == 401


# ── Copying ──────────────────────────────────────────────────────────────


class TestCopying:
    async def test_the_copy_is_complete_and_matches_the_preview(
        self, client: AsyncClient, auth_headers: Headers
    ) -> None:
        for example in catalogue.EXAMPLES:
            preview = (
                await client.get(f"/example-programs/{example.id}", headers=auth_headers)
            ).json()
            response = await copy(client, auth_headers, example.id)
            assert response.status_code == 201, response.text
            program = response.json()
            assert program["name"] == example.name
            assert program["is_active"] is False
            assert example.schedule in program["notes"]
            assert [t["name"] for t in program["templates"]] == [d["name"] for d in preview["days"]]
            for template, day in zip(program["templates"], preview["days"], strict=True):
                got = [
                    (e["exercise_name"], e["target_sets"], e["target_reps_min"],
                     e["target_reps_max"], e["target_rir"], e["notes"])
                    for e in template["exercises"]
                ]
                want = [
                    (e["exercise_name"], e["target_sets"], e["target_reps_min"],
                     e["target_reps_max"], e["target_rir"], e["notes"])
                    for e in day["exercises"]
                ]
                assert got == want
                assert [e["exercise_order"] for e in template["exercises"]] == list(
                    range(len(want))
                )

    async def test_the_copy_is_listed_and_opens_in_the_existing_program_detail(
        self, client: AsyncClient, auth_headers: Headers
    ) -> None:
        program = (await copy(client, auth_headers)).json()
        listed = (await client.get("/programs", headers=auth_headers)).json()
        assert [(p["id"], p["is_active"]) for p in listed] == [(program["id"], False)]
        detail = await client.get(f"/programs/{program['id']}", headers=auth_headers)
        assert detail.status_code == 200 and detail.json() == program

    async def test_importing_preserves_the_active_program_and_activation_stays_explicit(
        self, client: AsyncClient, auth_headers: Headers
    ) -> None:
        mine = (
            await client.post("/programs", headers=auth_headers, json={"name": "My own"})
        ).json()
        assert mine["is_active"] is True

        copied = (await copy(client, auth_headers, INTERMEDIATE)).json()
        assert copied["is_active"] is False
        listed = {p["name"]: p["is_active"] for p in (
            await client.get("/programs", headers=auth_headers)).json()}
        assert listed == {"My own": True, "Upper/Lower": False}

        activated = await client.post(f"/programs/{copied['id']}/activate", headers=auth_headers)
        assert activated.status_code == 200 and activated.json()["is_active"] is True
        listed = {p["name"]: p["is_active"] for p in (
            await client.get("/programs", headers=auth_headers)).json()}
        assert listed == {"My own": False, "Upper/Lower": True}

    async def test_with_no_active_program_the_copy_still_starts_inactive(
        self, client: AsyncClient, auth_headers: Headers
    ) -> None:
        copied = (await copy(client, auth_headers)).json()
        assert copied["is_active"] is False
        listed = (await client.get("/programs", headers=auth_headers)).json()
        assert [p["is_active"] for p in listed] == [False]

    async def test_a_template_of_the_copy_starts_a_workout_with_its_targets(
        self, client: AsyncClient, auth_headers: Headers
    ) -> None:
        program = (await copy(client, auth_headers, ADVANCED)).json()
        push = program["templates"][0]
        started = await client.post(f"/templates/{push['id']}/start", headers=auth_headers)
        assert started.status_code == 201, started.text
        targets = started.json()["targets"]
        assert [t["exercise_name"] for t in targets][:3] == [
            "Barbell Bench Press", "Incline Dumbbell Bench Press", "Seated Dumbbell Shoulder Press",
        ]
        assert targets[0]["target_sets"] == 3
        assert (targets[0]["target_reps_min"], targets[0]["target_reps_max"]) == (6, 10)
        assert targets[0]["target_rir"] == 2
        workout = (
            await client.get(f"/workouts/{started.json()['workout_id']}", headers=auth_headers)
        ).json()
        assert workout["template_snapshot"]["exercises"][0]["target_sets"] == 3

    async def test_copies_are_independent_of_each_other_and_of_the_example(
        self, client: AsyncClient, auth_headers: Headers
    ) -> None:
        first = (await copy(client, auth_headers, INTERMEDIATE)).json()
        second = (await copy(client, auth_headers, INTERMEDIATE)).json()
        assert first["id"] != second["id"]
        assert {t["id"] for t in first["templates"]}.isdisjoint(
            {t["id"] for t in second["templates"]}
        )

        # Edit the first thoroughly: rename it and a day, replace a day's exercises, delete one.
        assert (await client.patch(
            f"/programs/{first['id']}", headers=auth_headers, json={"name": "Mine now"}
        )).status_code == 200
        day = first["templates"][0]
        assert (await client.patch(
            f"/templates/{day['id']}", headers=auth_headers, json={"name": "Heavy"}
        )).status_code == 200
        one = day["exercises"][0]
        assert (await client.put(
            f"/templates/{day['id']}/exercises", headers=auth_headers,
            json={"exercises": [{"exercise_id": one["exercise_id"], "target_sets": 5}]},
        )).status_code == 200
        assert (await client.delete(
            f"/templates/{first['templates'][1]['id']}", headers=auth_headers
        )).status_code == 204

        untouched = (await client.get(f"/programs/{second['id']}", headers=auth_headers)).json()
        assert untouched == second
        preview = (
            await client.get(f"/example-programs/{INTERMEDIATE}", headers=auth_headers)
        ).json()
        assert [d["name"] for d in preview["days"]] == ["Upper A", "Lower A", "Upper B", "Lower B"]
        assert len(preview["days"][0]["exercises"]) == 7

    async def test_deleting_a_copy_does_not_touch_the_others(
        self, client: AsyncClient, auth_headers: Headers
    ) -> None:
        first = (await copy(client, auth_headers)).json()
        second = (await copy(client, auth_headers)).json()
        assert (
            await client.delete(f"/programs/{first['id']}", headers=auth_headers)
        ).status_code == 204
        still = await client.get(f"/programs/{second['id']}", headers=auth_headers)
        assert still.json() == second


# ── Retries, duplicates, concurrency ─────────────────────────────────────


class TestRetries:
    async def test_a_lost_response_retry_returns_the_original_and_makes_no_second_program(
        self, client: AsyncClient, auth_headers: Headers, db: AsyncSession
    ) -> None:
        request_id = uuid4()
        first = await copy(client, auth_headers, request_id=request_id)
        assert first.status_code == 201
        # The user edits the copy after the response was lost; the retry must still resolve to it.
        await client.patch(
            f"/programs/{first.json()['id']}", headers=auth_headers, json={"name": "Renamed"}
        )
        again = await copy(client, auth_headers, request_id=request_id)
        assert again.status_code == 201
        assert again.json()["id"] == first.json()["id"]
        assert again.json()["name"] == "Renamed"
        programs, templates, exercises, receipts = await counts(db)
        assert (programs, templates, receipts) == (1, 2, 1)
        assert exercises == 14

    async def test_a_double_tap_makes_one_program(
        self, client: AsyncClient, auth_headers: Headers, db: AsyncSession
    ) -> None:
        request_id = uuid4()
        first = await copy(client, auth_headers, request_id=request_id)
        second = await copy(client, auth_headers, request_id=request_id)
        assert first.json()["id"] == second.json()["id"]
        assert (await counts(db))[0] == 1

    async def test_concurrent_requests_with_one_id_make_one_program(
        self, client: AsyncClient, auth_headers: Headers, db: AsyncSession
    ) -> None:
        request_id = uuid4()
        responses = await asyncio.gather(*[
            copy(client, auth_headers, INTERMEDIATE, request_id=request_id) for _ in range(6)
        ])
        assert [r.status_code for r in responses] == [201] * 6
        assert {r.json()["id"] for r in responses} == {responses[0].json()["id"]}
        programs, templates, exercises, receipts = await counts(db)
        assert (programs, templates, receipts) == (1, 4, 1)
        assert exercises == 7 + 5 + 8 + 6

    async def test_concurrent_requests_with_different_ids_make_separate_copies(
        self, client: AsyncClient, auth_headers: Headers, db: AsyncSession
    ) -> None:
        responses = await asyncio.gather(*[copy(client, auth_headers) for _ in range(4)])
        assert [r.status_code for r in responses] == [201] * 4
        assert len({r.json()["id"] for r in responses}) == 4
        assert (await counts(db))[0] == 4

    async def test_an_id_reused_for_another_example_or_version_is_refused(
        self, client: AsyncClient, auth_headers: Headers, db: AsyncSession
    ) -> None:
        request_id = uuid4()
        first = await copy(client, auth_headers, BEGINNER, request_id=request_id)
        assert first.status_code == 201
        other = await copy(client, auth_headers, ADVANCED, request_id=request_id)
        assert other.status_code == 409
        assert other.json()["code"] == "example_request_mismatch"
        newer = await copy(client, auth_headers, BEGINNER, request_id=request_id, version=2)
        assert newer.status_code == 409 and newer.json()["code"] == "example_request_mismatch"
        assert (await counts(db))[0] == 1

    async def test_a_retry_still_replays_after_the_example_content_moves_on(
        self, client: AsyncClient, auth_headers: Headers, monkeypatch: pytest.MonkeyPatch,
        db: AsyncSession,
    ) -> None:
        request_id = uuid4()
        first = await copy(client, auth_headers, request_id=request_id)
        bumped = tuple(
            replace(e, version=2) if e.id == BEGINNER else e for e in catalogue.EXAMPLES
        )
        monkeypatch.setattr(catalogue, "EXAMPLES", bumped)
        again = await copy(client, auth_headers, request_id=request_id)  # still asks for version 1
        assert again.status_code == 201 and again.json()["id"] == first.json()["id"]
        assert (await counts(db))[0] == 1

    async def test_a_stale_version_is_refused_and_leaves_no_receipt(
        self, client: AsyncClient, auth_headers: Headers, monkeypatch: pytest.MonkeyPatch,
        db: AsyncSession,
    ) -> None:
        monkeypatch.setattr(catalogue, "EXAMPLES", tuple(
            replace(e, version=2) if e.id == BEGINNER else e for e in catalogue.EXAMPLES
        ))
        request_id = uuid4()
        stale = await copy(client, auth_headers, request_id=request_id, version=1)
        assert stale.status_code == 409 and stale.json()["code"] == "example_version_changed"
        assert await counts(db) == (0, 0, 0, 0)
        fresh = await copy(client, auth_headers, request_id=request_id, version=2)
        assert fresh.status_code == 201

    async def test_an_unknown_example_creates_nothing(
        self, client: AsyncClient, auth_headers: Headers, db: AsyncSession
    ) -> None:
        response = await copy(client, auth_headers, "no-such-thing")
        assert response.status_code == 404
        assert await counts(db) == (0, 0, 0, 0)

    async def test_a_retry_after_the_copy_was_deleted_does_not_bring_it_back(
        self, client: AsyncClient, auth_headers: Headers, db: AsyncSession
    ) -> None:
        request_id = uuid4()
        first = (await copy(client, auth_headers, request_id=request_id)).json()
        await client.delete(f"/programs/{first['id']}", headers=auth_headers)
        again = await copy(client, auth_headers, request_id=request_id)
        assert again.status_code == 409 and again.json()["code"] == "example_copy_deleted"
        assert (await counts(db))[0] == 0
        assert (await copy(client, auth_headers)).status_code == 201  # a new tap, a new id


# ── Ownership and accounts ───────────────────────────────────────────────


class TestOwnership:
    async def test_two_accounts_using_the_same_request_id_each_get_their_own_copy(
        self, client: AsyncClient, auth_headers: Headers, other_auth_headers: Headers,
        db: AsyncSession,
    ) -> None:
        request_id = uuid4()
        mine = (await copy(client, auth_headers, request_id=request_id)).json()
        theirs = (await copy(client, other_auth_headers, request_id=request_id)).json()
        assert mine["id"] != theirs["id"]
        assert (await counts(db))[0] == 2

    async def test_nobody_can_read_or_replay_another_accounts_copy(
        self, client: AsyncClient, auth_headers: Headers, other_auth_headers: Headers
    ) -> None:
        mine = (await copy(client, auth_headers)).json()
        assert (
            await client.get(f"/programs/{mine['id']}", headers=other_auth_headers)
        ).status_code == 404
        assert (await client.get("/programs", headers=other_auth_headers)).json() == []
        assert (
            await client.post(f"/programs/{mine['id']}/activate", headers=other_auth_headers)
        ).status_code == 404

    async def test_deleting_the_account_removes_its_receipts(
        self, client: AsyncClient, auth_headers: Headers, db: AsyncSession
    ) -> None:
        await copy(client, auth_headers)
        assert (await counts(db))[3] == 1
        response = await client.post(
            ACCOUNT_DELETE_URL, headers=auth_headers, json={"password": "supersecret123"}
        )
        assert response.status_code == 204, response.text
        assert await counts(db) == (0, 0, 0, 0)


# ── Failures: nothing half-done ──────────────────────────────────────────


def _with_example(monkeypatch: pytest.MonkeyPatch, **changes: Any) -> None:
    changed = tuple(
        replace(e, **changes) if e.id == BEGINNER else e for e in catalogue.EXAMPLES
    )
    monkeypatch.setattr(catalogue, "EXAMPLES", changed)


class TestFailuresLeaveNothingBehind:
    async def test_a_missing_exercise_refuses_the_whole_copy_and_names_it(
        self, client: AsyncClient, auth_headers: Headers, monkeypatch: pytest.MonkeyPatch,
        db: AsyncSession,
    ) -> None:
        original = catalogue.EXAMPLES[0]
        days = list(original.days)
        moves = list(days[1].moves)
        moves[-1] = replace(moves[-1], exercise="Imaginary Cable Thing")
        days[1] = replace(days[1], moves=tuple(moves))
        _with_example(monkeypatch, days=tuple(days))
        request_id = uuid4()

        response = await copy(client, auth_headers, request_id=request_id)

        assert response.status_code == 503
        assert response.json()["code"] == "example_unavailable"
        assert "Imaginary Cable Thing" in response.json()["detail"]
        assert "Nothing was added" in response.json()["detail"]
        assert await counts(db) == (0, 0, 0, 0)
        assert (
            await client.get(f"/example-programs/{BEGINNER}", headers=auth_headers)
        ).status_code == 503
        # The failed attempt did not use up the request id: once the content is fixed it works.
        monkeypatch.undo()
        assert (await copy(client, auth_headers, request_id=request_id)).status_code == 201

    async def test_an_exercise_listed_twice_in_the_catalogue_is_refused_not_guessed(
        self, client: AsyncClient, auth_headers: Headers, db: AsyncSession
    ) -> None:
        duplicate = Exercise(name="Goblet Squat", created_by=None)
        db.add(duplicate)
        await db.commit()
        try:
            response = await copy(client, auth_headers)
            assert response.status_code == 503
            assert "Goblet Squat" in response.json()["detail"]
            assert (await counts(db))[0] == 0
        finally:
            # System exercises survive the per-test cleanup, so remove only this one.
            await db.delete(duplicate)
            await db.commit()

    async def test_a_custom_exercise_with_the_same_name_is_never_used(
        self, client: AsyncClient, auth_headers: Headers, db: AsyncSession
    ) -> None:
        me = (await client.get("/users/me", headers=auth_headers)).json()["id"]
        custom = Exercise(name="Goblet Squat", created_by=me)
        db.add(custom)
        await db.commit()
        try:
            response = await copy(client, auth_headers)
            assert response.status_code == 201, response.text
            used = {
                e["exercise_id"] for t in response.json()["templates"] for e in t["exercises"]
            }
            assert str(custom.id) not in used
        finally:
            # Deleting the user would only null created_by and leave a stray "system" row.
            await db.delete(custom)
            await db.commit()

    async def test_an_invalid_target_refuses_the_copy(
        self, client: AsyncClient, auth_headers: Headers, monkeypatch: pytest.MonkeyPatch,
        db: AsyncSession,
    ) -> None:
        original = catalogue.EXAMPLES[0]
        days = list(original.days)
        moves = list(days[0].moves)
        moves[0] = replace(moves[0], reps_min=15, reps_max=8)
        days[0] = replace(days[0], moves=tuple(moves))
        _with_example(monkeypatch, days=tuple(days))
        response = await copy(client, auth_headers)
        assert response.status_code == 503 and response.json()["code"] == "example_unavailable"
        assert await counts(db) == (0, 0, 0, 0)

    async def test_a_failure_part_way_through_rolls_back_everything_including_the_receipt(
        self, client: AsyncClient, auth_headers: Headers, monkeypatch: pytest.MonkeyPatch,
        db: AsyncSession,
    ) -> None:
        # An active program must be exactly as it was after the failed attempt, too.
        mine = (
            await client.post("/programs", headers=auth_headers, json={"name": "My own"})
        ).json()
        real = offers._copy_template
        calls = 0

        def explode_on_second(db_: AsyncSession, program: Program, template: Any) -> Any:
            nonlocal calls
            calls += 1
            if calls == 2:
                raise RuntimeError("disk full")
            return real(db_, program, template)

        request_id = uuid4()
        monkeypatch.setattr(offers, "_copy_template", explode_on_second)
        with pytest.raises(RuntimeError):
            await copy(client, auth_headers, INTERMEDIATE, request_id=request_id)
        monkeypatch.undo()

        # Only "My own" exists; no half program, no days, no exercises, no receipt.
        assert await counts(db) == (1, 0, 0, 0)
        listed = (await client.get("/programs", headers=auth_headers)).json()
        assert [(p["id"], p["is_active"]) for p in listed] == [(mine["id"], True)]
        # The same request id can now succeed, once.
        again = await copy(client, auth_headers, INTERMEDIATE, request_id=request_id)
        assert again.status_code == 201
        assert (await counts(db))[0] == 2


class TestCoachingStillBuildsPrograms:
    """`materialize_program` is shared with coaching; its signature and behavior are unchanged."""

    async def test_materialize_program_is_still_the_coaching_entry_point(self) -> None:
        assert callable(offers.materialize_program)
        assert offers.materialize_program.__code__.co_varnames[:3] == (
            "db", "owner_id", "frozen",
        )


@pytest.mark.parametrize("example", catalogue.EXAMPLES, ids=lambda e: e.id)
async def test_the_preview_and_a_copy_agree_for_every_example(
    client: AsyncClient, auth_headers: Headers, example: catalogue.Example
) -> None:
    summary = next(
        e for e in (await client.get("/example-programs", headers=auth_headers)).json()["examples"]
        if e["id"] == example.id
    )
    program = (await copy(client, auth_headers, example.id)).json()
    assert summary["day_count"] == len(program["templates"])
    assert summary["exercise_count"] == sum(len(t["exercises"]) for t in program["templates"])
    sets = {t["name"]: sum(e["target_sets"] for e in t["exercises"]) for t in program["templates"]}
    cycle = sum(sets[name] for name in example.sequence)
    assert summary["weekly_working_sets"] == round(
        cycle * example.sessions_per_week / len(example.sequence)
    )
