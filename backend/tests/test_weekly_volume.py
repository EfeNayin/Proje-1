"""Regression tests for the week boundary used by volume analytics.

performed_at is stored as TIMESTAMPTZ, i.e. in UTC. Slicing weeks in UTC is
wrong for anyone not on UTC: in Istanbul (UTC+3) a session logged at 01:00 on
Monday is 22:00 Sunday UTC and lands in the previous week, while in New York
(UTC-5) an evening session can spill into the next one.

The fix is `AT TIME ZONE users.timezone` before date_trunc. These tests pin
that behaviour so nobody quietly drops it later — the failure mode is silent
and only shows up as slightly wrong MEV/MAV/MRV numbers.
"""

from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Exercise, Set, User, Workout

WEEK_BOUNDARIES_SQL = text("""
    SELECT
        date_trunc('week', w.performed_at)::date                         AS utc_week,
        date_trunc('week', w.performed_at AT TIME ZONE u.timezone)::date AS local_week
    FROM workouts w
    JOIN users u ON u.id = w.user_id
    WHERE w.id = :workout_id
""")


async def _log_workout(
    db: AsyncSession, username: str, performed_at: datetime
) -> Workout:
    """Log a single working set at the given moment."""
    user = await db.scalar(select(User).where(User.username == username))
    assert user is not None
    exercise = await db.scalar(select(Exercise).where(Exercise.name == "Barbell Bench Press"))
    assert exercise is not None

    workout = Workout(user_id=user.id, title="test session", performed_at=performed_at)
    db.add(workout)
    await db.flush()

    db.add(
        Set(
            workout_id=workout.id,
            exercise_id=exercise.id,
            set_number=1,
            weight_kg=Decimal("100"),
            reps=8,
        )
    )
    await db.commit()
    return workout


class TestWeekBoundary:
    async def test_early_monday_in_istanbul_stays_in_that_week(
        self, client: AsyncClient, db: AsyncSession, register_payload: dict[str, str]
    ) -> None:
        """01:00 Monday in Istanbul is 22:00 Sunday UTC. Computed in UTC it
        would be credited to the week before."""
        await client.post("/auth/register", json=register_payload)

        monday_night = datetime(2026, 8, 17, 1, 0, tzinfo=ZoneInfo("Europe/Istanbul"))
        workout = await _log_workout(db, "efe", monday_night)

        row = (await db.execute(WEEK_BOUNDARIES_SQL, {"workout_id": workout.id})).one()
        utc_week, local_week = row

        assert local_week.isoformat() == "2026-08-17"
        assert utc_week.isoformat() == "2026-08-10"
        assert local_week != utc_week, "expected the two methods to disagree here"

    async def test_late_sunday_in_new_york_stays_in_that_week(
        self, client: AsyncClient, db: AsyncSession, register_payload: dict[str, str]
    ) -> None:
        """The mirror case: 20:00 Sunday in New York is already Monday in UTC,
        so a UTC week would push the session forward instead of back."""
        await client.post(
            "/auth/register", json={**register_payload, "timezone": "America/New_York"}
        )

        sunday_evening = datetime(2026, 8, 16, 20, 0, tzinfo=ZoneInfo("America/New_York"))
        workout = await _log_workout(db, "efe", sunday_evening)

        row = (await db.execute(WEEK_BOUNDARIES_SQL, {"workout_id": workout.id})).one()
        utc_week, local_week = row

        assert local_week.isoformat() == "2026-08-10"
        assert utc_week.isoformat() == "2026-08-17"

    @pytest.mark.parametrize(
        ("timezone", "moment", "expected_week"),
        [
            ("Europe/Istanbul", datetime(2026, 8, 19, 18, 30), "2026-08-17"),
            ("Europe/Istanbul", datetime(2026, 8, 17, 0, 1), "2026-08-17"),
            ("Europe/Istanbul", datetime(2026, 8, 16, 23, 59), "2026-08-10"),
            ("America/New_York", datetime(2026, 8, 19, 18, 30), "2026-08-17"),
            ("Asia/Tokyo", datetime(2026, 8, 17, 6, 0), "2026-08-17"),
        ],
    )
    async def test_local_week_matches_the_users_calendar(
        self,
        client: AsyncClient,
        db: AsyncSession,
        register_payload: dict[str, str],
        timezone: str,
        moment: datetime,
        expected_week: str,
    ) -> None:
        """Whatever the zone, the week is the one the user would name."""
        await client.post("/auth/register", json={**register_payload, "timezone": timezone})

        workout = await _log_workout(db, "efe", moment.replace(tzinfo=ZoneInfo(timezone)))

        row = (await db.execute(WEEK_BOUNDARIES_SQL, {"workout_id": workout.id})).one()
        assert row.local_week.isoformat() == expected_week

    async def test_moving_abroad_reslices_past_sessions(
        self,
        client: AsyncClient,
        db: AsyncSession,
        auth_headers: dict[str, str],
        register_payload: dict[str, str],
    ) -> None:
        """Changing the timezone re-buckets history, which is intended: the
        week a session belongs to follows where the user is now."""
        monday_night = datetime(2026, 8, 17, 1, 0, tzinfo=ZoneInfo("Europe/Istanbul"))
        workout = await _log_workout(db, "efe", monday_night)

        before = (await db.execute(WEEK_BOUNDARIES_SQL, {"workout_id": workout.id})).one()
        assert before.local_week.isoformat() == "2026-08-17"

        # UTC-5: that same instant is still Sunday there.
        await client.patch(
            "/users/me", headers=auth_headers, json={"timezone": "America/New_York"}
        )

        after = (await db.execute(WEEK_BOUNDARIES_SQL, {"workout_id": workout.id})).one()
        assert after.local_week.isoformat() == "2026-08-10"


