import { useMemo, useSyncExternalStore } from "react";

import { initialReceivedFeedbackState } from "./receivedFeedback";
import type { ReceivedFeedbackState } from "./receivedFeedback";
import { receivedFeedbackStore } from "./receivedFeedbackSession";

/** The feedback state, but only while it belongs to this account and workout. */
export function useReceivedFeedback(userId: string | null, workoutId: string): ReceivedFeedbackState {
  const state = useSyncExternalStore(receivedFeedbackStore.subscribe, receivedFeedbackStore.getSnapshot);
  const empty = useMemo(() => initialReceivedFeedbackState(), []);
  const { scope } = state;
  const mine = userId !== null && scope !== null && scope.userId === userId && scope.workoutId === workoutId;
  return mine ? state : empty;
}
