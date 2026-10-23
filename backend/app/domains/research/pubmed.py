"""Client for NCBI's E-utilities (PubMed).

Two calls per page, never one per article:
  1. ESearch  → the ordered PMID list for one page, plus the total count.
  2. EFetch   → the records for all of those PMIDs in a single request.

Only the official E-utilities endpoints are used. No full text is fetched and
nothing is stored; the response is parsed, shaped and returned.

NCBI allows 3 requests/second per IP without an API key, 10 with one. Every
call goes through a process-wide throttle so a burst of users cannot push us
over that; a 429 from NCBI is still handled in case several processes share
an IP.
"""

import asyncio
import json
import re
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date
from typing import Any

import httpx

from app.core.exceptions import AppError
from app.domains.research.schemas import AbstractSection, Publication

EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
PUBMED_ARTICLE_URL = "https://pubmed.ncbi.nlm.nih.gov/{pmid}/"
TOOL_NAME = "bodytrack"

# Gaps between requests that keep us under NCBI's per-IP limits, with margin.
ANONYMOUS_MIN_INTERVAL = 0.4
API_KEY_MIN_INTERVAL = 0.12

_PMID_RE = re.compile(r"^\d{1,9}$")
_WHITESPACE_RE = re.compile(r"\s+")
_YEAR_RE = re.compile(r"\b(1[5-9]\d{2}|20\d{2})\b")

# Tags that say nothing about the kind of study.
_GENERIC_TYPES = {"Journal Article"}
_GENERIC_TYPE_PREFIXES = ("Research Support",)


class PubMedRateLimitedError(AppError):
    status_code = 503
    default_detail = "PubMed is limiting requests right now. Try again in a moment."


class PubMedTimeoutError(AppError):
    status_code = 504
    default_detail = "PubMed took too long to respond. Try again."


class PubMedUnavailableError(AppError):
    status_code = 502
    default_detail = "PubMed is unavailable right now. Try again later."


class PubMedBadResponseError(AppError):
    status_code = 502
    default_detail = "PubMed returned a response that could not be read. Try again later."


@dataclass(frozen=True)
class SearchResult:
    count: int
    pmids: list[str]


