import type { LibrarySource, SourceKind } from "./types";

const KIND_LABEL: Record<SourceKind, string> = {
  "position-stand": "Pozisyon bildirisi",
  "consensus-statement": "Uzlaşı bildirisi",
  "meta-analysis": "Meta-analiz",
  "systematic-review": "Sistematik derleme",
  "scoping-review": "Tarama derlemesi",
  "randomized-trial": "Randomize kontrollü çalışma",
  "experimental-study": "Deneysel çalışma",
  "observational-study": "Gözlemsel çalışma",
  "narrative-review": "Anlatımsal derleme",
  "model-study": "Model çalışması",
};

export const sourceKindLabel = (kind: SourceKind): string => KIND_LABEL[kind];

/** "Currier BS et al." becomes "Currier BS ve ark."; a society name is left as is. */
export function authorsTr(authors: string): string {
  return authors.replace(/ et al\.$/, " ve ark.");
}

/** "Currier BS ve ark. · 2026 · Med Sci Sports Exerc" */
export function citationLine(source: Pick<LibrarySource, "authors" | "year" | "journal">): string {
  return `${authorsTr(source.authors)} · ${source.year} · ${source.journal}`;
}

const MONTHS = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
];

/** "2026-11-02" becomes "2 Kasım 2026"; anything else comes back unchanged. */
export function formatCheckedOn(isoDay: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay);
  if (!match) return isoDay;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return isoDay;
  return `${Number(match[3])} ${MONTHS[month - 1]} ${match[1]}`;
}

/** "Sistematik derleme · İngilizce özgün yayın" shown above each cited title. */
export const originalLanguageNote = "İngilizce özgün yayın";
