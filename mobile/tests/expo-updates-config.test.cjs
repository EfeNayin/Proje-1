// Run with node --test tests/expo-updates-config.test.cjs.
//
// Expo Updates for the internal TestFlight app: what the build and `eas update` must agree
// on. These read the real config files and run the real pre-publish check with its input
// supplied by the test; nothing reaches EAS. Whether an update actually arrives on a phone
// is the owner's device check.
//
// History these guard against: build ddc691d2 failed in "Configure expo-updates" because the
// "fingerprint" runtime policy was recomputed on EAS after it generated the iOS project and
// came out different from the one computed on Windows. The policy is "appVersion" now.
/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const json = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const { evaluate, evaluateTarget, parseEnvList, parseResolvedRuntime, NATIVE_RELEVANT } =
  require(path.join(root, 'scripts/check-staging-update.cjs'));

const eas = json('eas.json');
const app = json('app.json').expo;
const pkg = json('package.json');
const profile = eas.build['testflight-staging'];
const STAGING = 'https://proje-1-t6lh.onrender.com';
const COMMIT = 'b8f8458f3cbe7318df4a78d999e9d01a2ceedbdb';
const goodEnv = `AURES_APPLE_SIGN_IN=1\nAURES_GOOGLE_IOS_URL_SCHEME=com.googleusercontent.apps.x\nEXPO_PUBLIC_API_URL=${STAGING}\n`;
const check = (overrides = {}) => evaluate({ easJson: eas, appJson: json('app.json'), envListText: goodEnv, ...overrides });
const clone = (value) => JSON.parse(JSON.stringify(value));

const build = (number, runtime, extra = {}) => ({
  id: `id-${number}`, status: 'FINISHED', appVersion: '1.0.0', appBuildVersion: String(number),
  gitCommitHash: COMMIT, updateChannel: { name: 'testflight-staging' },
  runtime: runtime === null ? null : { version: runtime }, ...extra,
});
const target = (overrides = {}) => evaluateTarget({
  intended: '1.0.0', appVersion: '1.0.0', builds: [build(5, '1.0.0')], changedFiles: [], ...overrides,
});

test('expo-updates is installed at the SDK 57 version, through the Expo installer\'s ~ range', () => {
  assert.match(pkg.dependencies['expo-updates'], /^~57\./);
  assert.match(pkg.dependencies.expo, /^~57\./);
  assert.match(json('package-lock.json').packages['node_modules/expo-updates'].version, /^57\./);
});

test('the app points at this Expo project\'s update server and takes its runtime version from the app version', () => {
  assert.equal(app.extra.eas.projectId, '751aebe3-68ef-4617-ac03-9060ce2d0d81');
  assert.equal(app.updates.url, `https://u.expo.dev/${app.extra.eas.projectId}`);
  // Not "fingerprint": EAS recomputes it after generating ios/ and it cannot match a Windows
  // checkout, which failed build ddc691d2. Not a fixed string either: the policy follows `version`.
  assert.deepEqual(app.runtimeVersion, { policy: 'appVersion' });
  assert.match(app.version, /^\d+\.\d+\.\d+$/);
  // Nothing turns updates off or hand-sets a channel header in the app: the channel comes
  // from the build profile.
  assert.equal(app.updates.enabled, undefined);
  assert.equal(app.updates.requestHeaders, undefined);
  assert.doesNotMatch(readFileSync(path.join(root, 'app.json'), 'utf8'), /fingerprint/);
});

test('the TestFlight build has its own channel, and reads the same environment an update will', () => {
  assert.equal(profile.channel, 'testflight-staging');
  assert.equal(profile.environment, 'production');
  assert.equal(profile.distribution, 'store');
  assert.equal(profile.autoIncrement, true); // the build number only; `version` is bumped by hand
  assert.equal(eas.cli.appVersionSource, 'remote');
  assert.equal(Object.keys(eas.build).join(), 'testflight-staging');
});

test('what was already set stays: bundle id, owner, project, staging API, the sign-in plugin switches', () => {
  assert.equal(app.ios.bundleIdentifier, 'com.efenayin.aures');
  assert.equal(app.owner, 'efe_nayn');
  assert.equal(app.slug, 'aures');
  assert.equal(profile.env.EXPO_PUBLIC_API_URL, STAGING);
  const source = readFileSync(path.join(root, 'app.config.js'), 'utf8');
  assert.match(source, /AURES_APPLE_SIGN_IN === "1"/);
  assert.match(source, /AURES_GOOGLE_IOS_URL_SCHEME/);
  // Provider settings and secrets stay out of the repository's build profile.
  assert.doesNotMatch(readFileSync(path.join(root, 'eas.json'), 'utf8'), /GOOGLE|APPLE|SECRET/);
});

