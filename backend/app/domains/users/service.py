"""User profile business logic.

This layer knows nothing about HTTP. It raises the exceptions from
app.core.exceptions and lets the router translate them into responses.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError
from app.domains.users.schemas import UserUpdate
from app.models import User


async def update_profile(db: AsyncSession, current_user: User, payload: UserUpdate) -> User:
    """Apply a partial profile update, checking username uniqueness first.

    username is CITEXT, so the comparison is already case-insensitive at the
    database level — "Efe" collides with "efe". Excluding the caller's own id
    lets them resend their current username (same or different casing)
    without it being treated as a conflict with themselves.
    """
    # exclude_unset keeps omitted fields untouched, so a request that only
    # sends {"bio": "..."} does not wipe first_name. This is different from
    # exclude_none: sending {"bio": null} explicitly clears the bio.
    changes = payload.model_dump(exclude_unset=True)

    new_username = changes.get("username")
    if new_username is not None:
        conflict = await db.scalar(
            select(User).where(User.username == new_username, User.id != current_user.id)
        )
        if conflict is not None:
            raise ConflictError("Username is already taken")

    for field, value in changes.items():
        setattr(current_user, field, value)

    await db.commit()
    await db.refresh(current_user)
    return current_user
