/**
 * App configuration.
 *
 * The API URL comes from EXPO_PUBLIC_API_URL in .env. Anything prefixed with
 * EXPO_PUBLIC_ is inlined at build time and readable from the client — fine
 * for a base URL, never for secrets.
 *
 * It must be the machine's LAN address (192.168.x.x), not localhost: on a
 * phone, localhost is the phone itself.
 */

const url = process.env.EXPO_PUBLIC_API_URL;

if (!url) {
  throw new Error(
    "EXPO_PUBLIC_API_URL is not set. Copy .env.example to .env and put your " +
      "machine's LAN IP in it, e.g. http://192.168.1.34:8000",
  );
}

export const API_URL = url.replace(/\/$/, "");
export const API_PREFIX = "/api/v1";