test('app.config.js leaves the update settings alone, so app.json is the one place they are written', () => {
  const config = require(path.join(root, 'app.config.js'))({ config: json('app.json').expo });
  assert.deepEqual(config.runtimeVersion, app.runtimeVersion);
  assert.deepEqual(config.updates, app.updates);
  assert.equal(config.version, app.version);
});

test('the configuration check passes with the API URL in the environment, whatever else is or is not there', () => {
  assert.deepEqual(check(), []);
  // The sign-in switches shaped the old fingerprint; the runtime version no longer depends on them.
  assert.deepEqual(check({ envListText: `EXPO_PUBLIC_API_URL=${STAGING}\n` }), []);
});

test('it stops an update with no API URL in the environment, and says how to set it', () => {
  const problems = check({ envListText: goodEnv.replace(/EXPO_PUBLIC_API_URL=.*\n/, '') });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /no EXPO_PUBLIC_API_URL/);
  assert.match(problems[0], /env:set --name EXPO_PUBLIC_API_URL --value https:\/\/proje-1-t6lh\.onrender\.com --environment production --visibility plaintext/);
});

test('it stops an update that would talk to a different server than the build', () => {
  const problems = check({ envListText: goodEnv.replace(STAGING, 'http://localhost:8000') });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /differs from the profile's/);
});

test('it stops when the config no longer lines up: channel, environment, policy, version, update url', () => {
  const noChannel = clone(eas); delete noChannel.build['testflight-staging'].channel;
  assert.match(check({ easJson: noChannel }).join(), /channel/);
  const noEnvironment = clone(eas); delete noEnvironment.build['testflight-staging'].environment;
  assert.match(check({ easJson: noEnvironment }).join(), /does not pin "environment"/);
  const fingerprint = clone(json('app.json')); fingerprint.expo.runtimeVersion = { policy: 'fingerprint' };
  assert.match(check({ appJson: fingerprint }).join(), /not the "appVersion" policy/);
  const fixed = clone(json('app.json')); fixed.expo.runtimeVersion = '1.0.0';
  assert.match(check({ appJson: fixed }).join(), /not the "appVersion" policy/);
  const oddVersion = clone(json('app.json')); oddVersion.expo.version = '1.0';
  assert.match(check({ appJson: oddVersion }).join(), /plain x\.y\.z/);
  const wrongUrl = clone(json('app.json')); wrongUrl.expo.updates.url = 'https://u.expo.dev/other';
  assert.match(check({ appJson: wrongUrl }).join(), /updates\.url/);
  assert.match(evaluate({ easJson: { build: {} }, appJson: json('app.json'), envListText: goodEnv }).join(), /no "testflight-staging"/);
});

test('the environment list and the resolved runtime are read from the CLI output and nothing else', () => {
  const vars = parseEnvList('\nEnvironment: production\nA_B=1\nlower=2\nC=\n  D_E=x=y  \n');
  assert.deepEqual({ ...vars }, { A_B: '1', C: '', D_E: 'x=y' });
  const out = 'env: load .env\n{"runtimeVersion":"1.0.0","fingerprintSources":null,"workflow":"managed"}\n';
  assert.equal(parseResolvedRuntime(out), '1.0.0');
  assert.equal(parseResolvedRuntime('error: nothing here\n'), null);
  assert.equal(parseResolvedRuntime('{"runtimeVersion":""}'), null);
  assert.equal(parseResolvedRuntime('{"runtimeVersion":'), null);
});

test('the runtime check passes when the update\'s runtime is the target build\'s', () => {
  const result = target();
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.target.appBuildVersion, '5');
});

