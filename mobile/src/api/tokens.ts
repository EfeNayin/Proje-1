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

/**
 * Every write and delete goes through one queue and runs in the order it was
 * requested, each finishing before the next starts.
 *
 * SecureStore calls are separate native round trips with no ordering promise
 * between them. Left alone, a write that is already on its way when the user
 * signs out can finish after the delete, and the signed-out device then holds
 * credentials again; likewise a delete still pending when the next account signs
 * in can remove that account's tokens. Reads are not queued: a read never
 * changes what is stored, and callers that need to see their own earlier write
 * await it first.
 */
let queue: Promise<unknown> = Promise.resolve();

function serialized<T>(task: () => Promise<T>): Promise<T> {
  // Runs after the previous task whether it succeeded or failed.
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

/** Who wrote what is stored now, so a late cleanup removes only its own write. */
export type TokenOwner = object;
let storedBy: TokenOwner | null = null;

async function write(tokens: TokenPair, owner: TokenOwner): Promise<void> {
  // The refresh token first. If the second write fails, the pair is an old
  // access token with a new refresh token, which the next refresh repairs; the
  // other way round would leave a refresh token the server has already rotated
  // away, and presenting it again looks like theft and ends every session.
  await SecureStore.setItemAsync(REFRESH_KEY, tokens.refresh_token);
  storedBy = owner;
  await SecureStore.setItemAsync(ACCESS_KEY, tokens.access_token);
}

async function wipe(): Promise<void> {
  storedBy = null;
  await SecureStore.deleteItemAsync(ACCESS_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

/**
 * Writes the pair only if `isCurrent()` is still true when this write's turn
 * comes. The check runs inside the queue, directly before the write, so nothing
 * can slip in between it and the write (a check made before queueing could not
 * promise that). Resolves false when it was skipped.
 */
export function saveTokensIf(
  tokens: TokenPair,
  owner: TokenOwner,
  isCurrent: () => boolean,
): Promise<boolean> {
  return serialized(async () => {
    if (!isCurrent()) return false;
    await write(tokens, owner);
    return true;
  });
}

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_KEY);
}

export function clearTokens(): Promise<void> {
  return serialized(wipe);
}

/** Removes the stored pair only if `owner` wrote it and nothing has replaced it since. */
export function clearTokensIfOwner(owner: TokenOwner): Promise<void> {
  return serialized(async () => {
    if (storedBy === owner) await wipe();
  });
}

/**
 * Reads the refresh token and removes both tokens in one step, so a write
 * queued earlier is included (the token read is the newest one) and none can
 * land between the read and the delete. Signing out uses it: the returned token
 * is what lets the server end the session.
 */
export function takeRefreshToken(): Promise<string | null> {
  return serialized(async () => {
    let token: string | null = null;
    try {
      token = await SecureStore.getItemAsync(REFRESH_KEY);
    } finally {
      // Cleared even when the read failed; the caller is leaving this session.
      await wipe();
    }
    return token;
  });
}
