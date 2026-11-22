/**
 * `expo-secure-store` stand-in for the browser preview. Development only.
 *
 * The real module is native (Keychain / Keystore); on web it is an empty object,
 * so every read throws and the app can never get past "Unable to connect". The
 * Metro config (metro.config.js) points `expo-secure-store` here on the web
 * platform only. Native builds never load this file.
 *
 * Everything lives in memory: nothing is written to localStorage, cookies or
 * IndexedDB, so a reload or a closed tab ends the session (the next load starts
 * signed out). That is deliberate - a refresh token in browser storage would be
 * readable by any script on the page, which the Keychain never allows.
 *
 * Outside a development bundle it refuses to work, so a production web export
 * can never keep tokens this way.
 */

const memory = new Map<string, string>();

function ensureDevelopment(): void {
  if (!__DEV__) {
    throw new Error("The browser preview storage is available in development builds only.");
  }
}

export async function getItemAsync(key: string): Promise<string | null> {
  ensureDevelopment();
  return memory.get(key) ?? null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  ensureDevelopment();
  memory.set(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  ensureDevelopment();
  memory.delete(key);
}
