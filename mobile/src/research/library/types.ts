/**
 * Types for the bundled Turkish research library: a small, version-controlled set
 * of short educational entries, each tied to the published sources it summarises.
 * Nothing here is generated at runtime, translated by a service or fetched.
 */

export type SourceKind =
  | "position-stand"
  | "consensus-statement"
  | "meta-analysis"
  | "systematic-review"
  | "scoping-review"
  | "randomized-trial"
  | "experimental-study"
  | "observational-study"
  | "narrative-review"
  | "model-study";

/** One original (English) publication, identified by its PubMed record and DOI. */
export type LibrarySource = {
  /** Stable key entries refer to, e.g. "acsm-2026". */
  id: string;
  kind: SourceKind;
  /** First author as PubMed lists it, "et al." when there are more. */
  authors: string;
  year: number;
  /** Original English title, exactly as PubMed holds it. */
  title: string;
  journal: string;
  pmid: string;
  doi: string;
};

/** A paragraph of explanation and the sources that support what it says. */
export type Explanation = {
  text: string;
  sourceIds: string[];
};

export type LibraryEntry = {
  /** Stable, kebab-case, never reused for another topic. */
  id: string;
  /** The question this entry answers, in Turkish. */
  title: string;
  /** Short answer, in Turkish. */
  answer: string;
  explanation: Explanation[];
  /** Who the underlying studies were done in, and what they measured. */
  context: string;
  limitations: string[];
  /** Search terms (Turkish and English). A term may be a stem: see search.ts. */
  keywords: string[];
  /** Maintained phrasings of the question people actually type. */
  aliases: string[];
  /** Every source the entry rests on, in the order they are listed. */
  sourceIds: string[];
  /** Day the cited records were last checked against PubMed, YYYY-MM-DD. */
  sourcesCheckedOn: string;
};
