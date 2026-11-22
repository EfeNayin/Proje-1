import type { Publication, PublicationPage } from "../api/research";

export type FeedError = { kind: "refresh" | "more"; message: string };

export type FeedState = {
  items: Publication[];
  /** False until the first page has been received at least once. */
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: FeedError | null;
};

const FALLBACK_MESSAGE = "Something went wrong. Try again.";

/**
 * Owns the research feed's paging independently of renders, in the same shape
 * as the workout history (src/workout/workoutHistory.ts):
 *  - A failed refresh or next page never clears what is already on screen.
 *  - Repeated taps / scroll events share the request already in flight.
 *  - cancel() (screen blur or unmount) invalidates every pending response, so a
 *    late answer cannot change state the user has already left.
 *  - Pages are de-duplicated by PMID. The cursor itself advances by what the
 *    server returned, so a repeat only ever costs us a skipped row.
 */
export function createPublicationFeed(
  fetchPage: (cursor: string | null) => Promise<PublicationPage>,
) {
  let state: FeedState = {
    items: [],
    loaded: false,
    loading: false,
    loadingMore: false,
    hasMore: false,
    error: null,
  };
  let generation = 0;
  let nextCursor: string | null = null;
  let refreshing: Promise<void> | null = null;
  let loadingMorePage: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  const publish = (changes: Partial<FeedState>) => {
    state = { ...state, ...changes };
    listeners.forEach((listener) => listener());
  };
  const messageOf = (error: unknown) =>
    error instanceof Error && error.message ? error.message : FALLBACK_MESSAGE;
  const unique = (existing: Publication[], incoming: Publication[]) => {
    const seen = new Set(existing.map((item) => item.pmid));
    return incoming.filter((item) => {
      if (seen.has(item.pmid)) return false;
      seen.add(item.pmid);
      return true;
    });
  };

  function refresh(): Promise<void> {
    if (refreshing) return refreshing;
    const request = ++generation;
    // A refresh supersedes any next-page request still pending.
    loadingMorePage = null;
    publish({ loading: true, loadingMore: false, error: null });

    const current = (async () => {
      try {
        const page = await fetchPage(null);
        if (request !== generation) return;
        nextCursor = page.next_cursor;
        publish({
          items: unique([], page.items),
          loaded: true,
          hasMore: page.next_cursor !== null,
        });
      } catch (error) {
        if (request === generation) publish({ error: { kind: "refresh", message: messageOf(error) } });
      } finally {
        if (request === generation) {
          refreshing = null;
          publish({ loading: false });
        }
      }
    })();
    refreshing = current;
    return current;
  }

  function loadMore(retry = false): Promise<void> {
    if (loadingMorePage) return loadingMorePage;
    if (state.loading || !state.hasMore || nextCursor === null) return Promise.resolve();
    // After a failure only an explicit retry goes again. Without this, the
    // list's end-reached event would re-fire the failing request in a loop.
    if (state.error !== null && (!retry || state.error.kind === "refresh")) return Promise.resolve();

    const request = generation;
    const cursor = nextCursor;
    publish({ loadingMore: true, error: null });

    const current = (async () => {
      try {
        const page = await fetchPage(cursor);
        if (request !== generation) return;
        nextCursor = page.next_cursor;
        publish({
          items: [...state.items, ...unique(state.items, page.items)],
          hasMore: page.next_cursor !== null,
        });
      } catch (error) {
        if (request === generation) publish({ error: { kind: "more", message: messageOf(error) } });
      } finally {
        if (request === generation) {
          loadingMorePage = null;
          publish({ loadingMore: false });
        }
      }
    })();
    loadingMorePage = current;
    return current;
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    loadMore,
    /** Loads the first page unless it is already there or on its way. */
    ensureLoaded: (): Promise<void> => (state.loaded ? Promise.resolve() : refresh()),
    cancel: () => {
      generation += 1;
      refreshing = null;
      loadingMorePage = null;
      publish({ loading: false, loadingMore: false });
    },
  };
}
