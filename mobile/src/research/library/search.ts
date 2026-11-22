import type { LibraryEntry } from "./types";

/**
 * Keyword and sentence search over the bundled library. It is plain, inspectable
 * word matching, not understanding: nothing is generated, no confidence is
 * computed, and a question the library does not cover gets no result instead of
 * the nearest topic.
 *
 * How a query is read
 *  - Text is lower-cased the Turkish way and folded to ASCII (ı→i, ş→s, ğ→g, ü→u,
 *    ö→o, ç→c), so "Tükenişe", "TUKENISE" and "tukenise" are the same word. The same
 *    folding is applied to the library text.
 *  - Common filler words (STOP_WORDS) and words shorter than three letters (such as
 *    the "ta" of "Mars'ta") are ignored. A query made only of them has no searchable
 *    words ("no-terms"). Words that are not filler but occur nowhere in the library
 *    are reported back as `unmatchedWords`.
 *
 * How a word matches a library term (title, alias, keyword or text word)
 *  - equal, or
 *  - the typed word is the term plus an ending. For a term of five or more letters
 *    (a stem such as "tukenis" or "dinlen") any ending of up to eight letters is
 *    accepted: "tükenişe", "dinlenmeliyim". For a shorter term only an ordinary noun
 *    ending counts (-ler, -in, -de, -dan ...): "setler", "kasın", but not "almalıyım"
 *    for "alma", or
 *  - the typed word, at 4+ letters, is the start of the term (a word typed so far).
 *  That is all the "Turkish suffix" handling there is; keywords are written as stems
 *  where an ending is expected, and aliases are maintained by hand.
 *
 * What counts as a result
 *  - An entry matches strongly when a query word hits its title, an alias or a
 *    keyword. If any entry matches strongly, entries that only share ordinary body
 *    text are not listed. If none does, body-text matches are used, but only when
 *    they cover at least two query words.
 *  - An entry must cover at least half of the query's searchable words.
 *  - If half or more of the searchable words occur nowhere in the library, there is
 *    no result: the question is about something the library does not hold, and a
 *    generic word like "set" must not turn it into the nearest topic. With fewer
 *    missing words the results are shown and the missing words are named.
 *
 * How results are ordered
 *  - Per query word the best field counts: title 10, alias 8, keyword 6, short
 *    answer 3, body text 1. A word that hits few entries is worth more than one that
 *    hits many (weight 1 + ln(entries / entries hit)), so "set" alone does not
 *    outrank "dinlenme". An alias whose searchable words are all in the query adds 5,
 *    and an alias typed out in full (filler included) adds 20.
 *  - Entries scoring under half of the best score are dropped; ties keep library order.
 *  The score is only used for ordering. It is never shown as a confidence.
 */

const FOLD: Record<string, string> = {
  "ı": "i",
  "İ": "i",
  "ş": "s",
  "Ş": "s",
  "ğ": "g",
  "Ğ": "g",
  "ü": "u",
  "Ü": "u",
  "ö": "o",
  "Ö": "o",
  "ç": "c",
  "Ç": "c",
  "â": "a",
  "Â": "a",
  "î": "i",
  "Î": "i",
  "û": "u",
  "Û": "u",
};

/** Lower-case (Turkish casing), fold to ASCII, replace everything else with single spaces. */
export function normalizeText(text: string): string {
  let out = "";
  for (const char of text) {
    const folded = FOLD[char] ?? char.toLowerCase();
    out += /[a-z0-9]/.test(folded) ? folded : " ";
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Words that carry no topic on their own. Compared after normalizeText, exactly. */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  "ne", "nedir", "neden", "nicin", "nasil", "nelerdir", "hangi", "kac", "kadar", "acaba",
  "mi", "mu", "midir", "mudur", "miyim", "miyiz", "misin", "musun",
  "ve", "veya", "ile", "ya", "da", "de", "ki", "ama", "fakat", "yani",
  "bir", "bu", "su", "o", "her", "tum", "butun", "en", "cok", "daha", "gibi", "sadece", "yalnizca",
  "icin", "ise", "hakkinda", "ilgili", "uzerine",
  "ben", "bana", "beni", "benim", "sen", "sence",
  "gerek", "gerekir", "gerekli", "gerekiyor", "sart", "lazim", "olur", "olmali", "olmalidir",
  "olarak", "olmak", "var", "yok",
  "yapmali", "yapmaliyim", "yapilmali", "yapilir", "yapilmalidir", "yapabilir", "yapmak", "yapayim",
  "etmeli", "etmeliyim", "etmek", "almak", "vermek", "gitmek", "gitmeli", "goturmek", "kullanmak",
  "lutfen", "merhaba",
]);

