"""User endpoints scoped to the signed-in account."""

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.domains.auth.dependencies import CurrentUser
from app.domains.users import deletion, service
from app.domains.users.ratelimit import Throttle
from app.domains.users.schemas import DeleteAccountRequest, UserProfile, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.get("/me", response_model=UserProfile, summary="Get your own profile")
async def read_me(current_user: CurrentUser) -> UserProfile:
    return UserProfile.model_validate(current_user)


@router.patch("/me", response_model=UserProfile, summary="Update your own profile")
async def update_me(
    payload: UserUpdate,
    current_user: CurrentUser,
    db: DbSession,
) -> UserProfile:
    user = await service.update_profile(db, current_user, payload)
    return UserProfile.model_validate(user)


@router.post(
    "/me/delete-account",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Permanently delete your own account",
    description=(
        "Deletes the signed-in account and the personal records it owns, after checking "
        "the current password again. There is no way to name another account, and "
        "nothing can be undone. A wrong password answers 403 (not 401), so a client "
        "does not read it as an ended session, and counts toward a per-account and "
        "per-address limit (429). Records other people own, such as an athlete's "
        "accepted copies of a coach's programs and their workouts, are kept without "
        "any link back to this account. 204 means the account is gone."
    ),
)
async def delete_me(
    payload: DeleteAccountRequest,
    current_user: CurrentUser,
    db: DbSession,
    throttle: Throttle,
) -> Response:
    await deletion.delete_account(db, current_user, payload.password, throttle)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
