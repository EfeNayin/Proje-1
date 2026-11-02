import { isDoi, isPmid, isSafeLibraryUrl, doiUrl, pubmedUrl } from "./links";
import type { LibraryEntry, LibrarySource, SourceKind } from "./types";

/**
 * Structural checks on the bundled content. They catch a missing field, a broken
 * reference, a malformed identifier or an unsafe link. They say nothing about
 * whether a summary is scientifically right: that was checked by reading the
 * cited records (see sources.ts), and a test cannot repeat it.
 */

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KINDS: ReadonlySet<SourceKind> = new Set([
  "position-stand",
  "consensus-statement",
  "meta-analysis",
  "systematic-review",
  "scoping-review",
  "randomized-trial",
  "experimental-study",
  "observational-study",
  "narrative-review",
  "model-study",
]);
/** Routes that live beside the entries under /research and so cannot be entry ids. */
const RESERVED_IDS: ReadonlySet<string> = new Set(["pubmed"]);
export const MAX_ANSWER_LENGTH = 460;

/**
 * Words that would take the library outside its scope (rehabilitation, disease
 * treatment, drugs, supplement dosing). A crude guard against content drifting
 * there, not a substitute for reading what is written.
 */
const OUT_OF_SCOPE: readonly RegExp[] = [
  /rehabilitasyon/i,
  /tedavi/i,
  /steroid/i,
  /anabolik/i,
  /\bilaç/i,
  /takviye/i,
  /kreatin/i,
  /\bdoz(u|lar)?\b/i,
  /\d\s?mg\b/i,
];

const blank = (value: unknown): boolean => typeof value !== "string" || value.trim().length === 0;

function realDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

export function validateLibrary(
  entries: readonly LibraryEntry[],
  sources: readonly LibrarySource[],
): string[] {
  const problems: string[] = [];
  const sourceIds = new Set<string>();
  const pmids = new Set<string>();

  sources.forEach((source, index) => {
    const label = `source ${source.id ?? `#${index}`}`;
    if (blank(source.id) || !ID.test(source.id)) problems.push(`${label}: id must be kebab-case`);
    if (sourceIds.has(source.id)) problems.push(`${label}: duplicate id`);
    sourceIds.add(source.id);
    if (!KINDS.has(source.kind)) problems.push(`${label}: unknown kind "${source.kind}"`);
    for (const field of ["authors", "title", "journal"] as const) {
      if (blank(source[field])) problems.push(`${label}: ${field} is empty`);
    }
    if (!Number.isInteger(source.year) || source.year < 1900 || source.year > 2100) {
      problems.push(`${label}: year ${source.year} is not plausible`);
    }
    if (!isPmid(source.pmid)) problems.push(`${label}: pmid "${source.pmid}" is not a PubMed id`);
    if (pmids.has(source.pmid)) problems.push(`${label}: pmid ${source.pmid} appears twice`);
    pmids.add(source.pmid);
    if (!isDoi(source.doi)) problems.push(`${label}: doi "${source.doi}" is malformed`);
    for (const url of [pubmedUrl(source.pmid), doiUrl(source.doi)]) {
      if (url === null || !isSafeLibraryUrl(url)) problems.push(`${label}: link is not a safe PubMed/DOI url`);
    }
  });

  const entryIds = new Set<string>();
  const usedSources = new Set<string>();
  if (entries.length === 0) problems.push("library has no entries");

  entries.forEach((entry, index) => {
    const label = `entry ${entry.id ?? `#${index}`}`;
    if (blank(entry.id) || !ID.test(entry.id)) problems.push(`${label}: id must be kebab-case`);
    if (RESERVED_IDS.has(entry.id)) problems.push(`${label}: id is reserved for a route`);
    if (entryIds.has(entry.id)) problems.push(`${label}: duplicate id`);
    entryIds.add(entry.id);

    if (blank(entry.title)) problems.push(`${label}: title is empty`);
    else if (!entry.title.trim().endsWith("?")) problems.push(`${label}: title must be a question`);
    if (blank(entry.answer)) problems.push(`${label}: answer is empty`);
    else if (entry.answer.length > MAX_ANSWER_LENGTH) problems.push(`${label}: answer is not short (${entry.answer.length} characters)`);
    if (blank(entry.context)) problems.push(`${label}: context is empty`);
    if (!realDay(entry.sourcesCheckedOn)) problems.push(`${label}: sourcesCheckedOn is not a real YYYY-MM-DD day`);

    if (entry.limitations.length === 0 || entry.limitations.some(blank)) problems.push(`${label}: needs non-empty limitations`);
    if (entry.keywords.length < 3 || entry.keywords.some(blank)) problems.push(`${label}: needs at least 3 non-empty keywords`);
    if (entry.aliases.length < 2 || entry.aliases.some(blank)) problems.push(`${label}: needs at least 2 non-empty aliases`);

    if (entry.sourceIds.length === 0) problems.push(`${label}: cites no source`);
    if (new Set(entry.sourceIds).size !== entry.sourceIds.length) problems.push(`${label}: lists a source twice`);
    for (const id of entry.sourceIds) {
      if (!sourceIds.has(id)) problems.push(`${label}: unknown source "${id}"`);
      usedSources.add(id);
    }

    const cited = new Set<string>();
    if (entry.explanation.length === 0) problems.push(`${label}: has no explanation`);
    entry.explanation.forEach((part, partIndex) => {
      if (blank(part.text)) problems.push(`${label}: explanation ${partIndex + 1} is empty`);
      if (part.sourceIds.length === 0) problems.push(`${label}: explanation ${partIndex + 1} names no source`);
      for (const id of part.sourceIds) {
        if (!entry.sourceIds.includes(id)) problems.push(`${label}: explanation ${partIndex + 1} cites "${id}", not in the entry's sources`);
        cited.add(id);
      }
    });
    for (const id of entry.sourceIds) {
      if (!cited.has(id)) problems.push(`${label}: source "${id}" is listed but no explanation rests on it`);
    }

    const text = [entry.title, entry.answer, entry.context, ...entry.limitations, ...entry.explanation.map((part) => part.text)].join("\n");
    for (const pattern of OUT_OF_SCOPE) {
      if (pattern.test(text)) problems.push(`${label}: mentions something outside the library's scope (${pattern})`);
    }
  });

  for (const id of sourceIds) {
    if (!usedSources.has(id)) problems.push(`source ${id}: not cited by any entry`);
  }
  return problems;
}
