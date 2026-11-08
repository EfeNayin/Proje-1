#!/usr/bin/env node
/**
 * Pre-flight for `npm run update:staging`: stops an update that could never reach the
 * installed TestFlight app, or that would crash it, before anything is published.
 *
 * Why it exists. `eas update` (SDK 55+) is given `--environment production` and then uses
 * ONLY that EAS environment's variables: not the build profile's `env` in eas.json, and not
 * the local .env. Two things hang on those variables:
 *
 *  - EXPO_PUBLIC_API_URL is inlined into the JavaScript. src/config.ts throws at startup
 *    when it is missing, so an update published without it would crash the app on launch.
 *  - AURES_APPLE_SIGN_IN / AURES_GOOGLE_IOS_URL_SCHEME decide which native plugins app.config.js
 *    adds. The runtime version is a fingerprint of that config, so an update made without them
 *    gets a runtime version no installed build has and is never delivered.
 *
 * It reads the variable names and plaintext values from EAS (read-only) and compares them
 * with eas.json. It never prints a value that is not already public in eas.json.
 */
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PROFILE = "testflight-staging";
const NATIVE_SWITCHES = ["AURES_APPLE_SIGN_IN", "AURES_GOOGLE_IOS_URL_SCHEME"];

/** `NAME=value` lines (eas env:list --format short) to an object. Other lines are ignored. */
function parseEnvList(text) {
  const vars = {};
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) vars[match[1]] = match[2];
  }
  return vars;
}

/**
 * The problems that would make the update unreachable or broken, as readable lines.
 * An empty list means the update can go out.
 */
function evaluate({ easJson, appJson, envListText }) {
  const problems = [];
  const profile = easJson?.build?.[PROFILE];
  if (!profile) return [`eas.json has no "${PROFILE}" build profile.`];

  const environment = profile.environment;
  const apiUrl = profile.env?.EXPO_PUBLIC_API_URL;
  if (!environment) problems.push(`The "${PROFILE}" profile does not pin "environment", so builds and updates could read different variables.`);
  if (profile.channel !== PROFILE) problems.push(`The "${PROFILE}" profile's channel is "${profile.channel ?? "(none)"}", not "${PROFILE}".`);
  if (!/^https:\/\//.test(apiUrl ?? "")) problems.push(`The profile's EXPO_PUBLIC_API_URL is not an https URL.`);

  const expo = appJson?.expo ?? {};
  if (expo.runtimeVersion?.policy !== "fingerprint") problems.push(`app.json runtimeVersion is not the "fingerprint" policy.`);
  const projectId = expo.extra?.eas?.projectId;
  if (!projectId || expo.updates?.url !== `https://u.expo.dev/${projectId}`) {
    problems.push(`app.json updates.url is not https://u.expo.dev/<the Expo project id>.`);
  }

  const vars = parseEnvList(envListText);
  if (!(vars.EXPO_PUBLIC_API_URL ?? "").length) {
    problems.push(
      `The EAS "${environment}" environment has no EXPO_PUBLIC_API_URL, so an update would start without an API URL and crash. ` +
        `Set it once: npx eas-cli@latest env:set --name EXPO_PUBLIC_API_URL --value ${apiUrl} --environment ${environment} --visibility plaintext`,
    );
  } else if (vars.EXPO_PUBLIC_API_URL !== apiUrl) {
    problems.push(`The EAS "${environment}" EXPO_PUBLIC_API_URL differs from the profile's (${apiUrl}); a build and an update would talk to different servers.`);
  }
  for (const name of NATIVE_SWITCHES) {
    if (!(name in vars)) {
      problems.push(`The EAS "${environment}" environment has no ${name}, so the update's runtime version would not match the build's and it would never arrive.`);
    }
  }
  return problems;
}

function main() {
  const root = path.resolve(__dirname, "..");
  const easJson = JSON.parse(readFileSync(path.join(root, "eas.json"), "utf8"));
  const appJson = JSON.parse(readFileSync(path.join(root, "app.json"), "utf8"));
  const environment = easJson?.build?.[PROFILE]?.environment ?? "production";

  const listed = spawnSync("npx", ["eas-cli@latest", "env:list", environment, "--format", "short"], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (listed.status !== 0) {
    console.error(`Could not read the EAS "${environment}" environment (are you logged in? run: npx eas-cli@latest login).`);
    console.error(String(listed.stderr || listed.stdout || "").trim().split(/\r?\n/).slice(-3).join("\n"));
    process.exit(1);
  }

  const problems = evaluate({ easJson, appJson, envListText: listed.stdout });
  if (problems.length) {
    console.error(`Not publishing: ${problems.length} problem${problems.length === 1 ? "" : "s"}.`);
    for (const problem of problems) console.error(` - ${problem}`);
    process.exit(1);
  }
  console.log(`OK: the EAS "${environment}" environment has the staging API URL and the native switches; channel ${PROFILE}.`);
}

module.exports = { evaluate, parseEnvList };
if (require.main === module) main();
