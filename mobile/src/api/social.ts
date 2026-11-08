/**
 * Sign in with Google / Apple: the endpoints under /auth/social.
 *
 * The types mirror backend/app/domains/auth/social_schemas.py. Nothing here talks to
 * a provider; the native SDKs are in src/social/nativeProviders.ts. Credentials and
 * the onboarding token travel only in these request bodies.
 */

import type { UserProfile } from "./auth";
import { apiRequest } from "./client";
import type { TokenPair } from "./tokens";

export type SocialProvider = "google" | "apple";

/** What the phone got from a provider for one attempt. */
export type ProviderCredential =
  | { provider: "google"; authorization_code: string }
  | {
      provider: "apple";
      identity_token: string;
      /** The raw nonce from requestNonce(), the one Apple was given. */
      nonce: string;
      authorization_code?: string;
      first_name?: string;
      last_name?: string;
    };

/** Which providers this server can complete. Public identifiers only; no secrets. */
export type ProviderAvailability = {
  google: { enabled: boolean; ios_client_id: string | null; web_client_id: string | null };
  apple: { enabled: boolean };
};

/** A verified identity with no Aures account yet. */
export type OnboardingOffer = {
  token: string;
  expires_in: number;
  provider: SocialProvider;
  email: string | null;
  email_is_usable: boolean;
  is_private_email: boolean;
  first_name: string | null;
  suggested_username: string | null;
};

export type SocialSignInResponse =
  | { status: "signed_in"; user: UserProfile; tokens: TokenPair; onboarding: null }
  | { status: "onboarding"; user: null; tokens: null; onboarding: OnboardingOffer };

export type SignInMethods = {
  has_password: boolean;
  providers: { provider: SocialProvider; email: string | null; created_at: string }[];
};

/** How the signed-in account can sign in (which providers are attached, whether it has a password). */
export function fetchSignInMethods(): Promise<SignInMethods> {
  return apiRequest<SignInMethods>("/users/me/sign-in-methods");
}

/** Provider calls happen on the server, so allow longer than a plain request. */
const SOCIAL_TIMEOUT_MS = 30_000;

export function fetchProviders(): Promise<ProviderAvailability> {
  return apiRequest<ProviderAvailability>("/auth/social/providers", {
    anonymous: true,
    timeoutMs: 10_000,
  });
}

/** A single-use nonce for one Apple attempt. */
export function requestNonce(): Promise<{ nonce: string; expires_in: number }> {
  return apiRequest("/auth/social/nonce", {
    method: "POST",
    anonymous: true,
    timeoutMs: SOCIAL_TIMEOUT_MS,
  });
}

export function socialLogin(credential: ProviderCredential): Promise<SocialSignInResponse> {
  return apiRequest<SocialSignInResponse>("/auth/social/login", {
    method: "POST",
    body: credential,
    anonymous: true,
    timeoutMs: SOCIAL_TIMEOUT_MS,
  });
}

export type CompleteSignupInput = {
  onboarding_token: string;
  username: string;
  first_name?: string;
  /** Only when the provider gave no usable address. */
  email?: string;
  timezone?: string;
  locale?: string;
};

export function socialComplete(input: CompleteSignupInput): Promise<{
  user: UserProfile;
  tokens: TokenPair;
}> {
  return apiRequest("/auth/social/complete", {
    method: "POST",
    body: input,
    anonymous: true,
    timeoutMs: SOCIAL_TIMEOUT_MS,
  });
}

/** Sign in to an Aures account the person already has, and attach the identity to it. */
export function socialLinkExisting(input: {
  onboarding_token: string;
  email: string;
  password: string;
}): Promise<{ user: UserProfile; tokens: TokenPair }> {
  return apiRequest("/auth/social/link-existing", {
    method: "POST",
    body: input,
    anonymous: true,
    timeoutMs: SOCIAL_TIMEOUT_MS,
  });
}
