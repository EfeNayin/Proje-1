"""Reading database errors without leaking what they carry."""

from sqlalchemy.exc import DBAPIError, IntegrityError

_FOREIGN_KEY_VIOLATION = "23503"

# Deadlock detected, serialization failure, lock wait timed out: the transaction was
# rolled back and trying it again from the start is safe.
RETRYABLE_SQLSTATES = frozenset({"40P01", "40001", "55P03"})


def references_missing_user(error: IntegrityError) -> bool:
    """Whether a write failed because the account it belongs to no longer exists.

    That is what a request racing an account deletion looks like: its row names a user
    id that was deleted a moment ago. The database's message carries that id, so callers
    answer with their own fixed text and never pass this one on.
    """
    orig = error.orig
    cause = getattr(orig, "__cause__", None)
    for candidate in (orig, cause):
        if candidate is None:
            continue
        state = getattr(candidate, "sqlstate", None) or getattr(candidate, "pgcode", None)
        if state == _FOREIGN_KEY_VIOLATION:
            detail = str(getattr(candidate, "detail", "") or candidate)
            return 'table "users"' in detail
    return False


def sqlstate_of(error: DBAPIError) -> str | None:
    """The five-character SQLSTATE of a database error, if the driver exposes one."""
    orig = error.orig
    for candidate in (orig, getattr(orig, "__cause__", None)):
        state = getattr(candidate, "sqlstate", None) or getattr(candidate, "pgcode", None)
        if isinstance(state, str):
            return state
    return None
