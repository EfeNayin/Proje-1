import { useMemo, useSyncExternalStore } from "react";

import { initialProgramOffersState } from "./programOffers";
import type { ProgramOffersState } from "./programOffers";
import { programOffersStore } from "./programOffersSession";

/**
 * The program-offer state for the signed-in user. If the store still holds
 * another account's data for a moment (before this account's screen has bound
 * it), an empty state is returned instead, so nothing of theirs is ever drawn.
 */
export function useProgramOffers(userId: string | null): ProgramOffersState {
  const state = useSyncExternalStore(programOffersStore.subscribe, programOffersStore.getSnapshot);
  const empty = useMemo(() => initialProgramOffersState(userId), [userId]);
  return state.userId === userId ? state : empty;
}
