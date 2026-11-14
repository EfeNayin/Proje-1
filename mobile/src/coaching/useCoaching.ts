import { useMemo, useSyncExternalStore } from "react";

import { coachingStore } from "./coachingSession";
import { initialCoachingState } from "./coachingStore";
import type { CoachingState } from "./coachingStore";

/**
 * The coaching state for the signed-in user. If the store still holds another
 * account's data for a moment (before this account's screen has bound it), an
 * empty state is returned instead, so nothing of theirs is ever drawn.
 */
export function useCoaching(userId: string | null): CoachingState {
  const state = useSyncExternalStore(coachingStore.subscribe, coachingStore.getSnapshot);
  const empty = useMemo(() => initialCoachingState(userId), [userId]);
  return state.userId === userId ? state : empty;
}
