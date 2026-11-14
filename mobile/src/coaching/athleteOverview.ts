import type { ActivityWindow, AthleteOverviewItem, AthleteOverviewPage } from "../api/coaching";

/**
 * The coach's roster with each sharing athlete's recorded activity, kept out of
 * the screens so the rules that matter can be tested without rendering anything.
 *
 * - Everything belongs to one signed-in user. `bind()` with a different id and
 *   `reset()` (sign-out, session expiry) drop the data and make requests still
 *   in flight void: their answers change nothing.
 * - The backend decides what each card may show. An athlete who is not sharing
 *   arrives with `activity: null` and the store never turns that into zeros.
 * - The first page defines the window. Later pages send its `end` back, so
 *   every card is counted over the same 28 days; a page that comes back with a
 *   different window is discarded rather than mixed in.
 * - A failed refresh keeps what is on screen and offers a retry. A 403 (coach
 *   tools are off) clears everything: nothing is kept after a refusal.
 * - Permission changes the app learns about (`revokeLink`, `removeLink`) take
 *   effect on the cards at once, without waiting for the next request.
 * - Concurrent refreshes share one request.
 */

export type AthleteOverviewApi = {
  getOverview: (limit: number, offset: number, asOf?: string) => Promise<AthleteOverviewPage>;
};

export type OverviewState = {
  /** Whose data this is. */
  userId: string | null;
  items: AthleteOverviewItem[];
  total: number;
  /** The window the cards on screen were counted over; null before the first load. */
  window: ActivityWindow | null;
  /** True once a page has loaded for this user. */
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
  /** The last refresh failed; `items`, if any, are older than this. */
  error: string | null;
  /** The last "next page" request failed. */
  moreError: string | null;
  /** The server refused: coach tools are off for this account. Nothing is shown. */
  denied: boolean;
};

export function initialOverviewState(userId: string | null = null): OverviewState {
  return {
    userId,
    items: [],
    total: 0,
    window: null,
    loaded: false,
    loading: false,
    loadingMore: false,
    error: null,
    moreError: null,
    denied: false,
  };
}

const statusOf = (error: unknown): number | null => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
};

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** A response that is not shaped like a page is an error, not an empty roster. */
function isPage(page: unknown): page is AthleteOverviewPage {
  const candidate = page as Partial<AthleteOverviewPage> | null;
  return (
    !!candidate &&
    Array.isArray(candidate.items) &&
    typeof candidate.total === "number" &&
    !!candidate.window &&
    typeof candidate.window.end === "string" &&
    typeof candidate.window.start === "string"
  );
}

const sameInstant = (a: string, b: string) => {
  const left = Date.parse(a);
  return !Number.isNaN(left) && left === Date.parse(b);
};

