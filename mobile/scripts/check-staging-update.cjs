#!/usr/bin/env node
/**
 * Pre-flight for `npm run update:staging`: stops an update that could never reach the
 * installed TestFlight app, or that would crash it, before anything is published. It only
 * reads (EAS environment, EAS build list, git); it publishes and builds nothing.
 *
 *   node scripts/check-staging-update.cjs                  configuration only (use before a build)
 *   node scripts/check-staging-update.cjs --target-build   configuration, then the intended iOS
 *                                                          runtime against the TestFlight build
 *
 * Runtime version. app.json uses the "appVersion" policy: the runtime version is the app's
 * `version` (1.0.0), so an update reaches every build with that version and no other. It
 * does NOT notice native changes: add or upgrade a native package, add a config plugin,
 * change a permission or the icon/splash and the runtime stays 1.0.0 unless `version` is
 * bumped, and an update could then reach a build that cannot run it. That is why this check
 * compares the runtime the update would get with the one the target build was made with, and
 * lists the native-relevant files that changed since the build's commit. (A "fingerprint"
 * policy was tried and does not work from a Windows checkout: EAS recomputes it after
 * generating the iOS project, finds different hashes, and fails the build.)
 *
 * Environment variables. `eas update` (SDK 55+) is run with `--environment production` and
 * then uses ONLY that EAS environment's variables: not the build profile's `env` in eas.json
 * and not the local .env. EXPO_PUBLIC_API_URL is inlined into the JavaScript and
 * src/config.ts throws at startup when it is missing, so an update published without it
 * would crash the app on launch.
 */
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PROFILE = "testflight-staging";

// Files whose change can mean a different native app (config plugins, native modules, icon
// and splash baked into the binary). JavaScript, screens, fonts and images loaded with
// require() are not native: an update carries them.
const NATIVE_RELEVANT = [
  "package.json",
  "package-lock.json",
  "app.json",
  "app.config.js",
  "eas.json",
  "assets/images/icon.png",
  "assets/images/splash-icon.png",
];

/** `NAME=value` lines (eas env:list --format short) to an object. Other lines are ignored. */
function parseEnvList(text) {
  const vars = {};
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) vars[match[1]] = match[2];
  }
  return vars;
}

