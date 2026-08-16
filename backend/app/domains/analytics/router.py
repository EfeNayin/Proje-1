"""Training analytics endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.domains.analytics import service
from app.domains.analytics.schemas import WeeklyVolumeQuery, WeeklyVolumeResponse
from app.domains.auth.dependencies import CurrentUser

router = APIRouter(prefix="/analytics", tags=["analytics"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.get(
    "/weekly-volume",
    response_model=WeeklyVolumeResponse,
    summary="Weekly sets per muscle against MEV/MAV/MRV",
    description=(
        "Weeks are cut in the user's own timezone. Only sets whose exercise "
        "trains a muscle directly count toward the landmarks, matching how "
        "MEV/MAV/MRV are defined."
    ),
)
async def weekly_volume(
    current_user: CurrentUser,
    db: DbSession,
    query: Annotated[WeeklyVolumeQuery, Query()],
) -> WeeklyVolumeResponse:
    return await service.weekly_volume(db, current_user, query)