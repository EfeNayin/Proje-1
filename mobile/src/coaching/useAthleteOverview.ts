import { useMemo, useSyncExternalStore } from "react";

import { athleteOverviewStore } from "./athleteOverviewSession";
import { initialOverviewState } from "./athleteOverview";
import type { OverviewState } from "./athleteOverview";

/**
 * The roster overview for the signed-in user. If the store still holds another
 * account's data for a moment (before this account's screen has bound it), an
 * empty state is returned instead, so nothing of theirs is ever drawn.
 */
export function useAthleteOverview(userId: string | null): OverviewState {
  const state = useSyncExternalStore(athleteOverviewStore.subscribe, athleteOverviewStore.getSnapshot);
  const empty = useMemo(() => initialOverviewState(userId), [userId]);
  return state.userId === userId ? state : empty;
}
