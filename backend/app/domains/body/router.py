"""Body measurement endpoints: weight history + today's weigh-in."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.domains.auth.dependencies import CurrentUser
from app.domains.body import service
from app.domains.body.schemas import (
    BodyMeasurementHistoryResponse,
    BodyMeasurementQuery,
    BodyMeasurementRead,
    BodyMeasurementUpsert,
    BodySummary,
)

router = APIRouter(prefix="/body", tags=["body"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.get(
    "/measurements",
    response_model=BodyMeasurementHistoryResponse,
    summary="Weigh-in history, most recent first",
)
async def list_measurements(
    current_user: CurrentUser,
    db: DbSession,
    query: Annotated[BodyMeasurementQuery, Query()],
) -> BodyMeasurementHistoryResponse:
    return await service.list_history(db, current_user, query)


@router.put(
    "/measurements",
    response_model=BodyMeasurementRead,
    summary="Create or update today's weigh-in",
)
async def upsert_measurement(
    payload: BodyMeasurementUpsert,
    current_user: CurrentUser,
    db: DbSession,
) -> BodyMeasurementRead:
    return await service.upsert_today(db, current_user, payload)


@router.delete(
    "/measurements/{measurement_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a wrongly-entered weigh-in",
)
async def delete_measurement(
    measurement_id: int,
    current_user: CurrentUser,
    db: DbSession,
) -> None:
    await service.delete_measurement(db, current_user, measurement_id)


@router.get(
    "/summary",
    response_model=BodySummary,
    summary="Current weight, last weigh-in date, and change since the first record",
)
async def get_summary(current_user: CurrentUser, db: DbSession) -> BodySummary:
    return await service.get_summary(db, current_user)
