import { confirmPasswordRecovery, requestPasswordRecovery } from "../api/auth";
import { currentAuthEpoch } from "../api/client";
import { showPasswordChangedNotice } from "./passwordChangedNotice";
import { createRecoveryStore } from "./recovery";

/**
 * The app-wide recovery store. AuthContext resets it whenever the account changes, and
 * the screen resets it when it is left, so an address, a half-finished flow or a late
 * answer never outlives the visit that started it.
 */
export const recoveryStore = createRecoveryStore({
  requestCode: requestPasswordRecovery,
  confirmReset: confirmPasswordRecovery,
  currentEpoch: currentAuthEpoch,
  now: () => Date.now(),
  onChanged: showPasswordChangedNotice,
});
