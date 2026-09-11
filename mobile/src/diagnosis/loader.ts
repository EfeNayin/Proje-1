import type { DiagnosisResponse } from "../api/analytics";

export type DiagnosisState = {
  weeks: number | null;
  result: DiagnosisResponse | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
};

export function initialDiagnosisState(): DiagnosisState {
  return { weeks: null, result: null, loading: true, refreshing: false, error: null };
}

/** One owner for focus loads, period changes and refreshes. */
export function createDiagnosisLoader(
  fetchDiagnosis: (weeks: number) => Promise<DiagnosisResponse>,
  onChange: (state: DiagnosisState) => void,
) {
  let state = initialDiagnosisState();
  let generation = 0;
  const publish = (next: DiagnosisState) => { state = next; onChange(next); };
  return {
    getSnapshot: () => state,
    // Blur/unmount invalidates callbacks without updating an inactive screen.
    invalidate: () => { generation += 1; },
    async load(weeks: number, refresh = false): Promise<void> {
      const request = ++generation;
      const result = refresh && state.weeks === weeks ? state.result : null;
      publish({ weeks, result, loading: result === null,
        refreshing: refresh && result !== null, error: null });
      try {
        const data = await fetchDiagnosis(weeks);
        if (request !== generation) return;
        if (data.period_weeks !== weeks) throw new Error("The response belongs to a different period. Try again.");
        publish({ weeks, result: data, loading: false, refreshing: false, error: null });
      } catch (error) {
        if (request !== generation) return;
        publish({ ...state, loading: false, refreshing: false,
          error: error instanceof Error ? error.message : "Could not load diagnosis" });
      }
    },
  };
}
