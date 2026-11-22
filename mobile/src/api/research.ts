import { apiRequest } from "./client";

/**
 * Research feed: real PubMed records fetched by our backend (the app never
 * talks to NCBI directly). Fields are passed through as PubMed provides them;
 * nothing is generated or translated.
 */
export type AbstractSection = {
  /** BACKGROUND / METHODS / ...; null for an unstructured abstract. */
  label: string | null;
  text: string;
};

export type Publication = {
  pmid: string;
  title: string;
  year: number | null;
  journal: string | null;
  /** PubMed's own tags, e.g. "Randomized Controlled Trial". Empty when it has no specific one. */
  publication_types: string[];
  /** null when PubMed has no abstract for this record. */
  abstract: AbstractSection[] | null;
  source_url: string;
};

export type PublicationPage = {
  items: Publication[];
  /** Pass back unchanged to get the next page; null on the last one. */
  next_cursor: string | null;
  total: number;
};

export function fetchPublications(cursor: string | null): Promise<PublicationPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiRequest<PublicationPage>(`/research/publications${query}`);
}