export function createAthleteOverviewStore(api: AthleteOverviewApi, pageSize = 20) {
  let state = initialOverviewState();
  // Bumped when the user changes: everything in flight is void.
  let generation = 0;
  // Bumped by each refresh: a next-page request started before it is void too.
  let epoch = 0;
  let refreshing: Promise<void> | null = null;
  let loadingMore = false;
  const listeners = new Set<() => void>();

  const publish = (changes: Partial<OverviewState>) => {
    state = { ...state, ...changes };
    listeners.forEach((listener) => listener());
  };

  function resetFor(userId: string | null) {
    generation += 1;
    epoch += 1;
    refreshing = null;
    loadingMore = false;
    state = initialOverviewState(userId);
    listeners.forEach((listener) => listener());
  }

  /** Point the store at a user. Switching to a different one drops everything. */
  function bind(userId: string | null) {
    if (state.userId !== userId) resetFor(userId);
  }

  /** First page again. Concurrent calls share one request; a failure keeps the cards on screen. */
  function refresh(): Promise<void> {
    if (state.userId === null) return Promise.resolve();
    if (refreshing) return refreshing;
    const request = generation;
    epoch += 1;
    loadingMore = false;
    publish({ loading: true, loadingMore: false, error: null, moreError: null });
    const current = (async () => {
      try {
        const page = await api.getOverview(pageSize, 0);
        if (request !== generation) return;
        if (!isPage(page)) throw new Error("Unexpected response");
        publish({
          items: page.items,
          total: page.total,
          window: page.window,
          loaded: true,
          loading: false,
          error: null,
          denied: false,
        });
      } catch (error) {
        if (request !== generation) return;
        if (statusOf(error) === 403) {
          // Coach tools are off for this account: show nothing, keep nothing.
          publish({
            ...initialOverviewState(state.userId),
            denied: true,
          });
          return;
        }
        publish({ loading: false, error: messageOf(error, "Could not load your athletes") });
      } finally {
        if (request === generation) refreshing = null;
      }
    })();
    refreshing = current;
    return current;
  }

  /** The next page, once, over the first page's window. Ignored while a refresh or another page runs. */
  async function loadMore(): Promise<void> {
    const { items, total, window, loaded, loading, error } = state;
    if (state.userId === null || refreshing || loadingMore || !loaded || loading || error) return;
    if (!window || items.length === 0 || items.length >= total) return;
    const request = generation;
    const startedIn = epoch;
    loadingMore = true;
    publish({ loadingMore: true, moreError: null });
    try {
      // Offset advances by rows received, not rows displayed: a connection may
      // end between two requests.
      const page = await api.getOverview(pageSize, items.length, window.end);
      if (request !== generation || startedIn !== epoch) return;
      if (!isPage(page)) throw new Error("Unexpected response");
      if (!sameInstant(page.window.end, window.end)) {
        throw new Error("The counting period changed. Pull to refresh.");
      }
      const seen = new Set(state.items.map((item) => item.id));
      const additions = page.items.filter((item) => !seen.has(item.id));
      publish({
        items: [...state.items, ...additions],
        // An empty page ends paging even if `total` still claims more.
        total: page.items.length === 0 ? state.items.length : page.total,
        loadingMore: false,
      });
    } catch (caught) {
      if (request !== generation || startedIn !== epoch) return;
      if (statusOf(caught) === 403) {
        publish({ ...initialOverviewState(state.userId), denied: true });
        return;
      }
      publish({ loadingMore: false, moreError: messageOf(caught, "Could not load more") });
    } finally {
      if (request === generation && startedIn === epoch) loadingMore = false;
    }
  }

  /**
   * The athlete stopped sharing (or sharing is known to be closed): drop that
   * card's numbers now. The card stays, as "not shared".
   */
  function revokeLink(linkId: string) {
    if (!state.items.some((item) => item.id === linkId && item.activity !== null)) return;
    publish({
      items: state.items.map((item) =>
        item.id === linkId ? { ...item, shares_workouts: false, activity: null } : item,
      ),
    });
  }

  /** The connection ended: the card and its numbers go. */
  function removeLink(linkId: string) {
    if (!state.items.some((item) => item.id === linkId)) return;
    publish({
      items: state.items.filter((item) => item.id !== linkId),
      total: Math.max(0, state.total - 1),
    });
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
    /** Sign-out and session expiry: forget everything and ignore what is still in flight. */
    reset: () => resetFor(null),
    refresh,
    loadMore,
    revokeLink,
    removeLink,
  };
}

type DenialSource = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => { scope: { linkId: string } | null; denied: "not_shared" | "ended" | null };
};

type RosterSink = {
  revokeLink: (linkId: string) => void;
  removeLink: (linkId: string) => void;
};

/**
 * When the athlete's workouts screen learns that sharing is off or the
 * connection ended, the roster card must not keep showing old numbers. Returns
 * the unsubscribe function.
 */
export function followDenials(source: DenialSource, roster: RosterSink): () => void {
  let handled: string | null = null;
  return source.subscribe(() => {
    const { scope, denied } = source.getSnapshot();
    if (!scope || !denied) {
      handled = null;
      return;
    }
    const key = `${scope.linkId}:${denied}`;
    if (handled === key) return;
    handled = key;
    if (denied === "ended") roster.removeLink(scope.linkId);
    else roster.revokeLink(scope.linkId);
  });
}