class TestDirectVolumeCounting:
    async def test_only_primary_muscles_count_as_direct_sets(
        self, client: AsyncClient, db: AsyncSession, register_payload: dict[str, str]
    ) -> None:
        """A bench set is 1 direct chest set and 0 direct triceps sets.

        MEV/MAV/MRV are published for direct work: the stimulus triceps get
        from pressing is already folded into their (lowered) landmarks, so
        counting it again would double-count.
        """
        await client.post("/auth/register", json=register_payload)
        await _log_workout(
            db, "efe", datetime(2026, 8, 19, 18, 0, tzinfo=ZoneInfo("Europe/Istanbul"))
        )

        rows = (
            await db.execute(
                text("""
                    SELECT mg.name,
                           count(*) FILTER (WHERE emg.role = 'primary') AS direct_sets,
                           count(*)                                     AS involved_sets
                    FROM sets s
                    JOIN exercise_muscle_groups emg ON emg.exercise_id = s.exercise_id
                    JOIN muscle_groups mg           ON mg.id = emg.muscle_group_id
                    JOIN workouts w                 ON w.id = s.workout_id
                    JOIN users u                    ON u.id = w.user_id
                    WHERE u.username = 'efe' AND s.is_warmup IS FALSE
                    GROUP BY mg.name
                """)
            )
        ).all()

        by_muscle = {row.name: (row.direct_sets, row.involved_sets) for row in rows}

        assert by_muscle["chest"] == (1, 1)
        assert by_muscle["triceps"] == (0, 1)
        assert by_muscle["front_delts"] == (0, 1)

    async def test_warmup_sets_are_excluded(
        self, client: AsyncClient, db: AsyncSession, register_payload: dict[str, str]
    ) -> None:
        """Warmups would otherwise inflate weekly volume and trigger bogus
        "you are over MRV" warnings."""
        await client.post("/auth/register", json=register_payload)
        user = await db.scalar(select(User).where(User.username == "efe"))
        exercise = await db.scalar(select(Exercise).where(Exercise.name == "Barbell Bench Press"))
        assert user is not None and exercise is not None

        workout = Workout(
            user_id=user.id,
            performed_at=datetime(2026, 8, 19, 18, 0, tzinfo=ZoneInfo("Europe/Istanbul")),
        )
        db.add(workout)
        await db.flush()
        db.add_all(
            [
                Set(
                    workout_id=workout.id,
                    exercise_id=exercise.id,
                    set_number=1,
                    weight_kg=Decimal("60"),
                    reps=12,
                    is_warmup=True,
                ),
                Set(
                    workout_id=workout.id,
                    exercise_id=exercise.id,
                    set_number=2,
                    weight_kg=Decimal("100"),
                    reps=8,
                ),
            ]
        )
        await db.commit()

        working_volume = await db.scalar(
            text("""
                SELECT SUM(s.weight_kg * s.reps)
                FROM sets s
                JOIN workouts w ON w.id = s.workout_id
                WHERE w.user_id = :user_id AND s.is_warmup IS FALSE
            """),
            {"user_id": user.id},
        )

        assert working_volume == Decimal("800.00")  # 100 x 8, warmup ignored