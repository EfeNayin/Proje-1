import type {
  AthleteWorkoutDetail,
  AthleteWorkoutPage,
  AthleteWorkoutSummary,
} from "../api/coaching";

/**
 * What a coach has loaded of one athlete's completed workouts, kept out of the
 * screens so the rules that matter can be tested without rendering anything.
 *
 * - Everything is scoped to (signed-in user, connection). Binding to a
 *   different scope, `reset()` (sign-out, session expiry) or `revoke()` drops
 *   the lists and the open workout and invalidates requests still in flight:
 *   their answers change nothing.
 * - The backend decides access on every request. A 403 (sharing off) or a 404
 *   on the list (connection ended) clears what was shown and says why; old
 *   workouts are never kept on screen after a refusal.
 * - Any other failed refresh keeps what is already on screen and offers a
 *   retry.
 * - Concurrent refreshes share one request, so a focus event plus a pull to
 *   refresh does not fetch twice.
 */

export type AthleteWorkoutsApi = {
  listWorkouts: (linkId: string, limit: number, offset: number) => Promise<AthleteWorkoutPage>;
  getWorkout: (linkId: string, workoutId: string) => Promise<AthleteWorkoutDetail>;
};

export type Scope = { userId: string; linkId: string };

/** Why the workouts are not shown: the athlete switched sharing off, or the connection ended. */
export type Denied = "not_shared" | "ended";

export type WorkoutListState = {
  items: AthleteWorkoutSummary[];
  total: number;
  /** True once a page has loaded for this scope. */
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
  /** The last refresh failed; `items`, if any, are older than this. */
  error: string | null;
  /** The last "next page" request failed. */
  moreError: string | null;
};

export type WorkoutDetailState = {
  workoutId: string | null;
  data: AthleteWorkoutDetail | null;
  loading: boolean;
  error: string | null;
  /** The workout no longer exists for this coach (the athlete deleted it, or it is not finished). */
  missing: boolean;
};

export type AthleteWorkoutsState = {
  scope: Scope | null;
  denied: Denied | null;
  list: WorkoutListState;
  detail: WorkoutDetailState;
};

const emptyList = (): WorkoutListState => ({
  items: [],
  total: 0,
  loaded: false,
  loading: false,
  loadingMore: false,
  error: null,
  moreError: null,
});

const emptyDetail = (): WorkoutDetailState => ({
  workoutId: null,
  data: null,
  loading: false,
  error: null,
  missing: false,
});

export function initialAthleteWorkoutsState(scope: Scope | null = null): AthleteWorkoutsState {
  return { scope, denied: null, list: emptyList(), detail: emptyDetail() };
}

