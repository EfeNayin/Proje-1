/**
 * Links out of the library. They are never stored as free text: they are built
 * from a PMID or DOI that has passed a strict format check, and only these two
 * hosts over https are accepted, so a data mistake cannot send someone elsewhere.
 */

const PMID = /^[1-9]\d{0,8}$/;
// Crossref's own recommended pattern for modern DOIs, without angle brackets or spaces.
const DOI = /^10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+$/;
const PUBMED_URL = /^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/[1-9]\d{0,8}\/$/;
const DOI_URL = /^https:\/\/doi\.org\/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+$/;

export const isPmid = (value: string): boolean => PMID.test(value);
export const isDoi = (value: string): boolean => DOI.test(value);

/** The PubMed record page, or null if the PMID is not a plain number. */
export function pubmedUrl(pmid: string): string | null {
  return isPmid(pmid) ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : null;
}

/** The publisher's page through the DOI resolver, or null if the DOI is malformed. */
export function doiUrl(doi: string): string | null {
  return isDoi(doi) ? `https://doi.org/${doi}` : null;
}

/** True only for a link in exactly the shape pubmedUrl or doiUrl produces. */
export function isSafeLibraryUrl(url: string): boolean {
  return PUBMED_URL.test(url) || DOI_URL.test(url);
}
