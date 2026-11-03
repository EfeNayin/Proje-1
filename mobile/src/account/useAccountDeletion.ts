import { useSyncExternalStore } from "react";

import type { DeletionState } from "./deletion";
import { accountDeletionStore } from "./deletionSession";

export function useAccountDeletion(): DeletionState {
  return useSyncExternalStore(accountDeletionStore.subscribe, accountDeletionStore.getSnapshot);
}