test('it stops an update whose runtime differs from the TestFlight build\'s, naming both and what to do', () => {
  // Version bumped for a new build that has not been made yet.
  const ahead = target({ intended: '1.1.0', appVersion: '1.1.0' });
  assert.equal(ahead.problems.length, 1);
  assert.match(ahead.problems[0], /"1\.1\.0"/);
  assert.match(ahead.problems[0], /"1\.0\.0"/);
  assert.match(ahead.problems[0], /build 5/);
  assert.match(ahead.problems[0], /never reach it/);
  assert.match(ahead.problems[0], /bump "version" in app\.json and make a new build/);
  // The build is ahead of what this checkout would publish.
  assert.match(target({ builds: [build(6, '1.2.0')] }).problems.join(), /runtime "1\.2\.0"/);
});

test('it stops when there is no finished build to receive the update, or it was made without expo-updates', () => {
  const none = target({ builds: [] });
  assert.equal(none.problems.length, 1);
  assert.match(none.problems[0], /No finished iOS build on the "testflight-staging" channel/);
  assert.match(none.problems[0], /eas-cli@latest build --platform ios --profile testflight-staging/);
  assert.equal(none.target, null);
  assert.match(target({ builds: [build(3, null)] }).problems.join(), /no runtime version.*without expo-updates/);
  assert.match(target({ builds: undefined }).problems.join(), /No finished iOS build/);
});

test('it stops when the intended runtime cannot be resolved or is not the app version', () => {
  assert.match(target({ intended: null }).problems.join(), /Could not resolve/);
  assert.match(target({ intended: 'da0603471037a33e1fbe4d916036ff5772a983a9' }).problems.join(), /app\.json version is "1\.0\.0"/);
});

test('older builds with another runtime are named as not receiving the update, without stopping it', () => {
  const result = target({ builds: [build(5, '1.0.0'), build(4, '0.9.0'), build(3, '1.0.0'), build(2, null)] });
  assert.deepEqual(result.problems, []);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /build 4 \(runtime 0\.9\.0\)/);
  assert.doesNotMatch(result.warnings[0], /build 3|build 2/);
});

test('native-relevant files changed since the build\'s commit raise a warning about the version bump', () => {
  const result = target({ changedFiles: ['package.json', 'app.json'] });
  assert.deepEqual(result.problems, []); // the runtime still matches: only a person can tell if it was native
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /package\.json, app\.json/);
  assert.match(result.warnings[0], /b8f8458/);
  assert.match(result.warnings[0], /bump "version" in app\.json, make a new signed build, install it, and only then publish/);
  // And when the comparison could not be made.
  const unknown = target({ changedFiles: null });
  assert.deepEqual(unknown.problems, []);
  assert.match(unknown.warnings.join(), /Could not compare the working tree/);
});

test('the files compared are the ones that can change the native app, and not the JavaScript', () => {
  for (const file of ['package.json', 'package-lock.json', 'app.json', 'app.config.js', 'eas.json', 'assets/images/icon.png', 'assets/images/splash-icon.png']) {
    assert.ok(NATIVE_RELEVANT.includes(file), file);
  }
  assert.ok(NATIVE_RELEVANT.every((file) => !/^(app|src)\//.test(file) && !file.startsWith('assets/fonts')));
});

test('publishing runs the full check first, then publishes iOS to the staging channel from the production environment', () => {
  const publish = pkg.scripts['update:staging'];
  assert.ok(publish.startsWith('node scripts/check-staging-update.cjs --target-build && '));
  assert.match(publish, /eas-cli@latest update --platform ios --channel testflight-staging --environment production$/);
  // Before a build there is nothing to compare with, so the standalone check is configuration only.
  assert.equal(pkg.scripts['update:check'], 'node scripts/check-staging-update.cjs');
  // The message is left to the person publishing: `npm run update:staging -- --message "..."`.
  assert.doesNotMatch(publish, /--message/);
});

test('the check only reads: environment list, runtime resolve, build list and git diff; nothing is set, built or published', () => {
  const source = readFileSync(path.join(root, 'scripts/check-staging-update.cjs'), 'utf8');
  const commands = [...source.matchAll(/run\(`([^`]*)`/g)].map((m) => m[1]);
  assert.equal(commands.length, 4);
  const allowed = [
    /^npx eas-cli@latest env:list /,
    /^npx eas-cli@latest env:exec \$\{environment\} "npx expo-updates runtimeversion:resolve --platform ios"$/,
    /^npx eas-cli@latest build:list .* --json --non-interactive$/,
    /^git diff --name-only /,
  ];
  for (const command of commands) assert.ok(allowed.some((pattern) => pattern.test(command)), command);
});
