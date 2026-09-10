"""Weekly training volume against hypertrophy landmarks.

The core feature. Two decisions shape everything here:

1. Weeks are cut in the user's own timezone. performed_at is stored in UTC,
   so a session at 01:00 Monday in Istanbul is 22:00 Sunday UTC and would
   land in the previous week if the boundary were computed in UTC.

2. Only *direct* sets count toward the landmarks. MEV/MAV/MRV as published by
   Renaissance Periodization refer to direct work for a muscle; the indirect
   stimulus from compound pressing and pulling is already folded into those
   numbers. Counting assistance work again would inflate every total and
   push users into false "over MRV" territory.
"""

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.domains.analytics.schemas import (
    DiagnosisQuery,
    DiagnosisResponse,
    Finding,
    MuscleWeeklyVolume,
    VolumeStatus,
    WeeklyVolume,
    WeeklyVolumeQuery,
    WeeklyVolumeResponse,
)
from app.models import (
    BodyMeasurement,
    ExerciseMuscleGroup,
    MuscleGroup,
    ReadinessLog,
    Set,
    User,
    Workout,
)

_PRIMARY = "primary"


def _has_working_set() -> ColumnElement[bool]:
    """Actual recorded work, independent of the finish button or cached totals.

    Zero external weight is valid (bodyweight exercises); zero repetitions
    and warmups do not establish a training session.
    """
    return (
        select(Set.id)
        .where(Set.workout_id == Workout.id, Set.is_warmup.is_(False), Set.reps > 0)
        .exists()
    )

# (direct_sets, involved_sets, avg_effectiveness, volume_kg) per (week, muscle).
_WeekMuscleAggregates = dict[date, dict[int, tuple[int, int, float | None, Decimal]]]


def _classify(direct_sets: int, mev: int | None, mav: int | None, mrv: int | None) -> VolumeStatus:
    """Place a week's direct set count against the landmarks.

    "untrained" is kept separate from "below_mev" because zero sets and a few
    sets need different nudges in the UI: one is "you skipped this muscle",
    the other is "you are close, add a couple".
    """
    if direct_sets == 0:
        return "untrained"
    if mev is None or mav is None or mrv is None:
        # No published landmark for this muscle; report the count without a
        # verdict rather than inventing one.
        return "optimal"
    if direct_sets < mev:
        return "below_mev"
    if direct_sets <= mav:
        return "optimal"
    if direct_sets <= mrv:
        return "high"
    return "above_mrv"


def _week_start_in(timezone: str, moment: datetime | None = None) -> date:
    """The Monday of the week containing `moment`, in the given timezone.

    date_trunc('week') in PostgreSQL is ISO 8601 and always starts on Monday,
    so this matches what the query produces.
    """
    zone = ZoneInfo(timezone)
    local = (moment or datetime.now(zone)).astimezone(zone)
    return (local - timedelta(days=local.weekday())).date()


async def _week_muscle_aggregates(
    db: AsyncSession, user: User, weeks: int
) -> tuple[date, _WeekMuscleAggregates]:
    """Direct/involved sets, avg effectiveness and tonnage per (week, muscle).

    Shared by weekly_volume() and diagnosis() so the "which sets count,
    which week do they land in" query — the one thing that must never drift
    out of sync between the two — lives in exactly one place.
    """
    current_week = _week_start_in(user.timezone)
    earliest_week = current_week - timedelta(weeks=weeks - 1)

    # AT TIME ZONE in function form: converts the stored UTC instant into the
    # user's wall clock, so date_trunc cuts the week where they experienced it.
    local_time = func.timezone(user.timezone, Workout.performed_at)
    week_start = func.date_trunc("week", local_time).cast(Set.created_at.type).label("week_start")

    is_direct = ExerciseMuscleGroup.role == _PRIMARY

    stmt = (
        select(
            week_start,
            ExerciseMuscleGroup.muscle_group_id,
            func.count().filter(is_direct).label("direct_sets"),
            func.count().label("involved_sets"),
            func.avg(ExerciseMuscleGroup.effectiveness)
            .filter(is_direct)
            .label("avg_effectiveness"),
            func.coalesce(
                func.sum(Set.weight_kg * Set.reps).filter(is_direct), 0
            ).label("volume_kg"),
        )
        .select_from(Set)
        .join(Workout, Workout.id == Set.workout_id)
        .join(ExerciseMuscleGroup, ExerciseMuscleGroup.exercise_id == Set.exercise_id)
        .where(
            Workout.user_id == user.id,
            # Warmups would inflate every count and trigger false "over MRV".
            Set.is_warmup.is_(False),
            Set.reps > 0,
            func.date_trunc("week", local_time) >= earliest_week,
        )
        .group_by(week_start, ExerciseMuscleGroup.muscle_group_id)
    )

    rows = (await db.execute(stmt)).all()

    # (week_start, muscle_group_id) -> aggregates
    by_week: _WeekMuscleAggregates = {}
    for row in rows:
        bucket = by_week.setdefault(row.week_start.date(), {})
        bucket[row.muscle_group_id] = (
            row.direct_sets,
            row.involved_sets,
            float(row.avg_effectiveness) if row.avg_effectiveness is not None else None,
            Decimal(row.volume_kg).quantize(Decimal("0.01")),
        )

    return current_week, by_week


