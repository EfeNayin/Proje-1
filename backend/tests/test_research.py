"""Tests for the PubMed research feed.

NCBI is replaced by httpx.MockTransport, so nothing here touches the network.
The fake answers in the same shapes the real E-utilities do (ESearch JSON,
EFetch XML with its DOCTYPE), copied from live responses and trimmed. A
separate, manual, read-only check against the real service lives outside the
suite.
"""

import json
import time
from collections.abc import Callable, Iterator
from datetime import date
from unittest.mock import patch

import httpx
import pytest
from httpx import AsyncClient

from app.domains.research import service
from app.domains.research.pubmed import PubMedClient, Throttle
from app.domains.research.router import get_pubmed_client
from app.main import app

Handler = Callable[[httpx.Request], httpx.Response]

SNAPSHOT = date(2026, 10, 15)


def esearch_json(pmids: list[str], count: int | None = None) -> str:
    return json.dumps(
        {
            "header": {"type": "esearch", "version": "0.3"},
            "esearchresult": {
                "count": str(len(pmids) if count is None else count),
                "retmax": str(len(pmids)),
                "retstart": "0",
                "idlist": pmids,
            },
        }
    )


def article_xml(
    pmid: str,
    *,
    title: str = "Effects of training on muscle hypertrophy",
    journal: str | None = "Journal of Strength",
    year: str | None = "2025",
    medline_date: str | None = None,
    types: tuple[str, ...] = ("Journal Article", "Randomized Controlled Trial"),
    abstract: str | None = None,
) -> str:
    if abstract is None:
        abstract = (
            '<Abstract><AbstractText Label="RESULTS">Muscle grew by 5%.</AbstractText></Abstract>'
        )
    pub_date = ""
    if year:
        pub_date = f"<PubDate><Year>{year}</Year><Month>Dec</Month></PubDate>"
    elif medline_date:
        pub_date = f"<PubDate><MedlineDate>{medline_date}</MedlineDate></PubDate>"
    journal_xml = f"<Title>{journal}</Title>" if journal else ""
    type_xml = "".join(f"<PublicationType>{t}</PublicationType>" for t in types)
    return (
        f'<PubmedArticle><MedlineCitation Status="MEDLINE"><PMID Version="1">{pmid}</PMID>'
        f"<Article><Journal><JournalIssue>{pub_date}</JournalIssue>{journal_xml}</Journal>"
        f"<ArticleTitle>{title}</ArticleTitle>{abstract}"
        f"<PublicationTypeList>{type_xml}</PublicationTypeList></Article></MedlineCitation>"
        "</PubmedArticle>"
    )


def efetch_xml(*articles: str) -> str:
    return (
        '<?xml version="1.0" ?>\n'
        '<!DOCTYPE PubmedArticleSet PUBLIC "-//NLM//DTD PubMedArticle, 1st January 2025//EN" '
        '"https://dtd.nlm.nih.gov/ncbi/pubmed/out/pubmed_250101.dtd">\n'
        f"<PubmedArticleSet>{''.join(articles)}</PubmedArticleSet>"
    )


class FakeNcbi:
    """Records every request and answers from preset bodies."""

    def __init__(self, search: str | httpx.Response, fetch: str | httpx.Response | None = None):
        self.search_body = search
        self.fetch_body = fetch
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        body = self.search_body if request.url.path.endswith("esearch.fcgi") else self.fetch_body
        assert body is not None, f"unexpected call to {request.url.path}"
        return body if isinstance(body, httpx.Response) else httpx.Response(200, text=body)

    def calls(self, endpoint: str) -> list[httpx.Request]:
        return [r for r in self.requests if r.url.path.endswith(endpoint)]


def use_ncbi(handler: Handler, **client_kwargs: object) -> None:
    app.dependency_overrides[get_pubmed_client] = lambda: PubMedClient(
        transport=httpx.MockTransport(handler),
        throttle=Throttle(),
        min_interval=0,
        **client_kwargs,  # type: ignore[arg-type]
    )


@pytest.fixture(autouse=True)
def frozen_snapshot() -> Iterator[None]:
    with patch.object(service, "_today", return_value=SNAPSHOT):
        yield


