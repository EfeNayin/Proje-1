"""Request and response models for the coaching endpoints.

Only what the other party needs to recognise someone is exposed: username and
the name they chose to show. Never email or any training data.
"""

from datetime import datetime
from decimal import Decimal
from typing import Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator


class InviteCodeRequest(BaseModel):
    """The code travels in the body, never the URL, so it stays out of access logs."""

    code: str = Field(min_length=1, max_length=64)


class PersonSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    username: str
    first_name: str | None
    last_name: str | None


class InviteCreated(BaseModel):
    id: UUID
    # Shown once. Only its hash is stored, so it cannot be fetched again.
    code: str
    expires_at: datetime


class InvitePreview(BaseModel):
    coach: PersonSummary
    expires_at: datetime


class Connection(BaseModel):
    """An accepted link, described from the point of view of the caller.

    `person` is the athlete when a coach lists their athletes, and the coach
    when an athlete lists their coaches.
    """

    id: UUID
    person: PersonSummary
    connected_at: datetime
    # Whether the athlete lets the coach read their completed workouts. Both
    # sides see the state; only the athlete can change it.
    shares_workouts: bool


class ConnectionList(BaseModel):
    items: list[Connection]


class WorkoutSharingRequest(BaseModel):
    enabled: bool


class AthleteWorkoutSummary(BaseModel):
    """A completed session as the coach's list needs it. No notes, no volume."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str | None
    performed_at: datetime
    finished_at: datetime
    # False: the athlete pressed Finish, so finished_at - performed_at is a
    # real duration. True: closed when a later session started. None: unknown.
    finished_automatically: bool | None
    # Working sets; warm-ups are not counted (same meaning as the athlete's own list).
    total_sets: int


class AthleteWorkoutList(BaseModel):
    items: list[AthleteWorkoutSummary]
    total: int
    limit: int
    offset: int


class AthleteSet(BaseModel):
    set_number: int
    weight_kg: Decimal
    reps: int
    # None: not recorded. 0 is a real value (nothing left in reserve).
    rir: int | None
    is_warmup: bool


class AthleteExercise(BaseModel):
    exercise_id: UUID
    name: str
    sets: list[AthleteSet]


class AthleteWorkoutDetail(AthleteWorkoutSummary):
    exercises: list[AthleteExercise]


class AthleteExerciseSession(BaseModel):
    """One earlier completed session of an exercise: recorded working sets only."""

    workout_id: UUID
    title: str | None
    performed_at: datetime
    # Working sets of this exercise (never warm-ups, reps > 0), in set order.
    sets: list[AthleteSet]


class AthleteExerciseHistoryPage(BaseModel):
    items: list[AthleteExerciseSession]
    # Opaque; only valid for the connection, workout and exercise it came from.
    next_cursor: str | None


class AthleteExerciseHistoryCursor(BaseModel):
    """What a continuation token carries: the position and the context it was cut in."""

    performed_at: AwareDatetime
    session_id: UUID
    link_id: UUID
    anchor_workout_id: UUID
    exercise_id: UUID


# ── Workout feedback ─────────────────────────────────────────────────────

FEEDBACK_MAX_LENGTH = 2000


def _clean_feedback(value: str) -> str:
    """Plain text only: surrounding whitespace goes, blank is refused."""
    if "\x00" in value:
        raise ValueError("Feedback must be plain text.")
    cleaned = value.strip()
    if not cleaned:
        raise ValueError("Feedback cannot be blank.")
    return cleaned


class FeedbackCreate(BaseModel):
    body: str = Field(max_length=FEEDBACK_MAX_LENGTH)

    @model_validator(mode="after")
    def _clean(self) -> Self:
        self.body = _clean_feedback(self.body)
        return self


class FeedbackUpdate(FeedbackCreate):
    """The version the editor was looking at; a newer one means someone changed it."""

    expected_version: int = Field(ge=1)


class CoachFeedback(BaseModel):
    """The coach's own feedback on a workout, as the coach sees it."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    body: str
    version: int
    created_at: datetime
    updated_at: datetime


class CoachFeedbackResult(BaseModel):
    # None: this coach has written nothing on this workout (through this connection).
    feedback: CoachFeedback | None


class ReceivedFeedback(BaseModel):
    """Feedback on the athlete's own workout, with the author's public name only."""

    id: UUID
    coach: PersonSummary
    body: str
    created_at: datetime
    updated_at: datetime


class ReceivedFeedbackList(BaseModel):
    items: list[ReceivedFeedback]


# ── Roster activity overview ─────────────────────────────────────────────


class ActivityWindow(BaseModel):
    """The one reporting window every card in a response is counted over.

    Half-open: a workout counts when start <= performed_at < end. `end` is the
    request time (or the `as_of` a later page was asked to reuse) and
    `start = end - days`. The client displays these; it never computes its own.
    """

    start: datetime
    end: datetime
    days: int


class LatestWorkout(BaseModel):
    title: str | None
    performed_at: datetime


class AthleteActivity(BaseModel):
    """Recorded activity of a sharing athlete. Facts only; no judgement."""

    # The most recent completed workout, all time, independent of the window.
    latest_workout: LatestWorkout | None
    # Completed workouts with performed_at inside the window.
    workouts_in_window: int
    # Working sets (not warm-ups, reps > 0) in those workouts.
    working_sets_in_window: int


class AthleteOverviewItem(Connection):
    # None when the athlete is not sharing: unavailable, which is not zero.
    activity: AthleteActivity | None


class AthleteOverviewPage(BaseModel):
    items: list[AthleteOverviewItem]
    total: int
    limit: int
    offset: int
    window: ActivityWindow