async def weekly_volume(
    db: AsyncSession, user: User, query: WeeklyVolumeQuery
) -> WeeklyVolumeResponse:
    """Per-muscle volume for the last N weeks, newest first."""
    current_week, by_week = await _week_muscle_aggregates(db, user, query.weeks)

    muscle_groups = (
        await db.scalars(select(MuscleGroup).order_by(MuscleGroup.region, MuscleGroup.name))
    ).all()

    weeks: list[WeeklyVolume] = []
    for offset in range(query.weeks):
        start = current_week - timedelta(weeks=offset)
        found = by_week.get(start, {})

        muscles = []
        for group in muscle_groups:
            direct, involved, effectiveness, volume = found.get(
                group.id, (0, 0, None, Decimal("0.00"))
            )
            muscles.append(
                MuscleWeeklyVolume(
                    muscle_group_id=group.id,
                    name=group.name,
                    name_tr=group.name_tr,
                    region=group.region,
                    direct_sets=direct,
                    involved_sets=involved,
                    avg_effectiveness=round(effectiveness, 2)
                    if effectiveness is not None
                    else None,
                    volume_kg=volume,
                    mev=group.mev,
                    mav=group.mav,
                    mrv=group.mrv,
                    status=_classify(direct, group.mev, group.mav, group.mrv),
                )
            )

        weeks.append(WeeklyVolume(week_start=start, muscles=muscles))

    return WeeklyVolumeResponse(weeks=weeks, timezone=user.timezone)


# ── Diagnosis ────────────────────────────────────────────────────────────
#
# "Why am I not growing" combines three independent signals (volume,
# recovery, weight trend vs. goal) into a short, ranked list of findings.
# Raw thresholds alone produce noise, not insight: a real 4-week account
# tested here surfaced 7 "below MEV" muscles plus 14 "untrained" ones — 21
# lines nobody reads. Two rules keep it readable:
#
#  1. A muscle that was never touched is "muscles_untrained", not
#     "volume_below_mev" — zero sets and a few sets need different advice.
#  2. Untrained muscles are grouped by region (one finding per region, not
#     one per muscle), and both untrained-region findings and below/above
#     -landmark findings share a single combined budget of 3, picked by how
#     far off they are. The readiness/weight/consistency findings (at most
#     one each) are added on top of that, so "good news" findings are never
#     crowded out by a bad volume week — worst case 3 + 3 = 6, matching the
#     "5-6 bulgu" product rule.

_MIN_HISTORY_DAYS = 14
_UNDERTRAINED_WEEKLY_AVG = 2.0
_CONSISTENT_WEEKLY_AVG = 3.0
_LOW_SLEEP_HOURS = Decimal("7")
_VERY_LOW_SLEEP_HOURS = Decimal("6")
_MIN_READINESS_NIGHTS = 3
_MIN_WEIGHT_MEASUREMENTS = 2
_STALL_THRESHOLD_PCT = Decimal("0.5")
_VOLUME_FINDING_BUDGET = 3


def _today_in(timezone: str) -> date:
    """The user's current local calendar day. Mirrors readiness._today_in."""
    return datetime.now(ZoneInfo(timezone)).date()


@dataclass
class _Candidate:
    """A volume/region finding plus how critical it is, for ranking.

    score is a 0..1+ fraction of "how far outside the acceptable range" —
    comparable across below_mev, above_mrv and untrained-region findings
    even though they come from different queries.
    """

    score: float
    finding: Finding