class TestFirstPage:
    async def test_returns_real_fields_in_pubmed_order_using_one_batched_fetch(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        pmids = ["300", "100", "200"]
        ncbi = FakeNcbi(
            esearch_json(pmids, count=25),
            # EFetch order differs from ESearch order; the feed must follow ESearch.
            efetch_xml(
                article_xml("100", title="Second"),
                article_xml("200", title="Third"),
                article_xml("300", title="First"),
            ),
        )
        use_ncbi(ncbi)

        response = await client.get("/research/publications", headers=auth_headers)

        assert response.status_code == 200, response.text
        body = response.json()
        assert [item["title"] for item in body["items"]] == ["First", "Second", "Third"]
        assert [item["pmid"] for item in body["items"]] == pmids
        assert body["total"] == 25
        assert body["next_cursor"] is not None
        # Two upstream calls for the whole page, not one per article.
        assert len(ncbi.calls("esearch.fcgi")) == 1
        assert len(ncbi.calls("efetch.fcgi")) == 1
        assert ncbi.calls("efetch.fcgi")[0].url.params["id"] == "300,100,200"

    async def test_maps_title_year_journal_types_abstract_and_source_link(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        abstract = (
            "<Abstract>"
            '<AbstractText Label="BACKGROUND">Why we did it.</AbstractText>'
            '<AbstractText Label="RESULTS">Gain of <i>p</i> &lt; 0.05; I<sup>2</sup> = 75%, '
            "CO<sub>2</sub> unchanged.</AbstractText></Abstract>"
        )
        use_ncbi(
            FakeNcbi(
                esearch_json(["4242"]),
                efetch_xml(
                    article_xml(
                        "4242",
                        title="A <i>very</i> specific trial",
                        types=(
                            "Journal Article",
                            "Randomized Controlled Trial",
                            "Research Support, Non-U.S. Gov't",
                            "Meta-Analysis",
                        ),
                        abstract=abstract,
                    )
                ),
            )
        )

        response = await client.get("/research/publications", headers=auth_headers)

        item = response.json()["items"][0]
        assert item["title"] == "A very specific trial"
        assert item["year"] == 2025
        assert item["journal"] == "Journal of Strength"
        # Generic and funding tags are dropped; real study designs are kept.
        assert item["publication_types"] == ["Randomized Controlled Trial", "Meta-Analysis"]
        assert item["source_url"] == "https://pubmed.ncbi.nlm.nih.gov/4242/"
        assert item["abstract"] == [
            {"label": "BACKGROUND", "text": "Why we did it."},
            # Numbers and units survive: the superscript is not dropped to "I2".
            {"label": "RESULTS", "text": "Gain of p < 0.05; I² = 75%, CO₂ unchanged."},
        ]

    async def test_record_without_abstract_has_null_abstract_not_invented_text(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        use_ncbi(
            FakeNcbi(
                esearch_json(["1"]),
                efetch_xml(article_xml("1", abstract="", types=("Journal Article",))),
            )
        )

        item = (await client.get("/research/publications", headers=auth_headers)).json()["items"][0]

        assert item["abstract"] is None
        assert item["publication_types"] == []

    async def test_year_falls_back_to_medline_date_and_missing_journal_is_null(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        use_ncbi(
            FakeNcbi(
                esearch_json(["1"]),
                efetch_xml(article_xml("1", year=None, medline_date="2024 Jan-Feb", journal=None)),
            )
        )

        item = (await client.get("/research/publications", headers=auth_headers)).json()["items"][0]

        assert item["year"] == 2024
        assert item["journal"] is None

    async def test_sends_fixed_query_sort_page_size_and_snapshot_date(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        ncbi = FakeNcbi(esearch_json(["1"]), efetch_xml(article_xml("1")))
        use_ncbi(ncbi)

        await client.get("/research/publications", headers=auth_headers)

        params = ncbi.calls("esearch.fcgi")[0].url.params
        assert params["term"] == service.PUBMED_QUERY
        assert params["sort"] == "pub_date"
        assert params["retmax"] == "10"
        assert params["retstart"] == "0"
        assert params["maxdate"] == "2026/10/15"
        assert params["db"] == "pubmed"

    async def test_api_key_is_sent_upstream_but_never_returned_to_the_app(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        ncbi = FakeNcbi(esearch_json(["1"]), efetch_xml(article_xml("1")))
        use_ncbi(ncbi, api_key="secret-key", email="dev@example.com")

        response = await client.get("/research/publications", headers=auth_headers)

        for call in ncbi.requests:
            assert call.url.params["api_key"] == "secret-key"
            assert call.url.params["email"] == "dev@example.com"
        assert "secret-key" not in response.text

    async def test_empty_api_key_from_env_means_not_set(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        ncbi = FakeNcbi(esearch_json(["1"]), efetch_xml(article_xml("1")))
        use_ncbi(ncbi, api_key="", email="")

        await client.get("/research/publications", headers=auth_headers)

        assert "api_key" not in ncbi.requests[0].url.params
        assert "email" not in ncbi.requests[0].url.params

    async def test_requires_authentication(self, client: AsyncClient) -> None:
        ncbi = FakeNcbi(esearch_json([]))
        use_ncbi(ncbi)

        response = await client.get("/research/publications")

        assert response.status_code == 401
        assert ncbi.requests == []  # an anonymous caller cannot spend our NCBI quota


class TestEmptyAndPaging:
    async def test_no_results_returns_empty_page_without_calling_fetch(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        ncbi = FakeNcbi(esearch_json([], count=0))
        use_ncbi(ncbi)

        response = await client.get("/research/publications", headers=auth_headers)

        assert response.status_code == 200
        assert response.json() == {"items": [], "next_cursor": None, "total": 0}
        assert ncbi.calls("efetch.fcgi") == []

    async def test_next_cursor_keeps_query_sort_and_snapshot_even_after_the_day_changes(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        first_ids = [str(n) for n in range(1, 11)]
        ncbi = FakeNcbi(
            esearch_json(first_ids, count=25),
            efetch_xml(*[article_xml(p) for p in first_ids]),
        )
        use_ncbi(ncbi)
        cursor = (await client.get("/research/publications", headers=auth_headers)).json()[
            "next_cursor"
        ]

        second_ids = [str(n) for n in range(11, 21)]
        ncbi.search_body = esearch_json(second_ids, count=25)
        ncbi.fetch_body = efetch_xml(*[article_xml(p) for p in second_ids])
        # A day later: the cursor, not the clock, decides the result set.
        with patch.object(service, "_today", return_value=date(2026, 10, 16)):
            response = await client.get(
                "/research/publications", params={"cursor": cursor}, headers=auth_headers
            )

        assert response.status_code == 200, response.text
        first, second = ncbi.calls("esearch.fcgi")
        assert second.url.params["retstart"] == "10"
        assert second.url.params["maxdate"] == first.url.params["maxdate"] == "2026/10/15"
        assert second.url.params["term"] == first.url.params["term"]
        assert second.url.params["sort"] == first.url.params["sort"]
        assert response.json()["next_cursor"] is not None

    async def test_last_page_has_no_next_cursor(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        cursor = service.encode_cursor(20, SNAPSHOT)
        ids = [str(n) for n in range(21, 26)]
        use_ncbi(FakeNcbi(esearch_json(ids, count=25), efetch_xml(*[article_xml(p) for p in ids])))

        body = (
            await client.get(
                "/research/publications", params={"cursor": cursor}, headers=auth_headers
            )
        ).json()

        assert len(body["items"]) == 5
        assert body["next_cursor"] is None

    async def test_offset_advances_by_ids_searched_not_records_displayed(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        # EFetch can omit a record (withdrawn between the two calls). The next
        # page must still start after all 10 ids, or it would repeat 9.
        ids = [str(n) for n in range(1, 11)]
        ncbi = FakeNcbi(
            esearch_json(ids, count=30), efetch_xml(*[article_xml(p) for p in ids if p != "5"])
        )
        use_ncbi(ncbi)

        body = (await client.get("/research/publications", headers=auth_headers)).json()

        assert len(body["items"]) == 9
        assert service.decode_cursor(body["next_cursor"])[0] == 10

    async def test_duplicate_pmids_from_search_appear_once(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        ncbi = FakeNcbi(
            esearch_json(["7", "8", "7"], count=3), efetch_xml(article_xml("7"), article_xml("8"))
        )
        use_ncbi(ncbi)

        body = (await client.get("/research/publications", headers=auth_headers)).json()

        assert [item["pmid"] for item in body["items"]] == ["7", "8"]
        assert ncbi.calls("efetch.fcgi")[0].url.params["id"] == "7,8"

    @pytest.mark.parametrize(
        "cursor",
        [
            "not-a-cursor",
            "e30",  # {}
            service.encode_cursor(0, SNAPSHOT) + "x",
            # wrong version / negative / out-of-range offset / bad date
            "eyJ2IjoyLCJvIjowLCJkIjoiMjAyNi0xMC0xNSJ9",
            "eyJ2IjoxLCJvIjotMSwiZCI6IjIwMjYtMTAtMTUifQ",
            "eyJ2IjoxLCJvIjo5OTk5OTksImQiOiIyMDI2LTEwLTE1In0",
            "eyJ2IjoxLCJvIjowLCJkIjoibm9wZSJ9",
        ],
    )
    async def test_invalid_cursor_is_rejected_without_calling_ncbi(
        self, client: AsyncClient, auth_headers: dict[str, str], cursor: str
    ) -> None:
        ncbi = FakeNcbi(esearch_json([]))
        use_ncbi(ncbi)

        response = await client.get(
            "/research/publications", params={"cursor": cursor}, headers=auth_headers
        )

        assert response.status_code == 422
        assert ncbi.requests == []


class TestUpstreamFailures:
    async def test_timeout_is_a_504_not_empty_content(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("slow", request=request)

        use_ncbi(handler)

        response = await client.get("/research/publications", headers=auth_headers)

        assert response.status_code == 504
        assert "items" not in response.json()

    async def test_connection_failure_is_a_502(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("down", request=request)

        use_ncbi(handler)

        assert (await client.get("/research/publications", headers=auth_headers)).status_code == 502

    async def test_http_429_is_a_503_with_retry_wording(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        use_ncbi(FakeNcbi(httpx.Response(429, text="Too Many Requests")))

        response = await client.get("/research/publications", headers=auth_headers)

        assert response.status_code == 503
        assert "Try again" in response.json()["detail"]

    async def test_rate_limit_reported_inside_a_200_body_is_a_503(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        use_ncbi(FakeNcbi('{"error": "API rate limit exceeded", "count": "4"}'))

        assert (await client.get("/research/publications", headers=auth_headers)).status_code == 503

    async def test_server_error_is_a_502(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        use_ncbi(FakeNcbi(httpx.Response(500, text="boom")))

        assert (await client.get("/research/publications", headers=auth_headers)).status_code == 502

    @pytest.mark.parametrize(
        "search_body",
        [
            "<html>maintenance</html>",
            "[]",
            '{"esearchresult": {"ERROR": "Invalid query"}}',
            '{"esearchresult": {"count": "x", "idlist": []}}',
            '{"esearchresult": {"count": "2", "idlist": ["12", "../etc"]}}',
            '{"esearchresult": {"count": "2"}}',
        ],
    )
    async def test_malformed_search_response_is_a_502(
        self, client: AsyncClient, auth_headers: dict[str, str], search_body: str
    ) -> None:
        use_ncbi(FakeNcbi(search_body))

        assert (await client.get("/research/publications", headers=auth_headers)).status_code == 502

    @pytest.mark.parametrize(
        "fetch_body",
        [
            "<PubmedArticleSet><PubmedArticle>",  # truncated
            "<eFetchResult><ERROR>oops</ERROR></eFetchResult>",
            efetch_xml(),  # nothing parseable for ids we asked for
            efetch_xml("<PubmedArticle><MedlineCitation/></PubmedArticle>"),
            '<!DOCTYPE x [<!ENTITY a "aaaa">]><PubmedArticleSet/>',
        ],
    )
    async def test_malformed_fetch_response_is_a_502(
        self, client: AsyncClient, auth_headers: dict[str, str], fetch_body: str
    ) -> None:
        use_ncbi(FakeNcbi(esearch_json(["1"]), fetch_body))

        assert (await client.get("/research/publications", headers=auth_headers)).status_code == 502

    async def test_failure_does_not_depend_on_a_previous_good_page(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        # The next-page failure case from the app's point of view: a cursor that
        # was valid, then the service went down.
        cursor = service.encode_cursor(10, SNAPSHOT)
        use_ncbi(FakeNcbi(httpx.Response(503, text="down")))

        response = await client.get(
            "/research/publications", params={"cursor": cursor}, headers=auth_headers
        )

        assert response.status_code == 502


class TestThrottle:
    async def test_spaces_requests_by_the_interval(self) -> None:
        throttle = Throttle()
        started = time.monotonic()

        for _ in range(3):
            await throttle.wait(0.05)

        # First call is immediate; the next two each wait ~0.05s.
        assert time.monotonic() - started >= 0.09
