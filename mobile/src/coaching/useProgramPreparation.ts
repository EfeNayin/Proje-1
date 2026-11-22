import { useMemo, useSyncExternalStore } from "react";

import { initialProgramPreparationState } from "./programPreparation";
import type { ProgramPreparationState } from "./programPreparation";
import { programPreparationStore } from "./programPreparationSession";

/**
 * The preparation state for the signed-in user and one connection. If the store still
 * holds another account's or another connection's data for a moment (before this screen
 * has bound it), an empty state is returned instead, so nothing of theirs is ever drawn.
 */
export function useProgramPreparation(
  userId: string | null,
  linkId: string | null,
): ProgramPreparationState {
  const state = useSyncExternalStore(
    programPreparationStore.subscribe,
    programPreparationStore.getSnapshot,
  );
  const empty = useMemo(() => initialProgramPreparationState(userId, linkId), [userId, linkId]);
  return state.userId === userId && state.linkId === linkId ? state : empty;
}
