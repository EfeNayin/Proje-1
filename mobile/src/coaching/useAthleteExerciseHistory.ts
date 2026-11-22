import { useMemo, useSyncExternalStore } from "react";

import { athleteExerciseHistoryStore } from "./athleteExerciseHistorySession";
import { initialAthleteExerciseHistoryState } from "./athleteExerciseHistory";
import type { AthleteExerciseHistoryState } from "./athleteExerciseHistory";

/**
 * The open panel's state, but only while it belongs to this screen's account,
 * connection and workout. If the store still holds another context for a moment,
 * the closed state is returned instead, so nothing of it is ever drawn.
 */
export function useAthleteExerciseHistory(
  userId: string | null,
  linkId: string,
  workoutId: string,
): AthleteExerciseHistoryState {
  const state = useSyncExternalStore(
    athleteExerciseHistoryStore.subscribe,
    athleteExerciseHistoryStore.getSnapshot,
  );
  const closed = useMemo(() => initialAthleteExerciseHistoryState(), []);
  const { context } = state;
  const mine =
    userId !== null &&
    context !== null &&
    context.userId === userId &&
    context.linkId === linkId &&
    context.workoutId === workoutId;
  return mine ? state : closed;
}
