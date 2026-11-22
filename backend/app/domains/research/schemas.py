"""Response models for the research feed.

Everything here is data taken from a PubMed record. Nothing is generated,
summarised or translated by this application.
"""

from pydantic import BaseModel, Field


class AbstractSection(BaseModel):
    """One paragraph of a PubMed abstract.

    Structured abstracts carry a label (BACKGROUND, METHODS, ...); plain ones
    have a single unlabelled section.
    """

    label: str | None
    text: str


class Publication(BaseModel):
    pmid: str
    title: str
    year: int | None
    journal: str | None
    # PubMed's own publication-type tags ("Randomized Controlled Trial",
    # "Meta-Analysis", ...), minus the generic "Journal Article" and funding
    # tags, which say nothing about the kind of study. Empty when PubMed has
    # no more specific tag.
    publication_types: list[str]
    # None when PubMed has no abstract for the record (letters, editorials,
    # some older papers). The client must say so rather than fill the gap.
    abstract: list[AbstractSection] | None
    source_url: str


class PublicationPage(BaseModel):
    items: list[Publication]
    # Opaque; pass back unchanged to get the following page. None on the last page.
    next_cursor: str | None
    # Records matching the fixed query as of this feed's snapshot date.
    total: int


class PublicationQuery(BaseModel):
    cursor: str | None = Field(default=None, max_length=200)
