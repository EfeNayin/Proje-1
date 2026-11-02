import { useMemo, useSyncExternalStore } from "react";

import { initialDailyCheckinState } from "./dailyCheckin";
import type { DailyCheckinState } from "./dailyCheckin";
import { dailyCheckinStore } from "./dailyCheckinSession";

/**
 * The check-in state for the signed-in user. If the store still holds another account's
 * data for a moment (before this screen has bound it), an empty state is returned, so
 * nothing of theirs is ever drawn.
 */
export function useDailyCheckin(userId: string | null): DailyCheckinState {
  const state = useSyncExternalStore(dailyCheckinStore.subscribe, dailyCheckinStore.getSnapshot);
  const empty = useMemo(() => initialDailyCheckinState(userId), [userId]);
  return state.userId === userId ? state : empty;
}
