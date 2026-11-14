"""Roster activity overview: what each consenting athlete has recorded lately.

A factual summary for the coach's "My Athletes" list, not an assessment. It
reuses the definitions the rest of the product already uses:

* completed workout: `finished_at IS NOT NULL`, as in the coach's workout list;
* working set: not a warm-up and `reps > 0`, as in weekly volume, the diagnosis
  and exercise history (zero-rep entries are placeholders, not work done).
  `workouts.total_sets` also counts zero-rep rows, so it can differ from this
  number for a session that contains one. A 0 kg set is a real set and counts.
* a set exists in `sets` only once its save was committed (the idempotency
  receipt is written in the same transaction), so unconfirmed sets are never
  counted and replaying a save cannot count one twice.

The window is rolling and half-open: `start <= performed_at < end`, with
`end` the request time (or the `as_of` a later page reuses) and
`start = end - 28 days`. `performed_at` decides inclusion, as in analytics. It
is an instant window rather than a calendar week so that it is identical for
every athlete in a response, whatever time zone they log in.

One count and one page statement serve a whole page of the roster. The
statement reads each link's `shares_workouts` and, in the same snapshot, the
aggregates, and those are only evaluated for links where it is true; a link
that is not sharing yields `activity = None` (unavailable, not zero) without
its owner's workouts being read at all.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import Select, case, func, select, true
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ValidationAppError
from app.domains.coaching import service
from app.domains.coaching.schemas import (
    ActivityWindow,
    AthleteActivity,
    AthleteOverviewItem,
    AthleteOverviewPage,
    LatestWorkout,
    PersonSummary,
)
from app.models import CoachAthleteLink, Set, User, Workout

WINDOW_DAYS = 28
# Later pages reuse the first page's window.end. It may not be arbitrary: it
# has to be a moment already passed and recent, so it cannot be used to read
# a historical period of an athlete's record.
AS_OF_MAX_AGE = timedelta(hours=24)


def resolve_window(as_of: datetime | None, now: datetime | None = None) -> ActivityWindow:
    now = now or datetime.now(UTC)
    if as_of is None:
        end = now
    else:
        if as_of.tzinfo is None:
            raise ValidationAppError("as_of must include a time zone.")
        end = as_of.astimezone(UTC)
        if end > now or now - end > AS_OF_MAX_AGE:
            raise ValidationAppError("as_of must be a recent moment that has already passed.")
    return ActivityWindow(start=end - timedelta(days=WINDOW_DAYS), end=end, days=WINDOW_DAYS)


def _page_statement(
    coach: User, window: ActivityWindow, limit: int, offset: int
) -> Select[tuple[CoachAthleteLink, User, int | None, int | None, str | None, datetime | None]]:
    mine = (
        Workout.user_id == CoachAthleteLink.athlete_id,
        # Re-checked inside every lateral so no aggregate is computed for a
        # link that is not sharing, whatever the outer query does.
        CoachAthleteLink.shares_workouts.is_(True),
        Workout.finished_at.is_not(None),
        Workout.performed_at < window.end,
    )
    counts = (
        select(
            func.count(func.distinct(Workout.id)).label("workouts"),
            func.count(Set.id)
            .filter(Set.is_warmup.is_(False), Set.reps > 0)
            .label("working_sets"),
        )
        .select_from(Workout)
        .outerjoin(Set, Set.workout_id == Workout.id)
        .where(*mine, Workout.performed_at >= window.start)
        .lateral("counts")
    )
    latest = (
        select(Workout.title.label("title"), Workout.performed_at.label("performed_at"))
        .where(*mine)
        .order_by(Workout.performed_at.desc(), Workout.id.desc())
        .limit(1)
        .lateral("latest")
    )
    shares = CoachAthleteLink.shares_workouts.is_(True)
    return (
        select(
            CoachAthleteLink,
            User,
            case((shares, counts.c.workouts)).label("workouts"),
            case((shares, counts.c.working_sets)).label("working_sets"),
            latest.c.title,
            latest.c.performed_at,
        )
        .join(User, User.id == CoachAthleteLink.athlete_id)
        .join(counts, true())
        .outerjoin(latest, true())
        .where(CoachAthleteLink.coach_id == coach.id, CoachAthleteLink.ended_at.is_(None))
        # Same order as the plain roster, so the two lists agree.
        .order_by(CoachAthleteLink.created_at.desc(), CoachAthleteLink.id)
        .limit(limit)
        .offset(offset)
    )


async def athlete_overview(
    db: AsyncSession, coach: User, limit: int, offset: int, as_of: datetime | None
) -> AthleteOverviewPage:
    service.require_coach(coach)
    window = resolve_window(as_of)
    total = await db.scalar(
        select(func.count())
        .select_from(CoachAthleteLink)
        .where(CoachAthleteLink.coach_id == coach.id, CoachAthleteLink.ended_at.is_(None))
    )
    rows = (await db.execute(_page_statement(coach, window, limit, offset))).all()

    items: list[AthleteOverviewItem] = []
    for link, athlete, workouts, working_sets, title, performed_at in rows:
        activity: AthleteActivity | None = None
        if link.shares_workouts:
            activity = AthleteActivity(
                latest_workout=(
                    None
                    if performed_at is None
                    else LatestWorkout(title=title, performed_at=performed_at)
                ),
                workouts_in_window=workouts or 0,
                working_sets_in_window=working_sets or 0,
            )
        items.append(
            AthleteOverviewItem(
                id=link.id,
                person=PersonSummary.model_validate(athlete),
                connected_at=link.created_at,
                shares_workouts=link.shares_workouts,
                activity=activity,
            )
        )
    return AthleteOverviewPage(
        items=items, total=total or 0, limit=limit, offset=offset, window=window
    )
