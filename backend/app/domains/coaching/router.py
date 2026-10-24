"""Coaching endpoints: coach mode, invites and connections.

The caller is always the signed-in account; no endpoint accepts a user id.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.domains.auth.dependencies import CurrentUser
from app.domains.coaching import service
from app.domains.coaching.schemas import (
    Connection,
    ConnectionList,
    InviteCodeRequest,
    InviteCreated,
    InvitePreview,
    PersonSummary,
)
from app.domains.users.schemas import UserProfile
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
    payload: InviteCodeRequest, current_user: CurrentUser, db: DbSession
) -> InvitePreview:
    coach, expires_at = await service.preview_invite(db, current_user, payload.code)
    return InvitePreview(coach=PersonSummary.model_validate(coach), expires_at=expires_at)


@router.post(
    "/invites/accept",
    response_model=Connection,
    summary="Accept an invite and connect to its coach",
    description="201 for a new connection; 200 when the same athlete repeats an accept.",
)
async def accept_invite(
    payload: InviteCodeRequest, current_user: CurrentUser, db: DbSession, response: Response
) -> Connection:
    link, coach, created = await service.accept_invite(db, current_user, payload.code)
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return Connection(
        id=link.id, person=PersonSummary.model_validate(coach), connected_at=link.created_at
    )


def _connections(rows: list[tuple[CoachAthleteLink, User]]) -> ConnectionList:
    return ConnectionList(
        items=[
            Connection(
                id=link.id,
                person=PersonSummary.model_validate(person),
                connected_at=link.created_at,
            )
            for link, person in rows
        ]
    )


@router.get("/athletes", response_model=ConnectionList, summary="Your connected athletes")
async def list_athletes(current_user: CurrentUser, db: DbSession) -> ConnectionList:
    return _connections(await service.list_athletes(db, current_user))


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
