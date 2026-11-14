/**
 * Paging and state for the Exercises tab's browser.
 *
 * The workout picker shows the first 50 matches and stops; the browser must keep
 * EVERY matching catalogue entry reachable, so it pages with the API's `offset`.
 * It follows createWorkoutHistory's rules:
 *  - The next offset advances by the rows the server sent, not by the rows that
 *    ended up displayed, so a row seen twice can never make a page repeat or skip.
 *  - A new search, or a change of category, invalidates every older response;
 *    a late page from the previous search can never be appended to the new one.
 *  - A failed next page keeps what is on screen and is retried explicitly at the
 *    same offset.
 *  - Loading, empty and failed are three different states (see browserView).
 *
 * It only ever READS the catalogue. Choosing an exercise for a workout or a
 * program stays in the existing picker (usePickedExercise): nothing here may
 * deposit a pick anywhere.
 */

import type { Category, ExerciseList, ExerciseSummary } from "../api/exercises";

export const BROWSER_PAGE_SIZE = 50;

export type BrowserState = {
  query: string;
  category: Category | null;
  items: ExerciseSummary[];
  /** The server's count of ALL matches, not of the loaded ones. */
  total: number;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: "search" | "more" | null;
};

export type BrowserView = "loading" | "error" | "empty" | "results";

/**
 * Which of the four screens' worth of state this is. An error with rows already
 * on screen is still "results" (the rows stay; the retry sits under them).
 */
export function browserView(state: BrowserState): BrowserView {
  if (state.items.length > 0) return "results";
  if (state.loading) return "loading";
  if (state.error !== null) return "error";
  return "empty";
}

export type ExerciseSearch = (
  query: string,
  category: Category | null,
  limit: number,
  offset: number,
) => Promise<ExerciseList>;

export function createExerciseBrowser(fetchPage: ExerciseSearch) {
  let state: BrowserState = {
    query: "",
    category: null,
    items: [],
    total: 0,
    loading: true,
    loadingMore: false,
    hasMore: false,
    error: null,
  };
  let generation = 0;
  let nextOffset = 0;
  const listeners = new Set<() => void>();
  const publish = (changes: Partial<BrowserState>) => {
    state = { ...state, ...changes };
    listeners.forEach((listener) => listener());
  };

  /** Starts over for this query and category: the first page replaces whatever was shown. */
  async function search(query: string, category: Category | null): Promise<void> {
    const request = ++generation;
    nextOffset = 0;
    // The previous rows stay until the new answer lands, so typing does not flash an empty list.
    publish({ query, category, loading: true, loadingMore: false, error: null });
    try {
      const page = await fetchPage(query, category, BROWSER_PAGE_SIZE, 0);
      if (request !== generation) return;
      nextOffset = page.offset + page.items.length;
      publish({
        items: page.items,
        total: page.total,
        hasMore: page.items.length > 0 && nextOffset < page.total,
      });
    } catch {
      // Rows of the previous search would be a wrong answer to this one.
      if (request === generation) publish({ items: [], total: 0, hasMore: false, error: "search" });
    } finally {
      if (request === generation) publish({ loading: false });
    }
  }

  async function loadMore(retry = false): Promise<void> {
    if (
      state.loading ||
      state.loadingMore ||
      !state.hasMore ||
      (state.error !== null && (!retry || state.error === "search"))
    ) {
      return;
    }
    const request = generation;
    publish({ loadingMore: true, error: null });
    try {
      const page = await fetchPage(state.query, state.category, BROWSER_PAGE_SIZE, nextOffset);
      if (request !== generation) return;
      nextOffset = page.offset + page.items.length;
      const seen = new Set(state.items.map((item) => item.id));
      const additions = page.items.filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
      publish({
        items: [...state.items, ...additions],
        total: page.total,
        hasMore: page.items.length > 0 && nextOffset < page.total,
      });
    } catch {
      if (request === generation) publish({ error: "more" });
    } finally {
      if (request === generation) publish({ loadingMore: false });
    }
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    search,
    loadMore,
    /**
     * The screen is gone: an answer still on its way must not be applied. Nothing
     * is published, because nobody is left to read it (and a published "not
     * loading" with no rows would read as "no exercises" to a screen that
     * remounts and searches again).
     */
    cancel: () => {
      generation += 1;
    },
  };
}

export type ExerciseBrowser = ReturnType<typeof createExerciseBrowser>;
