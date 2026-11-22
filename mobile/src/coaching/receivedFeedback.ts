import type { ReceivedFeedback, ReceivedFeedbackList } from "../api/coaching";

/**
 * The feedback coaches left on one of the signed-in athlete's own workouts,
 * read-only and kept out of the screen so the rules can be tested.
 *
 * - Scoped to (account, workout). Another scope, `reset()` (sign-out, session
 *   expiry) or `clear()` drops the entries and voids requests in flight.
 * - Concurrent loads of the same scope share one request, so a focus event
 *   twice in a row does not fetch twice.
 * - A failed refresh keeps what is already shown and says so; it never turns
 *   into "no feedback". A 404 means the workout itself is gone: nothing shown.
 */

export type ReceivedFeedbackApi = {
  list: (workoutId: string) => Promise<ReceivedFeedbackList>;
};

export type ReceivedFeedbackScope = { userId: string; workoutId: string };

export type ReceivedFeedbackState = {
  scope: ReceivedFeedbackScope | null;
  items: ReceivedFeedback[];
  /** True once the list was read for this scope (it may be empty). */
  loaded: boolean;
  loading: boolean;
  error: string | null;
};

const empty = (): ReceivedFeedbackState => ({
  scope: null,
  items: [],
  loaded: false,
  loading: false,
  error: null,
});

export const initialReceivedFeedbackState = empty;

const same = (a: ReceivedFeedbackScope | null, b: ReceivedFeedbackScope) =>
  !!a && a.userId === b.userId && a.workoutId === b.workoutId;

const statusOf = (error: unknown): number | null => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
};

function validList(value: ReceivedFeedbackList): ReceivedFeedback[] {
  const items = (value as ReceivedFeedbackList | null)?.items;
  const ok =
    Array.isArray(items) &&
    items.every(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        typeof item.body === "string" &&
        typeof item.created_at === "string" &&
        typeof item.updated_at === "string" &&
        item.coach !== null &&
        typeof item.coach === "object" &&
        typeof item.coach.username === "string",
    );
  if (!ok) throw new Error("Unexpected feedback response");
  return items;
}

export function createReceivedFeedbackStore(api: ReceivedFeedbackApi) {
  let state = empty();
  let generation = 0;
  let running: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  const publish = (changes: Partial<ReceivedFeedbackState>) => {
    state = { ...state, ...changes };
    listeners.forEach((listener) => listener());
  };

  function clear() {
    generation += 1;
    running = null;
    state = empty();
    listeners.forEach((listener) => listener());
  }

  /** Load (or refresh) the feedback for this workout. */
  function load(scope: ReceivedFeedbackScope): Promise<void> {
    if (!same(state.scope, scope)) {
      clear();
      state = { ...empty(), scope: { ...scope } };
      listeners.forEach((listener) => listener());
    } else if (running) {
      return running;
    }
    const mine = generation;
    publish({ loading: true, error: null });
    const run = (async () => {
      try {
        // Through a promise so that even a synchronous failure lands after `running` is set.
        const items = validList(await Promise.resolve().then(() => api.list(scope.workoutId)));
        if (mine !== generation) return;
        publish({ items, loaded: true, loading: false, error: null });
      } catch (error) {
        if (mine !== generation) return;
        if (statusOf(error) === 404) {
          publish({ items: [], loaded: true, loading: false, error: null });
          return;
        }
        publish({
          loading: false,
          error: state.loaded
            ? "Could not refresh coach feedback. Showing what was loaded earlier."
            : "Could not load coach feedback.",
        });
      } finally {
        if (mine === generation) running = null;
      }
    })();
    running = run;
    return run;
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    clear,
    reset: clear,
  };
}
