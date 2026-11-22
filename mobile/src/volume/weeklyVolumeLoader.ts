import type { WeeklyVolumeResponse } from "../api/analytics";

export type VolumeState = {
  data: WeeklyVolumeResponse | null;
  /** First load only: nothing to show yet. */
  loading: boolean;
  /** A reload is running while `data` is on screen. */
  refreshing: boolean;
  /** The last attempt failed. `data`, if any, is older than this. */
  error: string | null;
};

export function initialVolumeState(): VolumeState {
  return { data: null, loading: true, refreshing: false, error: null };
}

/**
 * One owner for focus loads and pull-to-refresh.
 *
 * Only the newest request may change the screen, so a slow response from an
 * earlier focus can never overwrite a newer one. A failed reload keeps the
 * data already on screen and only records the error, which lets the screen say
 * the numbers are old instead of showing an empty week.
 */
export function createWeeklyVolumeLoader(
  fetchWeeklyVolume: () => Promise<WeeklyVolumeResponse>,
  onChange: (state: VolumeState) => void,
) {
  let state = initialVolumeState();
  let generation = 0;
  const publish = (next: VolumeState) => {
    state = next;
    onChange(next);
  };

  return {
    getSnapshot: () => state,
    // Blur/unmount invalidates callbacks without updating an inactive screen.
    invalidate: () => {
      generation += 1;
    },
    async load(): Promise<void> {
      const request = ++generation;
      const hasData = state.data !== null;
      publish({ ...state, loading: !hasData, refreshing: hasData, error: null });
      try {
        const data = await fetchWeeklyVolume();
        if (request !== generation) return;
        if (!Array.isArray(data?.weeks)) throw new Error("Unexpected response. Try again.");
        publish({ data, loading: false, refreshing: false, error: null });
      } catch (error) {
        if (request !== generation) return;
        publish({
          ...state,
          loading: false,
          refreshing: false,
          error: error instanceof Error && error.message ? error.message : "Could not load volume",
        });
      }
    },
  };
}
