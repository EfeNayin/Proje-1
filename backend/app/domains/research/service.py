"""Research feed: a fixed PubMed query, paged with an opaque cursor.

The query is deliberately constant in this first version: no categories, no
user search, nothing personalised. What the feed shows is what PubMed returns
for it, newest publication date first.

Paging stays consistent because the cursor carries everything that defines the
result set, not just a position: the offset AND the snapshot date. The first
page pins the snapshot to "today" and every later page re-sends it as an
Entrez-date ceiling, so records PubMed ingests while someone scrolls cannot
shift the pages underneath them. The offset advances by the PMIDs ESearch
returned (not by items displayed), so a record EFetch could not return does
not make the next page overlap or skip.
"""

import base64
import binascii
import json
from datetime import UTC, date, datetime

from app.core.exceptions import ValidationAppError
from app.domains.research.pubmed import PubMedClient
from app.domains.research.schemas import PublicationPage

# Resistance training × muscle hypertrophy, English-language records only.
PUBMED_QUERY = (
    '("resistance training"[Title/Abstract] OR "resistance exercise"[Title/Abstract] '
    'OR "strength training"[Title/Abstract]) '
    'AND (hypertrophy[Title/Abstract] OR "muscle growth"[Title/Abstract]) '
    "AND English[Language]"
)
PAGE_SIZE = 10
# ESearch refuses to page past roughly the first 10,000 results; stop short of it.
MAX_OFFSET = 9_990

_CURSOR_VERSION = 1


def _today() -> date:
    return datetime.now(UTC).date()


def encode_cursor(offset: int, snapshot: date) -> str:
    payload = {"v": _CURSOR_VERSION, "o": offset, "d": snapshot.isoformat()}
    raw = json.dumps(payload, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[int, date]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode()))
        offset, snapshot = payload["o"], date.fromisoformat(payload["d"])
        if (
            payload["v"] != _CURSOR_VERSION
            or not isinstance(offset, int)
            or isinstance(offset, bool)
            or not 0 <= offset <= MAX_OFFSET
        ):
            raise ValueError("unsupported cursor")
    except (ValueError, KeyError, TypeError, binascii.Error, UnicodeDecodeError) as exc:
        raise ValidationAppError("Invalid cursor") from exc
    return offset, snapshot


async def list_publications(client: PubMedClient, cursor: str | None) -> PublicationPage:
    offset, snapshot = decode_cursor(cursor) if cursor else (0, _today())

    search = await client.search(PUBMED_QUERY, offset=offset, limit=PAGE_SIZE, max_date=snapshot)
    items = await client.fetch(search.pmids)

    next_offset = offset + len(search.pmids)
    more = bool(search.pmids) and next_offset < min(search.count, MAX_OFFSET)
    return PublicationPage(
        items=items,
        next_cursor=encode_cursor(next_offset, snapshot) if more else None,
        total=search.count,
    )
