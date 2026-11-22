import { fetchProviders, requestNonce } from "../api/social";
import { createAttemptGate } from "../auth/attemptGate";
import { nativeProviders } from "./nativeProviders";
import { createOnboardingStore } from "./onboarding";
import type { ProviderDeps } from "./providerSignIn";

/** The collaborators the app uses; tests build their own. */
export const providerDeps: ProviderDeps = {
  native: nativeProviders,
  fetchProviders,
  requestNonce,
};

/**
 * The offer for a first provider sign-in, held in memory only. AuthContext resets it
 * whenever the account changes, and the onboarding screen clears it when it is left.
 */
export const onboardingStore = createOnboardingStore();

/**
 * One sign-in attempt at a time across the sign-in screen and the onboarding screens:
 * email, Google, Apple, creating the account and linking all take this gate.
 */
export const signInGate = createAttemptGate();
