"""SQLAlchemy declarative base and shared column aliases.

Every model inherits from `Base`. Alembic discovers tables through
`Base.metadata`, so any new model must also be imported in
`app/models/__init__.py`.
"""

from datetime import datetime
from typing import Annotated

from sqlalchemy import DateTime, text
from sqlalchemy.orm import DeclarativeBase, mapped_column


class Base(DeclarativeBase):
    """Base class for all ORM models (SQLAlchemy 2.0 style)."""


# ── Shared column aliases ────────────────────────────────────────────────
# server_default values mirror schema_v1.sql exactly. Keeping them in sync
# matters: if they drift, Alembic autogenerate reports phantom changes.

# Written by the database on INSERT.
created_at = Annotated[
    datetime,
    mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    ),
]

# Written on INSERT, then refreshed by the `set_updated_at()` trigger on
# every UPDATE. The trigger is the single source of truth, so we
# deliberately do NOT set onupdate= here.
updated_at = Annotated[
    datetime,
    mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    ),
]