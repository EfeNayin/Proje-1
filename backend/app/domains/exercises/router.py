"""Exercise catalogue endpoints.

Read-only for now. User-created exercises are a later phase; the catalogue is
seeded from schema_v1.sql.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.domains.auth.dependencies import CurrentUser
from app.domains.exercises import service
from app.domains.exercises.schemas import (
    ExerciseDetail,
    ExerciseListResponse,
    ExerciseQuery,
    MuscleGroupSummary,
)

router = APIRouter(tags=["exercises"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.get(
    "/exercises",
    response_model=ExerciseListResponse,
    summary="Search and browse the exercise catalogue",
)
async def list_exercises(
    _: CurrentUser,
    db: DbSession,
    query: Annotated[ExerciseQuery, Query()],
) -> ExerciseListResponse:
    return await service.list_exercises(db, query)


@router.get(
    "/exercises/{exercise_id}",
    response_model=ExerciseDetail,
    summary="Get one exercise and the muscles it trains",
)
async def get_exercise(
    exercise_id: UUID,
    _: CurrentUser,
    db: DbSession,
) -> ExerciseDetail:
    return await service.get_exercise(db, exercise_id)


@router.get(
    "/muscle-groups",
    response_model=list[MuscleGroupSummary],
    summary="List muscle groups with their MEV/MAV/MRV landmarks",
)
async def list_muscle_groups(
    _: CurrentUser,
    db: DbSession,
) -> list[MuscleGroupSummary]:
    return await service.list_muscle_groups(db)