class Throttle:
    """Spaces requests at least `interval` seconds apart within one process."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._next_allowed = 0.0

    async def wait(self, interval: float) -> None:
        if interval <= 0:
            return
        async with self._lock:
            delay = self._next_allowed - time.monotonic()
            if delay > 0:
                await asyncio.sleep(delay)
            self._next_allowed = time.monotonic() + interval


_shared_throttle = Throttle()


class PubMedClient:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        email: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        throttle: Throttle | None = None,
        min_interval: float | None = None,
        timeout: httpx.Timeout | None = None,
    ) -> None:
        # An empty value in .env arrives as "", which means "not set".
        self._api_key = api_key or None
        self._email = email or None
        self._transport = transport
        self._throttle = throttle or _shared_throttle
        if min_interval is None:
            min_interval = API_KEY_MIN_INTERVAL if self._api_key else ANONYMOUS_MIN_INTERVAL
        self._min_interval = min_interval
        self._timeout = timeout or httpx.Timeout(10.0, connect=5.0)

    async def search(self, term: str, *, offset: int, limit: int, max_date: date) -> SearchResult:
        """One page of PMIDs, newest publication date first.

        `max_date` caps the Entrez date (the day a record entered PubMed). A
        feed pins it to the day its first page was requested, so records
        added while someone is scrolling cannot shift later pages.
        """
        text = await self._get(
            "esearch.fcgi",
            {
                "db": "pubmed",
                "term": term,
                "retmode": "json",
                "sort": "pub_date",
                "retstart": str(offset),
                "retmax": str(limit),
                "datetype": "edat",
                "mindate": "1900/01/01",
                "maxdate": max_date.strftime("%Y/%m/%d"),
            },
        )
        return parse_search_result(text)

    async def fetch(self, pmids: list[str]) -> list[Publication]:
        """Records for `pmids` in one request, returned in the order given."""
        if not pmids:
            return []
        text = await self._get(
            "efetch.fcgi",
            {"db": "pubmed", "id": ",".join(pmids), "retmode": "xml"},
        )
        by_pmid = {publication.pmid: publication for publication in parse_articles(text)}
        if not by_pmid:
            raise PubMedBadResponseError()
        return [by_pmid[pmid] for pmid in pmids if pmid in by_pmid]

    async def _get(self, endpoint: str, params: dict[str, str]) -> str:
        query = {**params, "tool": TOOL_NAME}
        if self._email:
            query["email"] = self._email
        if self._api_key:
            query["api_key"] = self._api_key

        await self._throttle.wait(self._min_interval)
        try:
            async with httpx.AsyncClient(transport=self._transport, timeout=self._timeout) as http:
                response = await http.get(f"{EUTILS_BASE}/{endpoint}", params=query)
        except httpx.TimeoutException as exc:
            raise PubMedTimeoutError() from exc
        except httpx.HTTPError as exc:
            raise PubMedUnavailableError() from exc

        if response.status_code == 429:
            raise PubMedRateLimitedError()
        if response.status_code >= 400:
            raise PubMedUnavailableError()
        return response.text


# ── Parsing ──────────────────────────────────────────────────────────────────


def parse_search_result(text: str) -> SearchResult:
    try:
        body: Any = json.loads(text)
    except ValueError as exc:
        raise PubMedBadResponseError() from exc
    if not isinstance(body, dict):
        raise PubMedBadResponseError()

    # NCBI can answer HTTP 200 with {"error": "API rate limit exceeded", ...}.
    error = body.get("error")
    if isinstance(error, str):
        if "rate limit" in error.lower():
            raise PubMedRateLimitedError()
        raise PubMedBadResponseError()

    result = body.get("esearchresult")
    if not isinstance(result, dict) or "ERROR" in result:
        raise PubMedBadResponseError()

    count, ids = result.get("count"), result.get("idlist")
    if not isinstance(count, str) or not count.isdigit() or not isinstance(ids, list):
        raise PubMedBadResponseError()
    if not all(isinstance(i, str) and _PMID_RE.match(i) for i in ids):
        raise PubMedBadResponseError()

    # ESearch should not repeat an id; if it ever does, keep the first.
    return SearchResult(count=int(count), pmids=list(dict.fromkeys(ids)))


def parse_articles(text: str) -> list[Publication]:
    # EFetch output carries a DOCTYPE (a reference to NLM's DTD) but never entity
    # declarations; refuse a document that tries to define its own.
    if "<!ENTITY" in text:
        raise PubMedBadResponseError()
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise PubMedBadResponseError() from exc
    if root.tag != "PubmedArticleSet":
        raise PubMedBadResponseError()

    publications: list[Publication] = []
    for node in root.findall("PubmedArticle"):
        publication = _parse_article(node)
        if publication is not None:
            publications.append(publication)
    return publications


def _parse_article(node: ET.Element) -> Publication | None:
    citation = node.find("MedlineCitation")
    article = citation.find("Article") if citation is not None else None
    if citation is None or article is None:
        return None

    pmid = (citation.findtext("PMID") or "").strip()
    title = _text(article.find("ArticleTitle"))
    if not _PMID_RE.match(pmid) or not title:
        return None

    return Publication(
        pmid=pmid,
        title=title,
        year=_year(article),
        journal=(
            _text(article.find("Journal/Title")) or _text(article.find("Journal/ISOAbbreviation"))
        )
        or None,
        publication_types=_publication_types(article),
        abstract=_abstract(article),
        source_url=PUBMED_ARTICLE_URL.format(pmid=pmid),
    )


def _year(article: ET.Element) -> int | None:
    year = (article.findtext("Journal/JournalIssue/PubDate/Year") or "").strip()
    if year.isdigit():
        return int(year)
    # Some records only have a free-text range such as "2025 Jan-Feb".
    match = _YEAR_RE.search(article.findtext("Journal/JournalIssue/PubDate/MedlineDate") or "")
    if match:
        return int(match.group(1))
    year = (article.findtext("ArticleDate/Year") or "").strip()
    return int(year) if year.isdigit() else None


def _publication_types(article: ET.Element) -> list[str]:
    types: list[str] = []
    for node in article.findall("PublicationTypeList/PublicationType"):
        name = _text(node)
        if (
            name
            and name not in _GENERIC_TYPES
            and not name.startswith(_GENERIC_TYPE_PREFIXES)
            and name not in types
        ):
            types.append(name)
    return types


def _abstract(article: ET.Element) -> list[AbstractSection] | None:
    sections: list[AbstractSection] = []
    for node in article.findall("Abstract/AbstractText"):
        text = _text(node)
        if text:
            label = (node.get("Label") or "").strip()
            sections.append(AbstractSection(label=label or None, text=text))
    return sections or None


_SUPERSCRIPT = str.maketrans("0123456789+-=()ni", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ")
_SUBSCRIPT = str.maketrans("0123456789+-=()", "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎")


def _script(text: str, table: dict[int, int], marker: str) -> str:
    """Render <sup>/<sub> content without losing it (I² stays I², not I2)."""
    if text and all(ord(char) in table for char in text):
        return text.translate(table)
    return f"{marker}({text})"


def _flatten(node: ET.Element) -> str:
    parts = [node.text or ""]
    for child in node:
        inner = _flatten(child)
        if child.tag == "sup":
            inner = _script(inner, _SUPERSCRIPT, "^")
        elif child.tag == "sub":
            inner = _script(inner, _SUBSCRIPT, "_")
        parts.append(inner)
        parts.append(child.tail or "")
    return "".join(parts)


def _text(node: ET.Element | None) -> str:
    """Text content with inline markup (<i>, <b>, ...) removed, whitespace collapsed."""
    if node is None:
        return ""
    return _WHITESPACE_RE.sub(" ", _flatten(node)).strip()