/** The runtime version out of `expo-updates runtimeversion:resolve` output, or null. */
function parseResolvedRuntime(output) {
  for (const line of String(output).split(/\r?\n/)) {
    if (!line.startsWith('{"runtimeVersion"')) continue;
    try {
      const value = JSON.parse(line).runtimeVersion;
      return typeof value === "string" && value ? value : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Configuration problems that would make the update unreachable or broken, as readable
 * lines. An empty list means the configuration is right.
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
  if (expo.runtimeVersion?.policy !== "appVersion") problems.push(`app.json runtimeVersion is not the "appVersion" policy.`);
  if (!/^\d+\.\d+\.\d+$/.test(expo.version ?? "")) problems.push(`app.json version "${expo.version}" is not a plain x.y.z, which the runtime version is taken from.`);
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
  return problems;
}

/**
 * The intended iOS runtime against the TestFlight build the update is for.
 *
 *   intended      the runtime this update would be published under (resolved by expo-updates
 *                 with the production EAS environment)
 *   appVersion    app.json's `version`, which the appVersion policy resolves to
 *   builds        finished iOS builds on the channel, newest first (eas build:list --json)
 *   changedFiles  native-relevant files that differ from the target build's commit, or
 *                 null when that could not be worked out
 *
 * Problems stop the publish. Warnings do not: they say what to look at.
 */
function evaluateTarget({ intended, appVersion, builds, changedFiles }) {
  const problems = [];
  const warnings = [];
  let target = null;

  if (!intended) {
    problems.push("Could not resolve the iOS runtime version the update would get.");
  } else if (intended !== appVersion) {
    problems.push(`The update would be published under runtime "${intended}", but app.json version is "${appVersion}".`);
  }

  const list = Array.isArray(builds) ? builds : [];
  if (!list.length) {
    problems.push(
      `No finished iOS build on the "${PROFILE}" channel yet, so nothing can receive this update. ` +
        `Make one first: npx eas-cli@latest build --platform ios --profile ${PROFILE}, then upload it to TestFlight.`,
    );
    return { problems, warnings, target };
  }

  target = list[0];
  const label = `build ${target.appBuildVersion} (version ${target.appVersion})`;
  const runtime = target.runtime?.version;
  if (!runtime) {
    problems.push(`The newest finished build on the channel, ${label}, has no runtime version: it was made without expo-updates and cannot receive updates.`);
  } else if (intended && runtime !== intended) {
    problems.push(
      `Runtime mismatch: this update would be published under "${intended}", but the newest finished build on the channel, ${label}, has runtime "${runtime}". ` +
        `The update would never reach it. If you changed native packages or configuration, bump "version" in app.json and make a new build first; ` +
        `if you only bumped the version, make and install that build before publishing.`,
    );
  }

  const older = list.slice(1).filter((build) => build.runtime?.version && build.runtime.version !== intended);
  if (older.length) {
    warnings.push(
      `Older finished builds with a different runtime will not receive this update: ` +
        older.map((build) => `build ${build.appBuildVersion} (runtime ${build.runtime.version})`).join(", ") + `.`,
    );
  }

  if (changedFiles === null || changedFiles === undefined) {
    warnings.push(
      `Could not compare the working tree with the target build's commit (${String(target.gitCommitHash ?? "unknown").slice(0, 7)}); ` +
        `if it is not in this clone, run "git fetch" and check by hand that no native package or configuration changed since.`,
    );
  } else if (changedFiles.length) {
    warnings.push(
      `Native-relevant files differ from the target build's commit (${String(target.gitCommitHash).slice(0, 7)}): ${changedFiles.join(", ")}. ` +
        `If any of that changed native packages, plugins, permissions, the icon or the splash, the runtime still reads "${intended}" and an update could reach a build that cannot run it: ` +
        `bump "version" in app.json, make a new signed build, install it, and only then publish. If it is JavaScript-only (scripts, JS dependencies), carry on.`,
    );
  }
  return { problems, warnings, target };
}

function run(command, cwd) {
  return spawnSync(command, { cwd, encoding: "utf8", shell: true, maxBuffer: 64 * 1024 * 1024 });
}

function fail(lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

function main() {
  const root = path.resolve(__dirname, "..");
  const easJson = JSON.parse(readFileSync(path.join(root, "eas.json"), "utf8"));
  const appJson = JSON.parse(readFileSync(path.join(root, "app.json"), "utf8"));
  const environment = easJson?.build?.[PROFILE]?.environment ?? "production";

  const listed = run(`npx eas-cli@latest env:list ${environment} --format short`, root);
  if (listed.status !== 0) {
    fail([
      `Could not read the EAS "${environment}" environment (are you logged in? run: npx eas-cli@latest login).`,
      String(listed.stderr || listed.stdout || "").trim().split(/\r?\n/).slice(-3).join("\n"),
    ]);
  }
  const problems = evaluate({ easJson, appJson, envListText: listed.stdout });
  if (problems.length) {
    fail([`Not publishing: ${problems.length} configuration problem${problems.length === 1 ? "" : "s"}.`, ...problems.map((p) => ` - ${p}`)]);
  }
  console.log(`OK (configuration): the EAS "${environment}" environment has the staging API URL; channel ${PROFILE}; runtime policy appVersion.`);
  if (!process.argv.includes("--target-build")) return;

  const resolved = run(`npx eas-cli@latest env:exec ${environment} "npx expo-updates runtimeversion:resolve --platform ios"`, root);
  const intended = parseResolvedRuntime(`${resolved.stdout}\n${resolved.stderr}`);

  const listedBuilds = run(`npx eas-cli@latest build:list --platform ios --channel ${PROFILE} --status finished --limit 10 --json --non-interactive`, root);
  let builds = [];
  try {
    const text = String(listedBuilds.stdout);
    builds = JSON.parse(text.slice(text.indexOf("[")));
  } catch {
    fail([`Could not read the finished iOS builds on the "${PROFILE}" channel.`, String(listedBuilds.stderr || listedBuilds.stdout || "").trim().split(/\r?\n/).slice(-3).join("\n")]);
  }

  let changedFiles = null;
  const commit = builds[0]?.gitCommitHash;
  if (commit && /^[0-9a-f]{40}$/.test(commit)) {
    const diff = run(`git diff --name-only ${commit} -- ${NATIVE_RELEVANT.join(" ")}`, root);
    if (diff.status === 0) changedFiles = String(diff.stdout).split(/\r?\n/).filter(Boolean);
  }

  const result = evaluateTarget({ intended, appVersion: appJson.expo.version, builds, changedFiles });
  if (result.target) {
    const t = result.target;
    console.log(`Target TestFlight build: number ${t.appBuildVersion}, version ${t.appVersion}, runtime ${t.runtime?.version ?? "(none)"}, commit ${String(t.gitCommitHash).slice(0, 7)}. Confirm that number is the one installed from TestFlight.`);
  }
  console.log(`Runtime this update would get: ${intended ?? "(unresolved)"}.`);
  for (const warning of result.warnings) console.warn(`WARNING: ${warning}`);
  if (result.problems.length) {
    fail([`Not publishing: ${result.problems.length} problem${result.problems.length === 1 ? "" : "s"}.`, ...result.problems.map((p) => ` - ${p}`)]);
  }
  console.log("OK (runtime): the update's runtime matches the target build.");
}

module.exports = { evaluate, evaluateTarget, parseEnvList, parseResolvedRuntime, NATIVE_RELEVANT };
if (require.main === module) main();
