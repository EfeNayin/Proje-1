"""Daily readiness check-in endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.domains.auth.dependencies import CurrentUser
from app.domains.readiness import service
from app.domains.readiness.schemas import (
    ReadinessHistoryQuery,
    ReadinessHistoryResponse,
    ReadinessLogRead,
    ReadinessUpsert,
)

router = APIRouter(prefix="/readiness", tags=["readiness"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.get(
    "/today",
    response_model=ReadinessLogRead,
    summary="Today's readiness log, or an empty shell if not answered yet",
)
async def get_today(current_user: CurrentUser, db: DbSession) -> ReadinessLogRead:
    return await service.get_today(db, current_user)


@router.put(
    "/today",
    response_model=ReadinessLogRead,
    summary="Create or update today's readiness log",
)
async def upsert_today(
    payload: ReadinessUpsert,
    current_user: CurrentUser,
    db: DbSession,
) -> ReadinessLogRead:
    return await service.upsert_today(db, current_user, payload)


@router.get(
    "",
    response_model=ReadinessHistoryResponse,
    summary="Recent readiness logs, newest first",
)
async def list_history(
    current_user: CurrentUser,
    db: DbSession,
    query: Annotated[ReadinessHistoryQuery, Query()],
) -> ReadinessHistoryResponse:
    return await service.list_history(db, current_user, query)
