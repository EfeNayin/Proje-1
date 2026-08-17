/**
 * Token storage.
 *
 * SecureStore keeps values in the iOS Keychain and Android Keystore rather
 * than plain files, which matters for the refresh token: it is long-lived and
 * enough on its own to mint new access tokens.
 *
 * Note that SecureStore is native-only — pressing "w" for web in the Expo CLI
 * will fail here. This app targets phones.
 */

import * as SecureStore from "expo-secure-store";

const ACCESS_KEY = "bodytrack.access_token";
const REFRESH_KEY = "bodytrack.refresh_token";

export type TokenPair = {
  access_token: string;
  refresh_token: string;
};

export async function saveTokens(tokens: TokenPair): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_KEY, tokens.access_token),
    SecureStore.setItemAsync(REFRESH_KEY, tokens.refresh_token),
  ]);
}

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_KEY);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
  ]);
}
