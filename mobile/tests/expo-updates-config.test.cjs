// Run with node --test tests/expo-updates-config.test.cjs.
//
// Expo Updates for the internal TestFlight app: what the build and `eas update` must agree
// on. These read the real config files and run the real pre-publish check with its input
// supplied by the test; nothing reaches EAS. Whether an update actually arrives on a phone
// is the owner's device check.
/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const json = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const { evaluate, parseEnvList } = require(path.join(root, 'scripts/check-staging-update.cjs'));

const eas = json('eas.json');
const app = json('app.json').expo;
const pkg = json('package.json');
const profile = eas.build['testflight-staging'];
const STAGING = 'https://proje-1-t6lh.onrender.com';
const goodEnv = `AURES_APPLE_SIGN_IN=1\nAURES_GOOGLE_IOS_URL_SCHEME=com.googleusercontent.apps.x\nEXPO_PUBLIC_API_URL=${STAGING}\n`;
const check = (overrides = {}) => evaluate({ easJson: eas, appJson: json('app.json'), envListText: goodEnv, ...overrides });

test('expo-updates is installed at the SDK 57 version, through the Expo installer\'s ~ range', () => {
  assert.match(pkg.dependencies['expo-updates'], /^~57\./);
  assert.match(pkg.dependencies.expo, /^~57\./);
  const lock = json('package-lock.json');
  assert.match(lock.packages['node_modules/expo-updates'].version, /^57\./);
});

test('the app points at this Expo project\'s update server and uses the fingerprint runtime version', () => {
  assert.equal(app.extra.eas.projectId, '751aebe3-68ef-4617-ac03-9060ce2d0d81');
  assert.equal(app.updates.url, `https://u.expo.dev/${app.extra.eas.projectId}`);
  // Every native input (plugins, native modules, config) is hashed, so an update only
  // reaches a build with the same native side. A fixed string would not.
  assert.deepEqual(app.runtimeVersion, { policy: 'fingerprint' });
  // Nothing turns updates off, delays launch, or hand-sets a channel header in the app:
  // the channel comes from the build profile.
  assert.equal(app.updates.enabled, undefined);
  assert.equal(app.updates.requestHeaders, undefined);
});

test('the TestFlight build has its own channel, and reads the same environment an update will', () => {
  assert.equal(profile.channel, 'testflight-staging');
  assert.equal(profile.environment, 'production');
  assert.equal(profile.distribution, 'store');
  assert.equal(profile.autoIncrement, true);
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
});

test('the pre-publish check passes when the environment has the API URL and both switches', () => {
  assert.deepEqual(check(), []);
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

test('it stops an update whose runtime version could not match the build (a native switch missing)', () => {
  for (const name of ['AURES_APPLE_SIGN_IN', 'AURES_GOOGLE_IOS_URL_SCHEME']) {
    const problems = check({ envListText: goodEnv.split('\n').filter((l) => !l.startsWith(name)).join('\n') });
    assert.equal(problems.length, 1, name);
    assert.match(problems[0], new RegExp(`no ${name}`));
  }
});

test('it stops when the config no longer lines up: channel, environment, runtime policy, update url', () => {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const noChannel = clone(eas); delete noChannel.build['testflight-staging'].channel;
  assert.match(check({ easJson: noChannel }).join(), /channel/);
  const noEnvironment = clone(eas); delete noEnvironment.build['testflight-staging'].environment;
  assert.match(check({ easJson: noEnvironment }).join(), /does not pin "environment"/);
  const fixed = clone(json('app.json')); fixed.expo.runtimeVersion = '1.0.0';
  assert.match(check({ appJson: fixed }).join(), /fingerprint/);
  const wrongUrl = clone(json('app.json')); wrongUrl.expo.updates.url = 'https://u.expo.dev/other';
  assert.match(check({ appJson: wrongUrl }).join(), /updates\.url/);
  assert.match(evaluate({ easJson: { build: {} }, appJson: json('app.json'), envListText: goodEnv }).join(), /no "testflight-staging"/);
});

test('the environment list is read as NAME=value lines and nothing else', () => {
  const vars = parseEnvList('\nEnvironment: production\nA_B=1\nlower=2\nC=\n  D_E=x=y  \n');
  assert.deepEqual({ ...vars }, { A_B: '1', C: '', D_E: 'x=y' });
});

test('the publish script runs the check first, then publishes iOS to the staging channel from the production environment', () => {
  const publish = pkg.scripts['update:staging'];
  assert.ok(publish.startsWith('node scripts/check-staging-update.cjs && '));
  assert.match(publish, /eas-cli@latest update --platform ios --channel testflight-staging --environment production$/);
  assert.equal(pkg.scripts['update:check'], 'node scripts/check-staging-update.cjs');
  // The message is left to the person publishing: `npm run update:staging -- --message "..."`.
  assert.doesNotMatch(publish, /--message/);
});

test('the check only reads from EAS: no variable is written, no update or build is started', () => {
  const source = readFileSync(path.join(root, 'scripts/check-staging-update.cjs'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(code, /"env:list"/);
  assert.doesNotMatch(code.split('function main')[1], /env:set|"update"|"build"|env:create|env:delete/);
});
