import { useMemo, useSyncExternalStore } from "react";

import { athleteWorkoutsStore } from "./athleteWorkoutsSession";
import { initialAthleteWorkoutsState } from "./athleteWorkouts";
import type { AthleteWorkoutsState } from "./athleteWorkouts";

/**
 * The loaded workouts for this user's view of one connection. If the store
 * still holds another scope's data for a moment (before this screen has bound
 * it), an empty state is returned instead, so nothing of it is ever drawn.
 */
export function useAthleteWorkouts(userId: string | null, linkId: string): AthleteWorkoutsState {
  const state = useSyncExternalStore(athleteWorkoutsStore.subscribe, athleteWorkoutsStore.getSnapshot);
  const empty = useMemo(
    () => initialAthleteWorkoutsState(userId ? { userId, linkId } : null),
    [userId, linkId],
  );
  const matches = state.scope?.userId === userId && state.scope?.linkId === linkId;
  return matches ? state : empty;
}
