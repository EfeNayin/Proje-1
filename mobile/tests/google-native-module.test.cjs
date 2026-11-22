/* global __dirname */
// Regression: in a build without Google's native module (My Expo Go) the JS package must never
// be loaded. The package calls TurboModuleRegistry.getEnforcing('RNGoogleSignin') as it loads, so
// requiring it throws; the app asks the native side first with TurboModuleRegistry.get and
// reports Google sign-in as unavailable. The real nativeProviders.ts is loaded here with the
// native pieces replaced by recording stand-ins; the device behaviour itself is not simulated.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const ts = require(require.resolve('typescript', { paths: [process.env.BODYTRACK_DEPENDENCIES || root] }));
const read = file => readFileSync(path.join(root, file), 'utf8');

function transpile(file) {
  return ts.transpileModule(read(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
}
function loadModule(file, modules, globals = {}) {
  const loaded = { exports: {} };
  vm.runInNewContext(transpile(file), {
    module: loaded, exports: loaded.exports, Error, Set, String, Promise, ...globals,
    require: name => {
      if (!(name in modules)) throw new Error(`Unexpected dependency: ${name}`);
      return typeof modules[name] === 'function' && !modules[name].prototype ? modules[name]() : modules[name];
    },
  });
  return loaded.exports;
}
const errors = loadModule('src/social/errors.ts', {});
const revocation = loadModule('src/social/revocation.ts', {});

const GOOGLE_PACKAGE = '@react-native-google-signin/google-signin';
const APPLE_PACKAGE = 'expo-apple-authentication';

/**
 * A world: the platform, whether the native module is present, and a log of what was asked.
 * The Google package stand-in behaves like the real one without the module: requiring it throws.
 */
function world({ os = 'ios', googleNative = true, probeThrows = false, apple = true, signIn } = {}) {
  const log = { probes: [], googleRequires: 0, appleRequires: 0, configured: [], signedOut: 0, signIns: 0 };
  const google = {
    GoogleSignin: {
      configure: config => log.configured.push(JSON.parse(JSON.stringify(config))),
      signIn: async () => { log.signIns++; return signIn ? signIn() : { type: 'success', data: { serverAuthCode: 'server-code' } }; },
      signOut: async () => { log.signedOut++; },
    },
  };
  const modules = {
    'react-native': {
      Platform: { OS: os },
      TurboModuleRegistry: {
        get(name) {
          log.probes.push(name);
          if (probeThrows) throw new Error('registry unavailable');
          return googleNative ? { name } : null;
        },
        getEnforcing(name) {
          throw new Error(`getEnforcing('${name}') must not be used to probe`);
        },
      },
    },
    './errors': errors,
    './revocation': revocation,
    [GOOGLE_PACKAGE]: () => {
      log.googleRequires++;
      if (!googleNative) throw new Error("TurboModuleRegistry.getEnforcing(...): 'RNGoogleSignin' could not be found.");
      return google;
    },
    [APPLE_PACKAGE]: () => {
      log.appleRequires++;
      if (!apple) throw new Error('no Apple module');
      return {
        isAvailableAsync: async () => true,
        AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
        signInAsync: async options => ({
          identityToken: `token:${options.nonce}`, authorizationCode: 'apple-code',
          fullName: { givenName: 'Ada', familyName: 'Lovelace' },
        }),
        addRevokeListener: () => ({ remove() {} }),
      };
    },
  };
  return { log, providers: loadModule('src/social/nativeProviders.ts', modules).nativeProviders };
}
const config = { webClientId: 'web-id', iosClientId: 'ios-id' };

test('without the native module Google is unavailable and the package is never loaded', () => {
  const { log, providers } = world({ googleNative: false });
  assert.equal(providers.googleAvailable(), false);
  assert.equal(providers.googleAvailable(), false);
  assert.equal(log.googleRequires, 0, 'requiring the package would run getEnforcing and throw');
  assert.deepEqual(log.probes, ['RNGoogleSignin', 'RNGoogleSignin']);
});

test('without the native module, signing in with Google says unavailable and loads nothing', async () => {
  const { log, providers } = world({ googleNative: false });
  await assert.rejects(() => providers.signInWithGoogle(config), error => error instanceof errors.SocialUnavailableError);
  assert.equal(log.googleRequires, 0);
  assert.deepEqual(log.configured, []);
  assert.equal(log.signIns, 0);
});

test('a probe that itself throws counts as "not available", and still loads nothing', () => {
  const { log, providers } = world({ probeThrows: true });
  assert.equal(providers.googleAvailable(), false);
  assert.equal(log.googleRequires, 0);
});

test('a supported iOS build with the module still takes the existing Google path', async () => {
  const { log, providers } = world();
  assert.equal(providers.googleAvailable(), true);
  assert.equal(log.googleRequires, 1);
  assert.ok(log.probes.every(name => name === 'RNGoogleSignin'));

  const result = await providers.signInWithGoogle(config);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { authorizationCode: 'server-code' });
  // Same configuration as before: identity only, server auth code requested via offlineAccess.
  assert.deepEqual(log.configured, [{ webClientId: 'web-id', iosClientId: 'ios-id', offlineAccess: true }]);
  assert.equal(log.signIns, 1);
  // The SDK's own session is signed out again so none is left on the device.
  await Promise.resolve();
  assert.equal(log.signedOut, 1);
});

test('cancelling or a missing code on a supported build ends the same way as before', async () => {
  const dismissed = world({ signIn: () => ({ type: 'cancelled' }) });
  await assert.rejects(() => dismissed.providers.signInWithGoogle(config), error => error instanceof errors.SocialCancelledError);

  const refused = world({ signIn: () => { throw Object.assign(new Error('cancelled'), { code: 'SIGN_IN_CANCELLED' }); } });
  await assert.rejects(() => refused.providers.signInWithGoogle(config), error => error instanceof errors.SocialCancelledError);

  const noCode = world({ signIn: () => ({ type: 'success', data: { serverAuthCode: null } }) });
  await assert.rejects(() => noCode.providers.signInWithGoogle(config), /Google did not return an authorization code/);
  await Promise.resolve();
  assert.equal(noCode.log.signedOut, 1, 'no Google session is left behind even without a code');
});

test('other platforms never even probe: Google is unavailable and nothing is loaded', () => {
  for (const os of ['android', 'web']) {
    const { log, providers } = world({ os });
    assert.equal(providers.googleAvailable(), false, os);
    assert.deepEqual(log.probes, [], os);
    assert.equal(log.googleRequires, 0, os);
  }
});

test('Apple sign-in does not depend on, or touch, the Google module or its probe', async () => {
  const { log, providers } = world({ googleNative: false });
  assert.equal(await providers.appleAvailable(), true);
  const result = await providers.signInWithApple('nonce-1');
  assert.equal(result.identityToken, 'token:nonce-1');
  assert.equal(result.firstName, 'Ada');
  assert.deepEqual(log.probes, []);
  assert.equal(log.googleRequires, 0);
  assert.equal(log.appleRequires >= 1, true);
});

test('a build without the Apple module is still unavailable for Apple, as before', async () => {
  const { providers } = world({ apple: false });
  assert.equal(await providers.appleAvailable(), false);
  await assert.rejects(() => providers.signInWithApple('n'), error => error instanceof errors.SocialUnavailableError);
});

test('the source asks the native side first with get, never getEnforcing, before the require', () => {
  // Code only: the doc comment explaining the bug legitimately names getEnforcing.
  const source = read('src/social/nativeProviders.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(source, /import \{ Platform, TurboModuleRegistry \} from "react-native"/);
  assert.match(source, /TurboModuleRegistry\.get\("RNGoogleSignin"\)/);
  assert.doesNotMatch(source, /getEnforcing\(/);
  const body = source.slice(source.indexOf('function loadGoogle()'));
  assert.ok(body.indexOf('googleNativeModulePresent()') !== -1, 'loadGoogle consults the probe');
  assert.ok(body.indexOf('googleNativeModulePresent()') < body.indexOf('require("@react-native-google-signin/google-signin")'),
    'the probe comes before the require');
  // The package is still only ever required lazily, inside the guarded function.
  assert.doesNotMatch(source, /^import .* from "@react-native-google-signin\/google-signin"/m);
});
