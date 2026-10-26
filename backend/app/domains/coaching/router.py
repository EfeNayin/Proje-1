"""Coaching endpoints: coach mode, invites and connections.

The caller is always the signed-in account; no endpoint accepts a user id.
"""

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.domains.auth.dependencies import CurrentUser
from app.domains.coaching import feedback, offers, overview, service, workout_access
from app.domains.coaching.ratelimit import Throttle
from app.domains.coaching.schemas import (
    AthleteExerciseHistoryPage,
    AthleteOverviewPage,
    AthleteWorkoutDetail,
    AthleteWorkoutList,
    CoachFeedback,
    CoachFeedbackResult,
    Connection,
    ConnectionList,
    FeedbackCreate,
    FeedbackUpdate,
    InviteCodeRequest,
    InviteCreated,
    InvitePreview,
    PersonSummary,
    ProgramOfferRequest,
    ProgramPreview,
    ReceivedFeedbackList,
    ReceivedOfferDetail,
    ReceivedOfferList,
    SentOfferDetail,
    SentOfferList,
    WorkoutSharingRequest,
)
from app.domains.users.schemas import UserProfile
from app.domains.workouts.schemas import ExerciseHistoryQuery
from app.models import CoachAthleteLink, User

router = APIRouter(prefix="/coaching", tags=["coaching"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.post("/enable", response_model=UserProfile, summary="Turn on coach tools")
async def enable(current_user: CurrentUser, db: DbSession) -> UserProfile:
    user = await service.enable_coach_mode(db, current_user)
    return UserProfile.model_validate(user)


@router.post(
    "/invites",
    response_model=InviteCreated,
    status_code=status.HTTP_201_CREATED,
    summary="Create a single-use invite code (coach only)",
)
async def create_invite(
    current_user: CurrentUser, db: DbSession, response: Response
) -> InviteCreated:
    invite, code = await service.create_invite(db, current_user)
    response.headers["Cache-Control"] = "no-store"
    return InviteCreated(id=invite.id, code=code, expires_at=invite.expires_at)


@router.post(
    "/invites/preview",
    response_model=InvitePreview,
    summary="See which coach an invite code belongs to, without accepting it",
)
async def preview_invite(
    payload: InviteCodeRequest, current_user: CurrentUser, db: DbSession, throttle: Throttle
) -> InvitePreview:
    coach, expires_at = await service.preview_invite(db, current_user, payload.code, throttle)
    return InvitePreview(coach=PersonSummary.model_validate(coach), expires_at=expires_at)


@router.post(
    "/invites/accept",
    response_model=Connection,
    summary="Accept an invite and connect to its coach",
    description="201 for a new connection; 200 when the same athlete repeats an accept.",
)
async def accept_invite(
    payload: InviteCodeRequest,
    current_user: CurrentUser,
    db: DbSession,
    response: Response,
    throttle: Throttle,
) -> Connection:
    link, coach, created = await service.accept_invite(db, current_user, payload.code, throttle)
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return _connection(link, coach)


def _connection(link: CoachAthleteLink, person: User) -> Connection:
    return Connection(
        id=link.id,
        person=PersonSummary.model_validate(person),
        connected_at=link.created_at,
        shares_workouts=link.shares_workouts,
    )


def _connections(rows: list[tuple[CoachAthleteLink, User]]) -> ConnectionList:
    return ConnectionList(items=[_connection(link, person) for link, person in rows])


@router.get("/athletes", response_model=ConnectionList, summary="Your connected athletes")
async def list_athletes(current_user: CurrentUser, db: DbSession) -> ConnectionList:
    return _connections(await service.list_athletes(db, current_user))


@router.get(
    "/athletes/overview",
    response_model=AthleteOverviewPage,
    summary="Coach: recorded training activity of each athlete on the roster",
    description=(
        "A page of the roster with, for athletes who share workouts, the latest "
        "completed workout and the completed workouts and working sets recorded "
        "in one 28-day window shared by every item (start <= performed_at < end). "
        "`activity` is null for an athlete who is not sharing. Pass the first "
        "page's `window.end` as `as_of` when requesting later pages."
    ),
)
async def athletes_overview(
    current_user: CurrentUser,
    db: DbSession,
    response: Response,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    as_of: datetime | None = None,
) -> AthleteOverviewPage:
    response.headers["Cache-Control"] = "no-store"
    return await overview.athlete_overview(db, current_user, limit, offset, as_of)


@router.get("/coaches", response_model=ConnectionList, summary="Your connected coaches")
async def list_coaches(current_user: CurrentUser, db: DbSession) -> ConnectionList:
    return _connections(await service.list_coaches(db, current_user))


@router.delete(
    "/links/{link_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="End a connection (either side)",
)
async def end_link(link_id: UUID, current_user: CurrentUser, db: DbSession) -> Response:
    await service.end_link(db, current_user, link_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put(
    "/links/{link_id}/workout-sharing",
    response_model=Connection,
    summary="Athlete: let a coach read (or stop reading) your completed workouts",
)
async def set_workout_sharing(
    link_id: UUID, payload: WorkoutSharingRequest, current_user: CurrentUser, db: DbSession
) -> Connection:
    link, coach = await service.set_workout_sharing(db, current_user, link_id, payload.enabled)
    return _connection(link, coach)


@router.get(
    "/athletes/{link_id}/workouts",
    response_model=AthleteWorkoutList,
    summary="Coach: a sharing athlete's completed workouts, newest first",
)
async def list_athlete_workouts(
    link_id: UUID,
    current_user: CurrentUser,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> AthleteWorkoutList:
    return await workout_access.list_workouts(db, current_user, link_id, limit, offset)


@router.get(
    "/athletes/{link_id}/workouts/{workout_id}",
    response_model=AthleteWorkoutDetail,
    summary="Coach: one completed workout of a sharing athlete, read-only",
)
async def get_athlete_workout(
    link_id: UUID, workout_id: UUID, current_user: CurrentUser, db: DbSession
) -> AthleteWorkoutDetail:
    return await workout_access.get_workout(db, current_user, link_id, workout_id)


@router.get(
    "/athletes/{link_id}/workouts/{workout_id}/exercises/{exercise_id}/history",
    response_model=AthleteExerciseHistoryPage,
    summary="Coach: a sharing athlete's earlier sessions of an exercise, read-only",
    description=(
        "Completed sessions of the linked athlete that started strictly before "
        "the given completed workout and contain working sets (not warm-ups, "
        "reps > 0) of exactly this exercise id, newest first, ties broken by "
        "workout id. The workout must belong to the athlete and contain the "
        "exercise. `next_cursor` only works for the same connection, workout "
        "and exercise."
    ),
)
async def get_athlete_exercise_history(
    link_id: UUID,
    workout_id: UUID,
    exercise_id: UUID,
    current_user: CurrentUser,
    db: DbSession,
    response: Response,
    query: Annotated[ExerciseHistoryQuery, Query()],
) -> AthleteExerciseHistoryPage:
    response.headers["Cache-Control"] = "no-store"
    return await workout_access.get_exercise_history(
        db, current_user, link_id, workout_id, exercise_id, query
    )


_FEEDBACK = "/athletes/{link_id}/workouts/{workout_id}/feedback"


@router.get(
    _FEEDBACK,
    response_model=CoachFeedbackResult,
    summary="Coach: your own feedback on a sharing athlete's completed workout",
)
async def get_workout_feedback(
    link_id: UUID, workout_id: UUID, current_user: CurrentUser, db: DbSession, response: Response
) -> CoachFeedbackResult:
    response.headers["Cache-Control"] = "no-store"
    return await feedback.get_feedback(db, current_user, link_id, workout_id)


@router.put(
    _FEEDBACK + "/requests/{request_id}",
    response_model=CoachFeedback,
    status_code=status.HTTP_201_CREATED,
    summary="Coach: leave feedback the athlete can read; repeating a request is safe",
)
async def create_workout_feedback(
    link_id: UUID,
    workout_id: UUID,
    request_id: UUID,
    payload: FeedbackCreate,
    current_user: CurrentUser,
    db: DbSession,
    response: Response,
) -> CoachFeedback:
    response.headers["Cache-Control"] = "no-store"
    created, is_new = await feedback.create_feedback(
        db, current_user, link_id, workout_id, request_id, payload.body
    )
    if not is_new:
        response.status_code = status.HTTP_200_OK
    return created


@router.patch(
    _FEEDBACK,
    response_model=CoachFeedback,
    summary="Coach: edit your feedback; refused if it changed since `expected_version`",
)
async def update_workout_feedback(
    link_id: UUID,
    workout_id: UUID,
    payload: FeedbackUpdate,
    current_user: CurrentUser,
    db: DbSession,
    response: Response,
) -> CoachFeedback:
    response.headers["Cache-Control"] = "no-store"
    return await feedback.update_feedback(
        db, current_user, link_id, workout_id, payload.body, payload.expected_version
    )


@router.delete(
    _FEEDBACK,
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Coach: delete your feedback; refused if it changed since `expected_version`",
)
async def delete_workout_feedback(
    link_id: UUID,
    workout_id: UUID,
    expected_version: Annotated[int, Query(ge=1)],
    current_user: CurrentUser,
    db: DbSession,
) -> None:
    await feedback.delete_feedback(db, current_user, link_id, workout_id, expected_version)


@router.get(
    "/workouts/{workout_id}/feedback",
    response_model=ReceivedFeedbackList,
    summary="Athlete: the feedback coaches left on your own workout",
)
async def list_received_feedback(
    workout_id: UUID, current_user: CurrentUser, db: DbSession, response: Response
) -> ReceivedFeedbackList:
    response.headers["Cache-Control"] = "no-store"
    return await feedback.list_received(db, current_user, workout_id)


@router.get(
    "/athletes/{link_id}/program-preview/{program_id}",
    response_model=ProgramPreview,
    summary="Coach: exactly what sending this program to this athlete would offer",
)
async def preview_program_offer(
    link_id: UUID, program_id: UUID, current_user: CurrentUser, db: DbSession
) -> ProgramPreview:
    return await offers.preview_program(db, current_user, link_id, program_id)


@router.put(
    "/athletes/{link_id}/program-offers/{request_id}",
    response_model=SentOfferDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Coach: send one of your programs to a connected athlete (safe to repeat)",
)
async def send_program_offer(
    link_id: UUID,
    request_id: UUID,
    payload: ProgramOfferRequest,
    current_user: CurrentUser,
    db: DbSession,
    response: Response,
) -> SentOfferDetail:
    offer, created = await offers.send_offer(
        db, current_user, link_id, request_id, payload.program_id, payload.fingerprint
    )
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return offer


@router.get(
    "/athletes/{link_id}/program-offers",
    response_model=SentOfferList,
    summary="Coach: programs sent to this athlete and what they answered",
)
async def list_sent_offers(
    link_id: UUID,
    current_user: CurrentUser,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> SentOfferList:
    return await offers.list_sent(db, current_user, link_id, limit, offset)


@router.get(
    "/program-offers",
    response_model=ReceivedOfferList,
    summary="Athlete: programs your coaches have sent you",
)
async def list_received_offers(
    current_user: CurrentUser,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ReceivedOfferList:
    return await offers.list_received(db, current_user, limit, offset)


@router.get(
    "/program-offers/{offer_id}",
    response_model=ReceivedOfferDetail,
    summary="Athlete: one received program with its days and prescriptions",
)
async def get_received_offer(
    offer_id: UUID, current_user: CurrentUser, db: DbSession
) -> ReceivedOfferDetail:
    return await offers.get_received(db, current_user, offer_id)


@router.post(
    "/program-offers/{offer_id}/accept",
    response_model=ReceivedOfferDetail,
    summary="Athlete: add an independent, inactive copy to your programs (safe to repeat)",
)
async def accept_program_offer(
    offer_id: UUID, current_user: CurrentUser, db: DbSession
) -> ReceivedOfferDetail:
    return await offers.accept_offer(db, current_user, offer_id)


@router.post(
    "/program-offers/{offer_id}/decline",
    response_model=ReceivedOfferDetail,
    summary="Athlete: decline a received program",
)
async def decline_program_offer(
    offer_id: UUID, current_user: CurrentUser, db: DbSession
) -> ReceivedOfferDetail:
    return await offers.decline_offer(db, current_user, offer_id)
