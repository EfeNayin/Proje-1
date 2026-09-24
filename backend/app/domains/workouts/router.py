"""Workout and set endpoints.

Sets are nested under their workout (`/workouts/{id}/sets/...`) rather than
exposed at the top level. That makes the ownership check natural: the workout
is looked up scoped to the caller first, and anything beneath it is reached
through that.

Set mutations return the whole updated workout, so the client gets the
refreshed totals and renumbered sets without a second request.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.domains.auth.dependencies import CurrentUser
from app.domains.workouts import service
from app.domains.workouts.schemas import (
    PreviousExerciseSession,
    SetCreate,
    SetUpdate,
    WorkoutCreate,
    WorkoutDetail,
    WorkoutListResponse,
    WorkoutQuery,
    WorkoutUpdate,
)

router = APIRouter(prefix="/workouts", tags=["workouts"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.post(
    "",
    response_model=WorkoutDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Log a workout, optionally with its sets",
)
async def create_workout(
    payload: WorkoutCreate,
    current_user: CurrentUser,
    db: DbSession,
) -> WorkoutDetail:
    return await service.create_workout(db, current_user.id, payload)


@router.get(
    "",
    response_model=WorkoutListResponse,
    summary="List your workouts, most recent first",
)
async def list_workouts(
    current_user: CurrentUser,
    db: DbSession,
    query: Annotated[WorkoutQuery, Query()],
) -> WorkoutListResponse:
    return await service.list_workouts(db, current_user.id, query)


@router.get(
    "/active",
    response_model=WorkoutDetail | None,
    summary="Get the caller's in-progress workout, if any",
)
async def get_active_workout(
    current_user: CurrentUser,
    db: DbSession,
) -> WorkoutDetail | None:
    return await service.get_active_workout(db, current_user.id)


@router.get(
    "/{workout_id}",
    response_model=WorkoutDetail,
    summary="Get one workout with its sets",
)
async def get_workout(
    workout_id: UUID,
    current_user: CurrentUser,
    db: DbSession,
) -> WorkoutDetail:
    return await service.get_workout(db, current_user.id, workout_id)


@router.patch(
    "/{workout_id}",
    response_model=WorkoutDetail,
    summary="Update a workout's title, notes, date or visibility",
)
async def update_workout(
    workout_id: UUID,
    payload: WorkoutUpdate,
    current_user: CurrentUser,
    db: DbSession,
) -> WorkoutDetail:
    return await service.update_workout(db, current_user.id, workout_id, payload)


@router.get(
    "/{workout_id}/exercises/{exercise_id}/previous",
    response_model=PreviousExerciseSession | None,
    summary="Get your previous closed session's working sets for an exercise",
)
async def get_previous_exercise_session(
    workout_id: UUID,
    exercise_id: UUID,
    current_user: CurrentUser,
    db: DbSession,
) -> PreviousExerciseSession | None:
    return await service.get_previous_exercise_session(db, current_user.id, workout_id, exercise_id)


@router.delete(
    "/{workout_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a workout and all of its sets",
)
async def delete_workout(
    workout_id: UUID,
    current_user: CurrentUser,
    db: DbSession,
) -> None:
    await service.delete_workout(db, current_user.id, workout_id)


@router.post(
    "/{workout_id}/finish",
    response_model=WorkoutDetail,
    summary="Mark a workout finished",
)
async def finish_workout(
    workout_id: UUID,
    current_user: CurrentUser,
    db: DbSession,
) -> WorkoutDetail:
    return await service.finish_workout(db, current_user.id, workout_id)


@router.post(
    "/{workout_id}/sets",
    response_model=WorkoutDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Add a set to a workout",
)
async def add_set(
    workout_id: UUID,
    payload: SetCreate,
    current_user: CurrentUser,
    db: DbSession,
) -> WorkoutDetail:
    return await service.add_set(db, current_user.id, workout_id, payload)


@router.patch(
    "/{workout_id}/sets/{set_id}",
    response_model=WorkoutDetail,
    summary="Correct a logged set",
)
async def update_set(
    workout_id: UUID,
    set_id: int,
    payload: SetUpdate,
    current_user: CurrentUser,
    db: DbSession,
) -> WorkoutDetail:
    return await service.update_set(db, current_user.id, workout_id, set_id, payload)


@router.put(
    "/{workout_id}/sets/requests/{request_id}",
    response_model=WorkoutDetail,
    summary="Create a set once, safely retrying with the same request ID and details",
)
async def save_set_request(
    workout_id: UUID,
    request_id: UUID,
    payload: SetCreate,
    current_user: CurrentUser,
    db: DbSession,
) -> WorkoutDetail:
    return await service.add_set(db, current_user.id, workout_id, payload, request_id=request_id)


@router.delete(
    "/{workout_id}/sets/{set_id}",
    response_model=WorkoutDetail,
    summary="Delete a set and renumber the rest",
)
async def delete_set(
    workout_id: UUID,
    set_id: int,
    current_user: CurrentUser,
    db: DbSession,
) -> WorkoutDetail:
    return await service.delete_set(db, current_user.id, workout_id, set_id)