const statusOf = (error: unknown): number | null => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
};

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function createAthleteWorkoutsStore(api: AthleteWorkoutsApi, pageSize = 20) {
  let state = initialAthleteWorkoutsState();
  // Bumped when the scope changes or access is revoked: everything in flight is void.
  let generation = 0;
  // Bumped by each refresh: a next-page request started before it is void too.
  let epoch = 0;
  let refreshing: Promise<void> | null = null;
  let loadingMore = false;
  let openingDetail: string | null = null;
  const listeners = new Set<() => void>();

  const publish = (changes: Partial<AthleteWorkoutsState>) => {
    state = { ...state, ...changes };
    listeners.forEach((listener) => listener());
  };
  const patchList = (changes: Partial<WorkoutListState>) =>
    publish({ list: { ...state.list, ...changes } });
  const patchDetail = (changes: Partial<WorkoutDetailState>) =>
    publish({ detail: { ...state.detail, ...changes } });

  function resetTo(scope: Scope | null, denied: Denied | null = null) {
    generation += 1;
    epoch += 1;
    refreshing = null;
    loadingMore = false;
    openingDetail = null;
    state = { ...initialAthleteWorkoutsState(scope), denied };
    listeners.forEach((listener) => listener());
  }

  /** Point the store at a user's view of one connection. A different scope drops everything. */
  function bind(scope: Scope | null) {
    const same =
      state.scope?.userId === scope?.userId && state.scope?.linkId === scope?.linkId;
    if (!same) resetTo(scope);
  }

  /** The backend refused (or the connection list says it would): show nothing, say why. */
  function revoke(reason: Denied) {
    resetTo(state.scope, reason);
  }

  /** Returns true when the error was an access refusal that has been handled. */
  function handleRefusal(error: unknown, listRequest: boolean): boolean {
    const status = statusOf(error);
    if (status === 403) {
      revoke("not_shared");
      return true;
    }
    if (status === 404 && listRequest) {
      revoke("ended");
      return true;
    }
    return false;
  }

  /** First page again. Concurrent calls share one request; a failure keeps the list on screen. */
  function refresh(): Promise<void> {
    if (!state.scope) return Promise.resolve();
    if (refreshing) return refreshing;
    const request = generation;
    const { linkId } = state.scope;
    epoch += 1;
    loadingMore = false;
    patchList({ loading: true, loadingMore: false, error: null, moreError: null });
    const current = (async () => {
      try {
        const page = await api.listWorkouts(linkId, pageSize, 0);
        if (request !== generation) return;
        publish({
          denied: null,
          list: {
            ...state.list,
            items: page.items,
            total: page.total,
            loaded: true,
            loading: false,
            error: null,
          },
        });
      } catch (error) {
        if (request !== generation) return;
        if (handleRefusal(error, true)) return;
        patchList({ loading: false, error: messageOf(error, "Could not load workouts") });
      } finally {
        if (request === generation) refreshing = null;
      }
    })();
    refreshing = current;
    return current;
  }

  /** The next page, once. Ignored while a refresh or another page is running. */
  async function loadMore(): Promise<void> {
    const { scope, list } = state;
    if (!scope || refreshing || loadingMore || !list.loaded || list.loading) return;
    if (list.error || list.items.length === 0 || list.items.length >= list.total) return;
    const request = generation;
    const startedIn = epoch;
    loadingMore = true;
    patchList({ loadingMore: true, moreError: null });
    try {
      // Offset advances by rows received, not rows displayed: the athlete may
      // log a session between two requests.
      const page = await api.listWorkouts(scope.linkId, pageSize, list.items.length);
      if (request !== generation || startedIn !== epoch) return;
      const seen = new Set(state.list.items.map((item) => item.id));
      const additions = page.items.filter((item) => !seen.has(item.id));
      patchList({
        items: [...state.list.items, ...additions],
        // An empty page ends paging even if `total` still claims more.
        total: page.items.length === 0 ? state.list.items.length : page.total,
        loadingMore: false,
      });
    } catch (error) {
      if (request !== generation || startedIn !== epoch) return;
      if (handleRefusal(error, true)) return;
      patchList({ loadingMore: false, moreError: messageOf(error, "Could not load more") });
    } finally {
      if (request === generation && startedIn === epoch) loadingMore = false;
    }
  }

  /** Open one workout read-only. A failed reload of the same workout keeps what is shown. */
  async function loadDetail(workoutId: string): Promise<void> {
    const { scope } = state;
    if (!scope || openingDetail === workoutId) return;
    const request = generation;
    openingDetail = workoutId;
    const sameWorkout = state.detail.workoutId === workoutId;
    patchDetail({
      workoutId,
      data: sameWorkout ? state.detail.data : null,
      loading: true,
      error: null,
      missing: false,
    });
    // The screen may have moved on to another workout (or left) while this ran.
    const current = () => request === generation && state.detail.workoutId === workoutId;
    try {
      const data = await api.getWorkout(scope.linkId, workoutId);
      if (!current()) return;
      patchDetail({ data, loading: false });
    } catch (error) {
      if (request !== generation) return;
      if (handleRefusal(error, false)) return;
      if (!current()) return;
      if (statusOf(error) === 404) {
        patchDetail({ data: null, loading: false, missing: true });
        return;
      }
      patchDetail({ loading: false, error: messageOf(error, "Could not load this workout") });
    } finally {
      if (request === generation && openingDetail === workoutId) openingDetail = null;
    }
  }

  /** Leaving a workout: forget it, ignore its pending answer. */
  function closeDetail() {
    openingDetail = null;
    publish({ detail: emptyDetail() });
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    bind,
    reset: () => resetTo(null),
    revoke,
    refresh,
    loadMore,
    loadDetail,
    closeDetail,
  };
}
