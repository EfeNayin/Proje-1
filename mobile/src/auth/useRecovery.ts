import { useSyncExternalStore } from "react";

import type { RecoveryState } from "./recovery";
import { recoveryStore } from "./recoverySession";

export function useRecovery(): RecoveryState {
  return useSyncExternalStore(recoveryStore.subscribe, recoveryStore.getSnapshot);
}
