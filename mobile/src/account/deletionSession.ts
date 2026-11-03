import { deleteAccount } from "../api/auth";
import { currentAuthEpoch } from "../api/client";
import { createAccountDeletionStore } from "./deletion";

/**
 * The app-wide deletion store. A single instance so that a deletion started on the
 * screen carries on if the screen is left, and so that AuthContext can reset it at
 * sign-out and register how the session ends once the server confirms.
 */
export const accountDeletionStore = createAccountDeletionStore({
  deleteAccount,
  currentEpoch: currentAuthEpoch,
});
