import { useMemo, useSyncExternalStore } from "react";

import { initialWorkoutFeedbackState } from "./workoutFeedback";
import type { WorkoutFeedbackState } from "./workoutFeedback";
import { workoutFeedbackStore } from "./workoutFeedbackSession";

/**
 * The feedback state, but only while it belongs to this screen's account,
 * connection and workout. If the store still holds another context for a
 * moment, the closed state is returned instead, so nothing of it is ever drawn.
 */
export function useWorkoutFeedback(
  userId: string | null,
  linkId: string,
  workoutId: string,
): WorkoutFeedbackState {
  const state = useSyncExternalStore(workoutFeedbackStore.subscribe, workoutFeedbackStore.getSnapshot);
  const closed = useMemo(() => initialWorkoutFeedbackState(), []);
  const { context } = state;
  const mine =
    userId !== null &&
    context !== null &&
    context.userId === userId &&
    context.linkId === linkId &&
    context.workoutId === workoutId;
  return mine ? state : closed;
}
