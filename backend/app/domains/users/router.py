"""User endpoints scoped to the signed-in account."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.domains.auth.dependencies import CurrentUser
from app.domains.users.schemas import UserProfile, UserUpdate

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
    # exclude_unset keeps omitted fields untouched, so a request that only
    # sends {"bio": "..."} does not wipe first_name. This is different from
    # exclude_none: sending {"bio": null} explicitly clears the bio.
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(current_user, field, value)

    await db.commit()
    await db.refresh(current_user)
    return UserProfile.model_validate(current_user)