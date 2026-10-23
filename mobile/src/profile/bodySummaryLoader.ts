import type { BodySummary } from "../api/body";

export type BodySummaryState = {
  /** Whose summary this is. Never shown to a different user. */
  userId: string | null;
  summary: BodySummary | null;
  /** First load for this user: nothing to show yet. */
  loading: boolean;
  /** A reload is running while this user's summary is on screen. */
  refreshing: boolean;
  /** The last attempt failed. `summary`, if any, is older than this. */
  error: string | null;
};

export function initialBodySummaryState(): BodySummaryState {
  return { userId: null, summary: null, loading: true, refreshing: false, error: null };
}

/**
 * Loads the latest weigh-in for the Profile card.
 *
 * Only the newest request may change the screen, so a slow response can never
 * overwrite a newer one. A failed reload keeps the summary already on screen
 * and only records the error. Switching to another user drops the previous
 * user's summary before anything is requested, and a late answer for the old
 * user is discarded.
 */
export function createBodySummaryLoader(
  fetchSummary: () => Promise<BodySummary>,
  onChange: (state: BodySummaryState) => void,
) {
  let state = initialBodySummaryState();
  let generation = 0;
  const publish = (next: BodySummaryState) => {
    state = next;
    onChange(next);
  };

  return {
    getSnapshot: () => state,
    // Blur/unmount invalidates callbacks without updating an inactive screen.
    invalidate: () => {
      generation += 1;
    },
    async load(userId: string): Promise<void> {
      const request = ++generation;
      const kept = state.userId === userId ? state.summary : null;
      publish({
        userId,
        summary: kept,
        loading: kept === null,
        refreshing: kept !== null,
        error: null,
      });
      try {
        const summary = await fetchSummary();
        if (request !== generation) return;
        publish({ userId, summary, loading: false, refreshing: false, error: null });
      } catch (error) {
        if (request !== generation) return;
        publish({
          ...state,
          loading: false,
          refreshing: false,
          error:
            error instanceof Error && error.message ? error.message : "Could not load your weight",
        });
      }
    },
  };
}
