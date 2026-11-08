/**
 * The two native SDKs behind one small interface. This is the only file that touches
 * them, and it never loads them eagerly: a build without a module (Expo Go has no Google
 * module, a build made before the capability was added has no Apple one) must still start
 * and sign in with email, so each is required inside a function and a failed require means
 * "not available", not a crash at launch.
 *
 * iOS only for this release: every function says unavailable on any other platform.
 *
 * What is requested and kept:
 *  - Scopes are identity only (name, email). Nothing is requested "on behalf of" the person.
 *  - Nothing the SDKs return is stored. Google's serverAuthCode and Apple's identityToken /
 *    authorizationCode are handed to the caller, which sends them to the Aures server once.
 *  - After Google returns, its own SDK session is signed out: Aures has its own session, and
 *    a Google session left behind on the device would be one more credential to keep.
 */

import { Platform } from "react-native";

import { SocialCancelledError, SocialUnavailableError } from "./errors";
import { subscribeToRevocation } from "./revocation";

export type AppleResult = {
  identityToken: string;
  authorizationCode: string | null;
  /** Apple reveals the name on the first authorization only. */
  firstName: string | null;
  lastName: string | null;
};

export type GoogleResult = {
  /** One-time server auth code; the server redeems it. Never an ID token from the phone. */
  authorizationCode: string;
};

export type NativeProviders = {
  appleAvailable: () => Promise<boolean>;
  googleAvailable: () => boolean;
  signInWithApple: (nonce: string) => Promise<AppleResult>;
  signInWithGoogle: (config: { webClientId: string; iosClientId: string }) => Promise<GoogleResult>;
  /** Calls `onRevoked` when the person revokes Aures in Apple ID settings. Returns an unsubscribe. */
  watchAppleRevocation: (onRevoked: () => void) => () => void;
};

const CANCEL_CODES = new Set(["ERR_REQUEST_CANCELED", "ERR_CANCELED", "SIGN_IN_CANCELLED", "-5"]);

function codeOf(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" || typeof code === "number" ? String(code) : null;
}

type AppleModule = typeof import("expo-apple-authentication");
type GoogleModule = typeof import("@react-native-google-signin/google-signin");

function loadApple(): AppleModule | null {
  if (Platform.OS !== "ios") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy: the module may be absent from this build
    return require("expo-apple-authentication") as AppleModule;
  } catch {
    return null;
  }
}

function loadGoogle(): GoogleModule | null {
  if (Platform.OS !== "ios") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy: the module may be absent from this build
    return require("@react-native-google-signin/google-signin") as GoogleModule;
  } catch {
    return null;
  }
}

export const nativeProviders: NativeProviders = {
  async appleAvailable() {
    const apple = loadApple();
    if (!apple) return false;
    try {
      return await apple.isAvailableAsync();
    } catch {
      return false;
    }
  },

  googleAvailable() {
    return loadGoogle() !== null;
  },

  async signInWithApple(nonce) {
    const apple = loadApple();
    if (!apple) throw new SocialUnavailableError();
    let credential;
    try {
      credential = await apple.signInAsync({
        requestedScopes: [
          apple.AppleAuthenticationScope.FULL_NAME,
          apple.AppleAuthenticationScope.EMAIL,
        ],
        // The server's single-use nonce, as given: the identity token carries it back.
        nonce,
      });
    } catch (error) {
      if (CANCEL_CODES.has(codeOf(error) ?? "")) throw new SocialCancelledError();
      throw error;
    }
    if (!credential.identityToken) throw new Error("Apple did not return an identity token.");
    return {
      identityToken: credential.identityToken,
      authorizationCode: credential.authorizationCode,
      firstName: credential.fullName?.givenName ?? null,
      lastName: credential.fullName?.familyName ?? null,
    };
  },

  async signInWithGoogle(config) {
    const google = loadGoogle();
    if (!google) throw new SocialUnavailableError();
    const { GoogleSignin } = google;
    GoogleSignin.configure({
      webClientId: config.webClientId,
      iosClientId: config.iosClientId,
      // Required for the SDK to return a serverAuthCode. The server uses it once to ask
      // Google who signed in; it never asks for a refresh token to keep.
      offlineAccess: true,
    });
    let response;
    try {
      response = await GoogleSignin.signIn();
    } catch (error) {
      if (CANCEL_CODES.has(codeOf(error) ?? "")) throw new SocialCancelledError();
      throw error;
    }
    if (response.type !== "success") throw new SocialCancelledError();
    const code = response.data.serverAuthCode;
    // Best effort: leave no Google session behind on the device.
    void GoogleSignin.signOut().catch(() => undefined);
    if (!code) throw new Error("Google did not return an authorization code.");
    return { authorizationCode: code };
  },

  watchAppleRevocation(onRevoked) {
    const apple = loadApple();
    if (!apple) return () => undefined;
    // The cleanup is guarded too, not only the registration (see social/revocation.ts).
    return subscribeToRevocation((listener) => apple.addRevokeListener(listener), onRevoked);
  },
};