async def _has_enough_data(db: AsyncSession, user: User) -> bool:
    """False for a brand-new account: one workout is not a trend.

    Anchored on the very first workout ever logged, not just ones inside the
    requested window, so switching from weeks=4 to weeks=12 cannot itself
    flip a fresh account into "enough data".
    """
    earliest = await db.scalar(
        select(func.min(Workout.performed_at)).where(
            Workout.user_id == user.id, _has_working_set()
        )
    )
    if earliest is None:
        return False
    return (datetime.now(UTC) - earliest) >= timedelta(days=_MIN_HISTORY_DAYS)


def _volume_candidates(
    muscle_groups: list[MuscleGroup],
    by_week: _WeekMuscleAggregates,
    current_week: date,
    weeks: int,
) -> list[_Candidate]:
    """below_mev / above_mrv / untrained-region candidates, unranked."""
    region_sizes = Counter(group.region for group in muscle_groups)
    untrained_by_region: dict[str, list[MuscleGroup]] = defaultdict(list)
    candidates: list[_Candidate] = []

    for group in muscle_groups:
        weekly_counts = [
            by_week.get(current_week - timedelta(weeks=offset), {}).get(
                group.id, (0, 0, None, Decimal("0"))
            )[0]
            for offset in range(weeks)
        ]
        total = sum(weekly_counts)

        if total == 0:
            untrained_by_region[group.region].append(group)
            continue

        avg_sets = total / weeks
        mev, mrv = group.mev, group.mrv
        if mev is not None and avg_sets < mev:
            weeks_below = sum(1 for count in weekly_counts if count < mev)
            candidates.append(
                _Candidate(
                    score=(mev - avg_sets) / mev,
                    finding=Finding(
                        code="volume_below_mev",
                        severity="warning",
                        data={
                            "muscle": group.name,
                            "muscle_tr": group.name_tr,
                            "avg_sets": round(avg_sets, 1),
                            "mev": mev,
                            "weeks_below": weeks_below,
                            "weeks_total": weeks,
                        },
                    ),
                )
            )
        elif mrv is not None and avg_sets > mrv:
            weeks_above = sum(1 for count in weekly_counts if count > mrv)
            candidates.append(
                _Candidate(
                    score=(avg_sets - mrv) / mrv,
                    finding=Finding(
                        code="volume_above_mrv",
                        severity="warning",
                        data={
                            "muscle": group.name,
                            "muscle_tr": group.name_tr,
                            "avg_sets": round(avg_sets, 1),
                            "mrv": mrv,
                            "weeks_above": weeks_above,
                            "weeks_total": weeks,
                        },
                    ),
                )
            )

    for region, untrained in untrained_by_region.items():
        candidates.append(
            _Candidate(
                score=len(untrained) / region_sizes[region],
                finding=Finding(
                    code="muscles_untrained",
                    severity="warning",
                    data={
                        "region": region,
                        "count": len(untrained),
                        "muscles": [group.name_tr for group in untrained],
                    },
                ),
            )
        )

    return candidates


async def _readiness_finding(db: AsyncSession, user: User, weeks: int) -> Finding | None:
    """Recovery signal: average sleep over the period, or a call-out that
    there is not enough check-in data to say anything at all."""
    window_start = _today_in(user.timezone) - timedelta(days=weeks * 7 - 1)

    raw_nights = (
        await db.scalars(
            select(ReadinessLog.sleep_hours).where(
                ReadinessLog.user_id == user.id,
                ReadinessLog.log_date >= window_start,
                ReadinessLog.sleep_hours.is_not(None),
            )
        )
    ).all()
    # The IS NOT NULL filter above already guarantees this, but the column's
    # static type is still Decimal | None — narrow it so sum() type-checks.
    nights = [hours for hours in raw_nights if hours is not None]

    if len(nights) < _MIN_READINESS_NIGHTS:
        return Finding(
            code="readiness_no_data",
            severity="info",
            data={"nights_total": len(nights)},
        )

    avg_hours = sum(nights, start=Decimal("0")) / len(nights)
    nights_under_7 = sum(1 for hours in nights if hours < _LOW_SLEEP_HOURS)
    sleep_data = {
        "avg_hours": float(round(avg_hours, 1)),
        "nights_under_7": nights_under_7,
        "nights_total": len(nights),
    }

    if avg_hours < _VERY_LOW_SLEEP_HOURS:
        return Finding(code="sleep_very_low", severity="critical", data=sleep_data)
    if avg_hours < _LOW_SLEEP_HOURS:
        return Finding(code="sleep_low", severity="warning", data=sleep_data)
    return None