# ── Program offers ───────────────────────────────────────────────────────

OfferStatus = Literal["pending", "accepted", "declined", "superseded"]


class OfferExercise(BaseModel):
    """One prescription as the coach sent it. Mirrors the program target fields."""

    exercise_id: UUID
    # The name as it was when sent, so the offer reads the same later.
    exercise_name: str
    exercise_order: int = Field(ge=0)
    target_sets: int = Field(gt=0, le=20)
    target_reps_min: int | None = Field(default=None, gt=0, le=100)
    target_reps_max: int | None = Field(default=None, gt=0, le=100)
    target_rir: int | None = Field(default=None, ge=0, le=10)
    target_rpe: Decimal | None = Field(default=None, ge=1, le=10, decimal_places=1)
    notes: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def reps_range_is_consistent(self) -> Self:
        if (
            self.target_reps_min is not None
            and self.target_reps_max is not None
            and self.target_reps_min > self.target_reps_max
        ):
            raise ValueError("target_reps_min must not be greater than target_reps_max")
        return self


class OfferTemplate(BaseModel):
    name: str = Field(max_length=200)
    day_order: int = Field(ge=0, le=100)
    notes: str | None = Field(default=None, max_length=1000)
    exercises: list[OfferExercise] = Field(max_length=50)


class OfferProgram(BaseModel):
    """The frozen program: exactly what the athlete is shown and what accepting copies."""

    name: str = Field(max_length=200)
    notes: str | None = Field(default=None, max_length=1000)
    templates: list[OfferTemplate]


class ProgramOfferRequest(BaseModel):
    program_id: UUID
    # From the preview the coach confirmed. The server rebuilds the snapshot itself
    # and refuses to send anything that does not match it.
    fingerprint: str = Field(min_length=64, max_length=64, pattern="^[0-9a-f]{64}$")


class ProgramPreview(BaseModel):
    """What sending this program to this athlete would offer right now."""

    program: OfferProgram
    fingerprint: str


class OfferSummary(BaseModel):
    id: UUID
    status: OfferStatus
    program_name: str
    template_count: int
    exercise_count: int
    sent_at: datetime
    responded_at: datetime | None
    # Which published version of a prepared program this is; None for a legacy
    # standalone offer.
    version: int | None = None
    # Set when a newer version replaced this one before the athlete answered.
    superseded_at: datetime | None = None


class SentOffer(OfferSummary):
    """The coach's view. Never says which program the athlete ended up with, or
    whether it is active: "accepted" only means the athlete added a copy."""

    lineage_id: UUID | None = None


class SentOfferDetail(SentOffer):
    program: OfferProgram


class SentOfferList(BaseModel):
    items: list[SentOffer]
    total: int
    limit: int
    offset: int


class ReceivedOffer(OfferSummary):
    coach: PersonSummary
    # The athlete's own copy, once accepted (None while pending/declined, or
    # after they deleted the copy).
    program_id: UUID | None
    # For an accepted offer: whether accepting made the new copy the athlete's
    # active program (as recorded then). None until accepted.
    activated: bool | None = None


class AcceptanceEffect(BaseModel):
    """What accepting would do to the athlete's programs, as of this read.

    Informational: the decision is made again, under lock, when they accept.
    - inactive_copy: a new inactive copy is added; whatever is active stays.
    - replaces_active_copy: the copy of the previous accepted version is active
      right now, so it becomes inactive (and is kept) and the new copy becomes
      the active one.
    """

    kind: Literal["inactive_copy", "replaces_active_copy"]
    # Version number of the earlier accepted version whose copy would be replaced.
    replaces_version: int | None = None
    replaces_program_name: str | None = None
    # With inactive_copy: the program that stays active, if any.
    keeps_active_program_name: str | None = None


class ReceivedOfferDetail(ReceivedOffer):
    program: OfferProgram
    # Only for an offer still waiting for the athlete's answer.
    acceptance: AcceptanceEffect | None = None


# ── Prepared programs (lineages) ─────────────────────────────────────────


class LineageCreate(BaseModel):
    """Start a preparation for one connection, from scratch or from a copy of
    one of the coach's own programs. The copy is independent from then on."""

    name: str | None = Field(default=None, max_length=200)
    from_program_id: UUID | None = None

    @model_validator(mode="after")
    def has_a_name_or_a_source(self) -> Self:
        if self.name is not None:
            self.name = self.name.strip() or None
        if self.name is None and self.from_program_id is None:
            raise ValueError("Give the preparation a name.")
        return self


class LineageSummary(BaseModel):
    id: UUID
    # The coach's editable draft; an ordinary program owned by the coach.
    draft_program_id: UUID
    name: str
    athlete: PersonSummary
    created_at: datetime
    latest_version: int | None
    latest_status: OfferStatus | None
    pending_version: int | None


class LineageList(BaseModel):
    items: list[LineageSummary]


class LineageDetail(LineageSummary):
    # False only when the draft is identical to the newest published version.
    has_unpublished_changes: bool
    versions: list[SentOffer]


class LineagePublishRequest(BaseModel):
    # From the preview the coach confirmed; the server rebuilds the snapshot itself.
    fingerprint: str = Field(min_length=64, max_length=64, pattern="^[0-9a-f]{64}$")


class LineagePreview(ProgramPreview):
    lineage_id: UUID
    athlete: PersonSummary
    # The number this publication will get, and the waiting version it would replace.
    version: int
    replaces_version: int | None


class ReceivedOfferList(BaseModel):
    items: list[ReceivedOffer]
    total: int
    limit: int
    offset: int
