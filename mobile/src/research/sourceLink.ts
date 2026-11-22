const PUBMED_ARTICLE_URL = /^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{1,9})\/$/;

/**
 * The link we open for a record, or null if it is not exactly that record's
 * PubMed page. The URL comes from our backend, but a link that opens outside
 * the app is worth one cheap check: it must be https PubMed and carry the same
 * PMID the card shows, so the button can never open a different paper.
 */
export function pubmedLink(publication: { pmid: string; source_url: string }): string | null {
  const match = PUBMED_ARTICLE_URL.exec(publication.source_url);
  return match && match[1] === publication.pmid ? publication.source_url : null;
}
