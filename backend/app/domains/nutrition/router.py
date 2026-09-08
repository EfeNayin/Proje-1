"""Nutrition goal endpoints: read, auto-generate, and manual override."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.domains.auth.dependencies import CurrentUser
from app.domains.nutrition import service
from app.domains.nutrition.schemas import NutritionGoalsManualUpdate, NutritionGoalsRead

router = APIRouter(prefix="/nutrition", tags=["nutrition"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.get(
    "/goals",
    response_model=NutritionGoalsRead,
    summary="Current nutrition goals, plus what's missing to auto-calculate them",
)
async def read_goals(current_user: CurrentUser, db: DbSession) -> NutritionGoalsRead:
    return await service.get_goals(db, current_user)


@router.post(
    "/goals/generate",
    response_model=NutritionGoalsRead,
    summary="Calculate goals from the Mifflin-St Jeor formula and save them",
)
async def generate_goals(current_user: CurrentUser, db: DbSession) -> NutritionGoalsRead:
    return await service.generate_goals(db, current_user)


@router.patch(
    "/goals",
    response_model=NutritionGoalsRead,
    summary="Overwrite one or more goals by hand",
)
async def update_goals(
    payload: NutritionGoalsManualUpdate,
    current_user: CurrentUser,
    db: DbSession,
) -> NutritionGoalsRead:
    return await service.update_goals(db, current_user, payload)
