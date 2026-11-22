"""Research feed endpoints: real PubMed records, fetched server-side."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.core.config import settings
from app.domains.auth.dependencies import CurrentUser
from app.domains.research import service
from app.domains.research.pubmed import PubMedClient
from app.domains.research.schemas import PublicationPage, PublicationQuery

router = APIRouter(prefix="/research", tags=["research"])


def get_pubmed_client() -> PubMedClient:
    """Overridden in tests so they never touch the live service."""
    return PubMedClient(api_key=settings.NCBI_API_KEY, email=settings.NCBI_EMAIL)


@router.get(
    "/publications",
    response_model=PublicationPage,
    summary="PubMed records on resistance training and hypertrophy",
    description=(
        "A fixed PubMed query, ten records per page, newest first. Records are "
        "passed through as PubMed provides them (title, journal, year, "
        "publication types, abstract); nothing is generated or summarised. "
        "Pass `next_cursor` back as `cursor` for the following page. If PubMed "
        "is unreachable, rate limiting, or answers with something unreadable, "
        "the response is a 502/503/504 — never placeholder content."
    ),
)
async def list_publications(
    _: CurrentUser,
    pubmed: Annotated[PubMedClient, Depends(get_pubmed_client)],
    query: Annotated[PublicationQuery, Query()],
) -> PublicationPage:
    return await service.list_publications(pubmed, query.cursor)
