import type { WorkoutList, WorkoutSummary } from "../api/workouts";

type HistoryState = {
  items: WorkoutSummary[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: "refresh" | "more" | null;
};

/** Owns paging independently of renders. A refresh or blur invalidates older
 * responses, and repeated end-of-list events share the pending page request. */
export function createWorkoutHistory(fetchPage: (limit: number, offset: number) => Promise<WorkoutList>) {
  let state: HistoryState = { items: [], loading: true, loadingMore: false, hasMore: false, error: null };
  let generation = 0;
  let nextOffset = 0;
  const listeners = new Set<() => void>();
  const publish = (changes: Partial<HistoryState>) => {
    state = { ...state, ...changes };
    listeners.forEach((listener) => listener());
  };

  async function refresh() {
    const request = ++generation;
    publish({ loading: true, loadingMore: false, error: null });
    try {
      const page = await fetchPage(20, 0);
      if (request !== generation) return;
      nextOffset = page.offset + page.items.length;
      publish({ items: page.items, hasMore: page.items.length > 0 && nextOffset < page.total });
    } catch {
      if (request === generation) publish({ error: "refresh" });
    } finally {
      if (request === generation) publish({ loading: false });
    }
  }

  async function loadMore(retry = false) {
    if (state.loading || state.loadingMore || !state.hasMore ||
        (state.error !== null && (!retry || state.error === "refresh"))) return;
    const request = generation;
    publish({ loadingMore: true, error: null });
    try {
      const page = await fetchPage(20, nextOffset);
      if (request !== generation) return;
      // Offset advances by rows received, not unique rows displayed. Another
      // device may have inserted a session between requests.
      nextOffset = page.offset + page.items.length;
      const seen = new Set(state.items.map((item) => item.id));
      const additions = page.items.filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
      publish({ items: [...state.items, ...additions], hasMore: page.items.length > 0 && nextOffset < page.total });
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
      return () => { listeners.delete(listener); };
    },
    refresh,
    loadMore,
    cancel: () => {
      generation += 1;
      publish({ loading: false, loadingMore: false });
    },
  };
}