async def _weight_finding(db: AsyncSession, user: User, weeks: int) -> Finding | None:
    """Weight trend vs. the user's stated goal — the only way to sanity-check
    "eating enough / eating too much" without a food log, which this product
    deliberately does not have."""
    goal = user.nutrition_goal
    if goal is None or goal == "maintain":
        # Nothing directional to check: maintain has no "wrong direction",
        # and without a goal we don't know which direction would be right.
        return None

    window_start = _today_in(user.timezone) - timedelta(days=weeks * 7 - 1)
    rows = (
        await db.scalars(
            select(BodyMeasurement)
            .where(
                BodyMeasurement.user_id == user.id,
                BodyMeasurement.measured_on >= window_start,
            )
            .order_by(BodyMeasurement.measured_on.asc())
        )
    ).all()

    if len(rows) < _MIN_WEIGHT_MEASUREMENTS:
        return Finding(
            code="weight_no_data",
            severity="info",
            data={"goal": goal, "weeks": weeks},
        )

    first, last = rows[0], rows[-1]
    change_kg = last.weight_kg - first.weight_kg
    change_pct = (change_kg / first.weight_kg) * 100
    weight_data = {
        "goal": goal,
        "change_kg": float(round(change_kg, 2)),
        "change_pct": float(round(change_pct, 2)),
        "weeks": weeks,
    }

    if goal == "bulk":
        if change_pct < _STALL_THRESHOLD_PCT:
            return Finding(code="weight_stalled_bulk", severity="warning", data=weight_data)
        return Finding(code="weight_on_track", severity="good", data=weight_data)

    # goal == "cut": the only branch left after the maintain/None guard above.
    if change_pct > -_STALL_THRESHOLD_PCT:
        return Finding(code="weight_stalled_cut", severity="warning", data=weight_data)
    return Finding(code="weight_on_track", severity="good", data=weight_data)


async def _consistency_finding(db: AsyncSession, user: User, weeks: int) -> Finding | None:
    """Sessions with actual work, including unfinished sessions, counted once."""
    current_week = _week_start_in(user.timezone)
    earliest_week = current_week - timedelta(weeks=weeks - 1)
    local_day = func.timezone(user.timezone, Workout.performed_at)

    count = await db.scalar(
        select(func.count())
        .select_from(Workout)
        .where(
            Workout.user_id == user.id,
            func.date_trunc("week", local_day) >= earliest_week,
            Workout.performed_at <= datetime.now(UTC),
            _has_working_set(),
        )
    )
    avg_per_week = (count or 0) / weeks
    consistency_data = {"avg_per_week": round(avg_per_week, 1), "weeks_total": weeks}

    if avg_per_week < _UNDERTRAINED_WEEKLY_AVG:
        return Finding(code="training_infrequent", severity="warning", data=consistency_data)
    if avg_per_week >= _CONSISTENT_WEEKLY_AVG:
        return Finding(code="training_consistent", severity="good", data=consistency_data)
    return None


async def diagnosis(db: AsyncSession, user: User, query: DiagnosisQuery) -> DiagnosisResponse:
    """The "why am I not growing" screen's endpoint. See the module comment
    above for the ranking and budget rules that keep this from turning into
    a wall of text."""
    if not await _has_enough_data(db, user):
        return DiagnosisResponse(period_weeks=query.weeks, has_enough_data=False, findings=[])

    muscle_groups_query = select(MuscleGroup).order_by(MuscleGroup.region, MuscleGroup.name)
    muscle_groups = list((await db.scalars(muscle_groups_query)).all())
    current_week, by_week = await _week_muscle_aggregates(db, user, query.weeks)

    candidates = _volume_candidates(muscle_groups, by_week, current_week, query.weeks)
    candidates.sort(key=lambda candidate: candidate.score, reverse=True)
    findings = [candidate.finding for candidate in candidates[:_VOLUME_FINDING_BUDGET]]

    for finding in (
        await _readiness_finding(db, user, query.weeks),
        await _weight_finding(db, user, query.weeks),
        await _consistency_finding(db, user, query.weeks),
    ):
        if finding is not None:
            findings.append(finding)

    return DiagnosisResponse(period_weeks=query.weeks, has_enough_data=True, findings=findings)
