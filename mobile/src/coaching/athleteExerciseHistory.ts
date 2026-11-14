import type { AthleteExerciseHistoryPage, AthleteExerciseSession } from "../api/coaching";

/**
 * A coach's panel of one athlete's earlier sessions of an exercise, kept out of
 * the screen so the rules that matter can be tested without rendering anything.
 *
 * - The panel is open exactly while `context` is set. The context names the
 *   account, the connection, the workout it was opened from and the exercise;
 *   a different context starts from nothing, so rows from another athlete,
 *   workout or exercise can never be mixed in.
 * - `close()` and `reset()` (sign-out, session expiry, a loss of access) drop
 *   every row and make requests still in flight void: their answers change
 *   nothing. Opening again always reloads from the first page.
 * - One request at a time. Taps on "load more" or "retry" while a request is
 *   running are ignored, so a page can neither be fetched twice nor skipped.
 * - A failed page keeps the rows already loaded; retry asks for the same page.
 * - The backend decides access on every page. A 403 (sharing off) closes the
 *   panel and reports the refusal; a 404 (connection ended, or the workout or
 *   exercise is gone) clears the rows and reports it so the caller can find
 *   out which. Rows are never kept after a refusal.
 */

export type AthleteExerciseHistoryApi = {
  getHistory: (
    linkId: string,
    workoutId: string,
    exerciseId: string,
    cursor: string | null,
  ) => Promise<AthleteExerciseHistoryPage>;
};

export type HistoryContext = {
  userId: string;
  linkId: string;
  workoutId: string;
  exerciseId: string;
};

export type HistoryRefusals = {
  /** The athlete's sharing switch is off (403). */
  onForbidden: (context: HistoryContext) => void;
  /** 404: the connection ended, or the workout or exercise is no longer there. */
  onUnavailable: (context: HistoryContext) => void;
};

export type AthleteExerciseHistoryState = {
  /** null: the panel is closed and nothing is held. */
  context: HistoryContext | null;
  items: AthleteExerciseSession[];
  /** Where the next page starts; null once the end was reached. */
  nextCursor: string | null;
  /** True once the first page arrived for this context. */
  loaded: boolean;
  /** A request is running (first page, next page or a retry). */
  loading: boolean;
  /** "initial": the first page failed. "more": a later page failed; loaded rows are kept. */
  error: "initial" | "more" | null;
  /** The backend says this history no longer exists for this coach. */
  unavailable: boolean;
};

const closed = (): AthleteExerciseHistoryState => ({
  context: null,
  items: [],
  nextCursor: null,
  loaded: false,
  loading: false,
  error: null,
  unavailable: false,
});

export const initialAthleteExerciseHistoryState = closed;

export function sameHistoryContext(
  a: HistoryContext | null | undefined,
  b: HistoryContext | null | undefined,
): boolean {
  return (
    !!a &&
    !!b &&
    a.userId === b.userId &&
    a.linkId === b.linkId &&
    a.workoutId === b.workoutId &&
    a.exerciseId === b.exerciseId
  );
}

const statusOf = (error: unknown): number | null => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
};

/** A reply of the wrong shape is a failed page, not something to draw. */
function validated(page: AthleteExerciseHistoryPage): AthleteExerciseHistoryPage {
  const ok =
    page !== null &&
    typeof page === "object" &&
    Array.isArray(page.items) &&
    (page.next_cursor === null || typeof page.next_cursor === "string") &&
    page.items.every(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        typeof item.workout_id === "string" &&
        typeof item.performed_at === "string" &&
        Array.isArray(item.sets),
    );
  if (!ok) throw new Error("Unexpected exercise history response");
  return page;
}

export function createAthleteExerciseHistoryStore(
  api: AthleteExerciseHistoryApi,
  refusals: HistoryRefusals,
) {
  let state = closed();
  // Bumped by every open, close and reset: everything in flight is void.
  let generation = 0;
  let inFlight = false;
  const listeners = new Set<() => void>();

  const publish = (changes: Partial<AthleteExerciseHistoryState>) => {
    state = { ...state, ...changes };
    listeners.forEach((listener) => listener());
  };

  function close() {
    generation += 1;
    inFlight = false;
    state = closed();
    listeners.forEach((listener) => listener());
  }

  async function request(cursor: string | null): Promise<void> {
    const context = state.context;
    if (!context || inFlight) return;
    const mine = generation;
    inFlight = true;
    publish({ loading: true, error: null });
    try {
      const page = validated(
        await api.getHistory(context.linkId, context.workoutId, context.exerciseId, cursor),
      );
      if (mine !== generation) return;
      const kept = cursor === null ? [] : state.items;
      const seen = new Set(kept.map((item) => item.workout_id));
      publish({
        items: [...kept, ...page.items.filter((item) => !seen.has(item.workout_id))],
        // A cursor that points back at itself would loop; treat it as the end.
        nextCursor: page.next_cursor === cursor ? null : page.next_cursor,
        loaded: true,
        loading: false,
        error: null,
      });
    } catch (error) {
      if (mine !== generation) return;
      const status = statusOf(error);
      if (status === 403) {
        close();
        refusals.onForbidden(context);
        return;
      }
      if (status === 404) {
        publish({
          items: [],
          nextCursor: null,
          loaded: false,
          loading: false,
          error: null,
          unavailable: true,
        });
        refusals.onUnavailable(context);
        return;
      }
      publish({ loading: false, error: cursor === null ? "initial" : "more" });
    } finally {
      if (mine === generation) inFlight = false;
    }
  }

  /** Open the panel for this context and load its first page. Opening the one already open does nothing. */
  function open(context: HistoryContext): Promise<void> {
    if (sameHistoryContext(state.context, context)) return Promise.resolve();
    close();
    state = { ...closed(), context };
    listeners.forEach((listener) => listener());
    return request(null);
  }

  /** The next page, once. Ignored while a request runs or after a failure (use retry). */
  function loadMore(): Promise<void> {
    const { context, loaded, loading, error, unavailable, nextCursor } = state;
    if (!context || inFlight || loading || !loaded || error || unavailable || nextCursor === null) {
      return Promise.resolve();
    }
    return request(nextCursor);
  }

  /** The page that failed, again. Never a second request while one runs. */
  function retry(): Promise<void> {
    if (!state.context || inFlight || state.unavailable) return Promise.resolve();
    if (state.error === "initial") return request(null);
    if (state.error === "more" && state.nextCursor !== null) return request(state.nextCursor);
    return Promise.resolve();
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open,
    close,
    reset: close,
    loadMore,
    retry,
  };
}