type QueryWord = { shown: string; term: string };

/** The searchable words of a query (as typed, and folded), and the filler that was left out. */
function readQuery(query: string): { words: QueryWord[]; ignored: string[] } {
  const words: QueryWord[] = [];
  const ignored: string[] = [];
  const seen = new Set<string>();
  const raw = query.match(/[^\s.,;:!?()"'“”‘’\-–—/]+/g) ?? [];
  for (const piece of raw) {
    const term = normalizeText(piece);
    if (term.length === 0) continue;
    if ((term.length < 3 && !/\d/.test(term)) || STOP_WORDS.has(term)) {
      ignored.push(piece);
      continue;
    }
    if (seen.has(term)) continue;
    seen.add(term);
    words.push({ shown: piece, term });
  }
  return { words, ignored };
}

const tokens = (text: string): string[] => {
  const normalized = normalizeText(text);
  return normalized.length === 0 ? [] : normalized.split(" ");
};

/** Endings a noun takes (folded: ı→i, ü→u), in any order and any number: "set"+"ler"+"in". */
const NOUN_ENDINGS = /^(?:ler|lar|nin|nun|in|un|den|dan|ten|tan|de|da|te|ta|ye|ya|yi|yu|ne|na|ni|nu|si|su|le|la|ki|dir|tir|dur|tur|ce|ca|i|u|e|a)+$/;

/** True if a typed word matches a library term under the rules in the header. */
export function wordMatches(word: string, term: string): boolean {
  if (word === term) return true;
  if (term.length >= 3 && word.startsWith(term)) {
    const ending = word.slice(term.length);
    return term.length >= 5 ? ending.length <= 8 : NOUN_ENDINGS.test(ending);
  }
  return word.length >= 4 && term.startsWith(word);
}

const WEIGHT = { title: 10, alias: 8, keyword: 6, answer: 3, body: 1 } as const;
const STRONG = WEIGHT.keyword;
const ALIAS_BONUS = 5;
const ALIAS_EXACT_BONUS = 20;
const KEEP_FRACTION = 0.5;

type Indexed = {
  entry: LibraryEntry;
  title: string[];
  alias: string[];
  /** Each alias as typed: every word, filler included. */
  aliasPhrases: string[][];
  keyword: string[];
  answer: string[];
  body: string[];
};

const indexCache = new WeakMap<readonly LibraryEntry[], Indexed[]>();

function indexEntries(entries: readonly LibraryEntry[]): Indexed[] {
  const cached = indexCache.get(entries);
  if (cached) return cached;
  const built = entries.map((entry) => ({
    entry,
    title: tokens(entry.title),
    alias: entry.aliases.flatMap(tokens),
    aliasPhrases: entry.aliases.map(tokens),
    keyword: entry.keywords.flatMap(tokens),
    answer: tokens(entry.answer),
    body: [
      ...entry.explanation.flatMap((part) => tokens(part.text)),
      ...tokens(entry.context),
      ...entry.limitations.flatMap(tokens),
    ],
  }));
  indexCache.set(entries, built);
  return built;
}

/** True if `run` appears in `list` as consecutive words. */
function containsRun(list: string[], run: string[]): boolean {
  if (run.length === 0 || run.length > list.length) return false;
  for (let start = 0; start + run.length <= list.length; start += 1) {
    if (run.every((term, offset) => list[start + offset] === term)) return true;
  }
  return false;
}

const bestWeight = (item: Indexed, word: string): number => {
  const has = (list: string[]) => list.some((term) => wordMatches(word, term));
  if (has(item.title)) return WEIGHT.title;
  if (has(item.alias)) return WEIGHT.alias;
  if (has(item.keyword)) return WEIGHT.keyword;
  if (has(item.answer)) return WEIGHT.answer;
  if (has(item.body)) return WEIGHT.body;
  return 0;
};

export type SearchHit = {
  entry: LibraryEntry;
  /** Ordering only; never shown as a confidence. 0 when the whole library is listed. */
  score: number;
  /** The words of the query (as typed) that this entry matched. */
  matchedWords: string[];
};

export type SearchResult = {
  /**
   * all: the query was empty, every entry is listed.
   * no-terms: the query held nothing searchable (only filler words or symbols).
   * matches / none: the library does / does not cover the query.
   */
  kind: "all" | "no-terms" | "matches" | "none";
  hits: SearchHit[];
  /** Searchable words that occur nowhere in the library. */
  unmatchedWords: string[];
  /** Filler words that were left out of the search. */
  ignoredWords: string[];
};

export function searchLibrary(entries: readonly LibraryEntry[], query: string): SearchResult {
  if (query.trim().length === 0) {
    return {
      kind: "all",
      hits: entries.map((entry) => ({ entry, score: 0, matchedWords: [] })),
      unmatchedWords: [],
      ignoredWords: [],
    };
  }

  const { words, ignored } = readQuery(query);
  if (words.length === 0) {
    return { kind: "no-terms", hits: [], unmatchedWords: [], ignoredWords: ignored };
  }

  const items = indexEntries(entries);
  // weights[w][i]: best field weight of query word w in entry i.
  const weights = words.map((word) => items.map((item) => bestWeight(item, word.term)));

  const unmatchedWords = words.filter((_, w) => weights[w].every((weight) => weight === 0)).map((word) => word.shown);
  if (unmatchedWords.length * 2 >= words.length) {
    return { kind: "none", hits: [], unmatchedWords, ignoredWords: ignored };
  }
  const idf = weights.map((row) => {
    const strongHits = row.filter((weight) => weight >= STRONG).length;
    const anyHits = row.filter((weight) => weight > 0).length;
    return 1 + Math.log(Math.max(1, items.length) / Math.max(1, strongHits || anyHits));
  });

  const needed = Math.ceil(words.length / 2);
  const typed = tokens(query);
  type Candidate = { index: number; score: number; strong: boolean; covered: number };
  const candidates: Candidate[] = [];
  items.forEach((item, index) => {
    let score = 0;
    let covered = 0;
    let strong = false;
    words.forEach((_, w) => {
      const weight = weights[w][index];
      if (weight === 0) return;
      covered += 1;
      score += weight * idf[w];
      if (weight >= STRONG) strong = true;
    });
    if (covered === 0) return;
    if (item.aliasPhrases.some((phrase) => containsRun(typed, phrase))) score += ALIAS_EXACT_BONUS;
    else if (
      item.aliasPhrases.some((phrase) => {
        const meaningful = phrase.filter((term) => term.length >= 3 && !STOP_WORDS.has(term));
        return meaningful.length > 0 && meaningful.every((term) => words.some((word) => wordMatches(word.term, term)));
      })
    ) {
      score += ALIAS_BONUS;
    }
    candidates.push({ index, score, strong, covered });
  });

  const anyStrong = candidates.some((candidate) => candidate.strong);
  const eligible = candidates.filter((candidate) =>
    candidate.covered >= needed && (anyStrong ? candidate.strong : candidate.covered >= 2),
  );
  const best = Math.max(0, ...eligible.map((candidate) => candidate.score));
  const kept = eligible
    .filter((candidate) => candidate.score >= best * KEEP_FRACTION)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const hits: SearchHit[] = kept.map((candidate) => ({
    entry: items[candidate.index].entry,
    score: candidate.score,
    matchedWords: words.filter((_, w) => weights[w][candidate.index] > 0).map((word) => word.shown),
  }));

  return {
    kind: hits.length > 0 ? "matches" : "none",
    hits,
    unmatchedWords,
    ignoredWords: ignored,
  };
}
