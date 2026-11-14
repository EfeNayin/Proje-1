// Run with node --test tests/social-sign-in.test.cjs.
//
// Google / Apple sign-in on the device. The real API client, session controller, provider
// logic, onboarding and deletion store are transpiled from source (support/session-world.cjs);
// only the Keychain, the network and the two native SDKs are doubled, with timing the test
// controls. What the server does with a credential is covered by backend/tests/test_social_auth.py;
// the stand-in here only honours the contract these tests rely on. Nothing renders a screen,
// and no real Google or Apple sheet was opened: that is the signed-iPhone checklist in the README.
/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { ACCESS_KEY, REFRESH_KEY, createServer, createWorld, reply, deferred } = require('./support/session-world.cjs');

const root = path.resolve(__dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));

const SERVER_ON = {
  google: { enabled: true, ios_client_id: 'ios-id', web_client_id: 'web-id' },
  apple: { enabled: true },
};

function offer(overrides = {}) {
  return {
    token: 'onboarding-token',
    expires_in: 900,
    provider: 'google',
    email: 'lifter@gmail.com',
    email_is_usable: true,
    is_private_email: false,
    first_name: 'Efe',
    suggested_username: 'Efe',
    ...overrides,
  };
}

/** The two SDKs. Each sign-in call can be parked with hold() and answered later. */
function makeNative(over = {}) {
  const calls = [];
  const holds = [];
  const parked = (kind, make) => async (...args) => {
    calls.push([kind, ...args]);
    const hold = holds.find((h) => h.kind === kind && !h.used);
    if (hold) {
      hold.used = true;
      hold.reached.resolve();
      await hold.gate.promise;
    }
    return make(...args);
  };
  return {
    calls,
    hold(kind) {
      const entry = { kind, used: false, gate: deferred(), reached: deferred() };
      holds.push(entry);
      return { reached: entry.reached.promise, release: () => entry.gate.resolve() };
    },
    appleAvailable: async () => true,
    googleAvailable: () => true,
    signInWithApple: parked('apple', (nonce) => ({
      identityToken: `token-for-${nonce}`, authorizationCode: 'auth-code', firstName: 'Efe', lastName: null,
    })),
    signInWithGoogle: parked('google', () => ({ authorizationCode: 'known:A' })),
    watchAppleRevocation: () => () => undefined,
    ...over,
  };
}

function app({ native = makeNative(), serverAnswer = SERVER_ON } = {}) {
  const world = createWorld();
  const { net, store } = world;
  const server = createServer(net);
  const client = world.load('api/client');
  const socialApi = world.load('api/social');
  const errors = world.load('social/errors');
  const providers = world.load('social/providerSignIn');
  const onboardingModule = world.load('social/onboarding');
  const { createAttemptGate } = world.load('auth/attemptGate');
  const { createSessionController } = world.load('auth/sessionController');
  const { createLoginSubmitter } = world.load('auth/loginSubmit');

  const views = [];
  const controller = createSessionController({ resetAccountState: () => undefined, apply: (v) => views.push(v) });
  client.setOnSessionExpired(() => controller.sessionExpired());

  // The server stand-in for /auth/social. First match wins; tests prepend with net.override.
  let nonceCounter = 0;
  const issued = new Set();
  net.override((e) => e.path === '/auth/social/providers', () => reply(200, serverAnswer));
  net.override((e) => e.path === '/auth/social/nonce', () => {
    const nonce = `nonce-${String(++nonceCounter).padStart(16, '0')}`;
    issued.add(nonce);
    return reply(200, { nonce, expires_in: 300 });
  });
  net.override((e) => e.path === '/auth/social/login', (e) => {
    const b = e.body;
    if (b.provider === 'apple') {
      if (!issued.delete(b.nonce)) return reply(401, { detail: 'This sign-in expired or was already used. Try again.', code: 'social_nonce_invalid' });
      return reply(200, { status: 'onboarding', user: null, tokens: null, onboarding: offer({ provider: 'apple' }) });
    }
    if (b.authorization_code === 'known:A') {
      return reply(200, { status: 'signed_in', user: { id: 'A', email: 'a@example.com', has_password: false }, tokens: server.seed('A'), onboarding: null });
    }
    if (b.authorization_code === 'down') return reply(503, { detail: 'Sign-in with Google is unavailable right now. Try again in a moment, or use your email.', code: 'social_provider_unavailable' });
    return reply(200, { status: 'onboarding', user: null, tokens: null, onboarding: offer() });
  });

  const gate = createAttemptGate();
  const deps = { native, fetchProviders: socialApi.fetchProviders, requestNonce: socialApi.requestNonce };
  let offered = providers.NO_PROVIDERS;
  const submitProvider = providers.createProviderSubmitter({
    deps,
    signInWithProvider: controller.signInWithProvider,
    login: socialApi.socialLogin,
    gate,
    offered: () => offered,
  });
  const loginSubmit = createLoginSubmitter(controller.signIn, undefined, gate);
  const onboardingStore = onboardingModule.createOnboardingStore();
  const onboarding = onboardingModule.createOnboarding({
    store: onboardingStore,
    establish: controller.establish,
    complete: socialApi.socialComplete,
    linkExisting: socialApi.socialLinkExisting,
    gate,
    timezone: () => 'Europe/Istanbul',
  });

  return {
    ...world, server, client, socialApi, errors, providers, controller, deps, gate, native, views, onboarding,
    onboardingStore, submitProvider, loginSubmit, apiError: client.ApiError,
    setOffered: (value) => { offered = value; },
    async resolveOffered() { offered = await providers.resolveOfferedProviders(deps); return offered; },
    stored: () => ({ access: store.get(ACCESS_KEY), refresh: store.get(REFRESH_KEY) }),
    lastView: () => views[views.length - 1],
    callsTo: (p) => net.calls.filter((c) => c.path === p),
  };
}

// ── what is offered ──────────────────────────────────────────────────────

test('both buttons appear only when the server enables them and this build can run them', async () => {
  const t = app();
  const offered = plain(await t.resolveOffered());
  assert.deepEqual(offered, { google: { webClientId: 'web-id', iosClientId: 'ios-id' }, apple: true });
});

test('a provider the server has not enabled, or is missing client ids for, is hidden', async () => {
  let t = app({ serverAnswer: { google: { enabled: false, ios_client_id: null, web_client_id: null }, apple: { enabled: false } } });
  assert.deepEqual(plain(await t.resolveOffered()), { google: null, apple: false });

  t = app({ serverAnswer: { google: { enabled: true, ios_client_id: 'ios', web_client_id: null }, apple: { enabled: true } } });
  assert.equal((await t.resolveOffered()).google, null);
});

test('a provider this build does not contain is hidden even when the server enables it', async () => {
  const t = app({ native: makeNative({ googleAvailable: () => false, appleAvailable: async () => false }) });
  assert.deepEqual(plain(await t.resolveOffered()), { google: null, apple: false });
});

test('an unreachable server, or one without the endpoint, leaves email sign-in only', async () => {
  const t = app();
  t.net.override((e) => e.path === '/auth/social/providers', () => new TypeError('offline'));
  assert.deepEqual(plain(await t.resolveOffered()), { google: null, apple: false });
  const old = app();
  old.net.override((e) => e.path === '/auth/social/providers', () => reply(404, { detail: 'Not Found' }));
  assert.deepEqual(plain(await old.resolveOffered()), { google: null, apple: false });
});

// ── what is sent ─────────────────────────────────────────────────────────

test('Google sends the one-time server auth code and nothing else', async () => {
  const t = app();
  await t.resolveOffered();
  const credential = await t.providers.obtainCredential('google', await t.resolveOffered(), t.deps);
  assert.deepEqual(plain(credential), { provider: 'google', authorization_code: 'known:A' });
});

test('Apple asks the server for a fresh nonce each time and sends the token with that nonce', async () => {
  const t = app();
  const offered = await t.resolveOffered();
  const first = plain(await t.providers.obtainCredential('apple', offered, t.deps));
  const second = plain(await t.providers.obtainCredential('apple', offered, t.deps));
  assert.notEqual(first.nonce, second.nonce);
  assert.equal(first.identity_token, `token-for-${first.nonce}`);
  assert.deepEqual(first.first_name, 'Efe');
  assert.equal('last_name' in first, false); // absent names are not sent as empty strings
  assert.equal(t.native.calls.filter((c) => c[0] === 'apple').length, 2);
});

test('a provider that is not offered is never opened', async () => {
  const t = app();
  await assert.rejects(
    () => t.providers.obtainCredential('google', t.providers.NO_PROVIDERS, t.deps),
    (error) => error.name === 'SocialUnavailableError',
  );
  assert.equal(t.native.calls.length, 0);
});

// ── signing in ───────────────────────────────────────────────────────────

test('a known identity signs in: tokens are stored and the app shows the account', async () => {
  const t = app();
  await t.resolveOffered();
  const outcome = await t.submitProvider('google');
  assert.deepEqual(plain(outcome), { kind: 'signedIn' });
  assert.equal(t.lastView().status, 'signedIn');
  assert.equal(t.lastView().user.id, 'A');
  assert.ok(t.stored().access && t.stored().refresh);
});

test('a new identity signs nobody in: it yields an offer and stores no tokens', async () => {
  const t = app();
  await t.resolveOffered();
  const outcome = await t.submitProvider('apple');
  assert.equal(outcome.kind, 'onboarding');
  assert.equal(outcome.offer.token, 'onboarding-token');
  assert.equal(t.views.length, 0);
  assert.deepEqual(t.stored(), { access: null, refresh: null });
});

test('cancelling the sheet is not an error: nothing is sent, shown or stored', async () => {
  const t = app();
  // The native wrapper maps the SDK's cancel to SocialCancelledError.
  t.deps.native.signInWithGoogle = async () => { throw new t.errors.SocialCancelledError(); };
  await t.resolveOffered();
  const outcome = await t.submitProvider('google');
  assert.deepEqual(plain(outcome), { kind: 'cancelled' });
  assert.equal(t.callsTo('/auth/social/login').length, 0);
  assert.equal(t.views.length, 0);
  assert.deepEqual(t.stored(), { access: null, refresh: null });
  // And it can be tried again straight away.
  t.deps.native.signInWithGoogle = async () => ({ authorizationCode: 'known:A' });
  assert.equal((await t.submitProvider('google')).kind, 'signedIn');
});

test('the server\'s wording is shown for server problems; native errors are never echoed', async () => {
  const t = app();
  await t.resolveOffered();
  t.deps.native.signInWithGoogle = async () => ({ authorizationCode: 'down' });
  const outage = await t.submitProvider('google');
  assert.equal(outage.kind, 'failed');
  assert.match(outage.message, /unavailable right now.*use your email/i);

  t.deps.native.signInWithGoogle = async () => { throw new Error('GIDSignIn error: client 123-secret-ish'); };
  const native = await t.submitProvider('google');
  assert.equal(native.kind, 'failed');
  assert.doesNotMatch(native.message, /GIDSignIn|secret/);
  assert.match(native.message, /use your email/i);
});

test('a replayed Apple credential is refused by the server and shown as a failure', async () => {
  const t = app();
  const offered = await t.resolveOffered();
  const credential = await t.providers.obtainCredential('apple', offered, t.deps);
  await t.socialApi.socialLogin(credential);
  await assert.rejects(() => t.socialApi.socialLogin(credential), (e) => e.status === 401 && e.code === 'social_nonce_invalid');
});

// ── one attempt at a time ────────────────────────────────────────────────

test('a second tap while a provider sheet is open starts nothing', async () => {
  const t = app();
  await t.resolveOffered();
  const parked = t.native.hold('google');
  const first = t.submitProvider('google');
  await parked.reached;
  assert.deepEqual(plain(await t.submitProvider('google')), { kind: 'ignored' });
  assert.deepEqual(plain(await t.submitProvider('apple')), { kind: 'ignored' });
  assert.equal(plain(await t.loginSubmit('a@example.com', 'right')).kind, 'ignored');
  parked.release();
  assert.equal((await first).kind, 'signedIn');
  assert.equal(t.callsTo('/auth/login').length, 0);
  assert.equal(t.native.calls.filter((c) => c[0] === 'apple').length, 0);
});

test('a provider tap while an email sign-in runs is ignored, and the gate frees afterwards', async () => {
  const t = app();
  await t.resolveOffered();
  const parked = t.net.hold((e) => e.path === '/auth/login');
  const email = t.loginSubmit('a@example.com', 'right');
  await parked.reached;
  assert.deepEqual(plain(await t.submitProvider('google')), { kind: 'ignored' });
  parked.respond(reply(200, { user: { id: 'A', email: 'a@example.com', has_password: true }, tokens: t.server.seed('A') }));
  assert.equal(plain(await email).kind, 'success');
  assert.equal(t.gate.isBusy(), false);
});

test('an invalid email form does not leave the gate held', async () => {
  const t = app();
  assert.equal(plain(await t.loginSubmit('', '')).kind, 'invalid');
  assert.equal(t.gate.isBusy(), false);
});

// ── a late native result cannot replace a newer session ──────────────────

test('a sheet that returns after the person signed in another way changes nothing', async () => {
  const t = app();
  await t.resolveOffered();
  const parked = t.native.hold('google');
  const provider = t.submitProvider('google');
  await parked.reached;

  // While the sheet is up the person ends up signed in as B by some other route.
  const pair = t.server.seed('B');
  await t.controller.establish(async () => ({ user: { id: 'B', email: 'b@example.com' }, tokens: pair }));
  assert.equal(t.lastView().user.id, 'B');

  parked.release();
  const outcome = await provider;
  assert.deepEqual(plain(outcome), { kind: 'superseded' });
  assert.equal(t.lastView().user.id, 'B');
  assert.equal(t.stored().access, pair.access_token);
});

test('a server answer that arrives after a sign-out is dropped', async () => {
  const t = app();
  await t.resolveOffered();
  const parked = t.net.hold((e) => e.path === '/auth/social/login');
  const provider = t.submitProvider('google');
  await parked.reached;
  await t.controller.signOut();
  parked.respond(reply(200, { status: 'signed_in', user: { id: 'A', email: 'a@example.com', has_password: false }, tokens: t.server.seed('A'), onboarding: null }));
  assert.deepEqual(plain(await provider), { kind: 'superseded' });
  assert.deepEqual(t.stored(), { access: null, refresh: null });
  assert.equal(t.lastView().status, 'signedOut');
});

test('an onboarding offer that arrives after the epoch moved on is dropped too', async () => {
  const t = app();
  await t.resolveOffered();
  const parked = t.net.hold((e) => e.path === '/auth/social/login');
  const provider = t.submitProvider('apple');
  await parked.reached;
  await t.controller.signOut();
  parked.respond(reply(200, { status: 'onboarding', user: null, tokens: null, onboarding: offer() }));
  assert.deepEqual(plain(await provider), { kind: 'superseded' });
});

// ── onboarding ───────────────────────────────────────────────────────────

function begin(t, o = offer()) { t.onboardingStore.begin(o); }

test('creating the account sends the offer token, the lower-cased username and the device timezone', async () => {
  const t = app();
  begin(t);
  t.net.override((e) => e.path === '/auth/social/complete', () => reply(201, { user: { id: 'N', email: 'lifter@gmail.com', has_password: false }, tokens: t.server.seed('A') }));
  const outcome = await t.onboarding.create({ username: ' Lifter_1 ', firstName: ' Efe ', email: '' });
  assert.deepEqual(plain(outcome), { kind: 'success' });
  const sent = t.callsTo('/auth/social/complete')[0].body;
  assert.deepEqual(plain(sent), { onboarding_token: 'onboarding-token', username: 'lifter_1', first_name: 'Efe', timezone: 'Europe/Istanbul' });
  assert.equal(t.lastView().status, 'signedIn');
  assert.equal(t.onboardingStore.getSnapshot().offer, null); // the token is forgotten
});

test('the username rules are the registration rules, checked before any request', async () => {
  const t = app();
  begin(t);
  assert.equal((await t.onboarding.create({ username: 'ab', firstName: '', email: '' })).kind, 'invalid');
  assert.equal((await t.onboarding.create({ username: 'bad name!', firstName: '', email: '' })).kind, 'invalid');
  assert.equal(t.callsTo('/auth/social/complete').length, 0);
  assert.equal(t.gate.isBusy(), false);
});

test('when the provider gave no usable email the person must type one, and it is sent', async () => {
  const t = app();
  begin(t, offer({ email: null, email_is_usable: false, provider: 'apple' }));
  const missing = await t.onboarding.create({ username: 'lifter', firstName: '', email: ' ' });
  assert.deepEqual(plain(missing), { kind: 'invalid', message: 'Enter a valid email address.' });
  t.net.override((e) => e.path === '/auth/social/complete', () => reply(201, { user: { id: 'N' }, tokens: t.server.seed('A') }));
  assert.equal((await t.onboarding.create({ username: 'lifter', firstName: '', email: ' me@example.com ' })).kind, 'success');
  assert.equal(t.callsTo('/auth/social/complete')[0].body.email, 'me@example.com');
});

test('a usable provider email is not sent from the device; the server already holds it', async () => {
  const t = app();
  begin(t);
  t.net.override((e) => e.path === '/auth/social/complete', () => reply(201, { user: { id: 'N' }, tokens: t.server.seed('A') }));
  await t.onboarding.create({ username: 'lifter', firstName: '', email: 'someone@else.com' });
  assert.equal('email' in t.callsTo('/auth/social/complete')[0].body, false);
});

test('a taken username keeps the offer so another can be tried', async () => {
  const t = app();
  begin(t);
  t.net.override((e) => e.path === '/auth/social/complete', () => reply(409, { detail: 'Email or username is already taken', code: 'social_username_taken' }));
  const outcome = await t.onboarding.create({ username: 'taken', firstName: '', email: '' });
  assert.equal(outcome.kind, 'username-taken');
  assert.ok(t.onboardingStore.getSnapshot().offer);
  assert.equal(t.gate.isBusy(), false);
  assert.deepEqual(t.stored(), { access: null, refresh: null });
});

test('an email that belongs to an Aures account points to linking, and never links by itself', async () => {
  const t = app();
  begin(t);
  t.net.override((e) => e.path === '/auth/social/complete', () => reply(409, { detail: 'x', code: 'social_email_in_use' }));
  const outcome = await t.onboarding.create({ username: 'lifter', firstName: '', email: '' });
  assert.equal(outcome.kind, 'email-in-use');
  assert.equal(t.callsTo('/auth/social/link-existing').length, 0);
  assert.deepEqual(t.stored(), { access: null, refresh: null });
});

test('an expired offer sends the person back to sign in, without a request', async () => {
  let clock = 1_000_000;
  const world = app();
  const store = world.onboardingStore;
  const expiring = world.load('social/onboarding').createOnboardingStore(() => clock);
  expiring.begin(offer({ expires_in: 60 }));
  clock += 61_000;
  assert.equal(expiring.current(), null);
  assert.equal(store.current(), null);
  const outcome = await world.onboarding.create({ username: 'lifter', firstName: '', email: '' });
  assert.equal(outcome.kind, 'expired');
  assert.equal(world.callsTo('/auth/social/complete').length, 0);
});

test('the server saying the offer is gone clears it', async () => {
  const t = app();
  begin(t);
  t.net.override((e) => e.path === '/auth/social/complete', () => reply(400, { detail: 'x', code: 'social_onboarding_expired' }));
  const outcome = await t.onboarding.create({ username: 'lifter', firstName: '', email: '' });
  assert.equal(outcome.kind, 'expired');
  assert.equal(t.onboardingStore.getSnapshot().offer, null);
});

test('linking to an existing account sends the typed email and password, and signs that account in', async () => {
  const t = app();
  begin(t);
  t.net.override((e) => e.path === '/auth/social/link-existing', () => reply(200, { user: { id: 'A', email: 'a@example.com', has_password: true }, tokens: t.server.seed('A') }));
  const outcome = await t.onboarding.link({ email: ' a@example.com ', password: 'right' });
  assert.deepEqual(plain(outcome), { kind: 'success' });
  assert.deepEqual(plain(t.callsTo('/auth/social/link-existing')[0].body), { onboarding_token: 'onboarding-token', email: 'a@example.com', password: 'right' });
  assert.equal(t.lastView().user.id, 'A');
  assert.equal(t.onboardingStore.getSnapshot().offer, null);
});

test('a wrong password for linking attaches nothing and the offer stays usable', async () => {
  const t = app();
  begin(t);
  t.net.override((e) => e.path === '/auth/social/link-existing', () => reply(401, { detail: 'Invalid email or password' }));
  const outcome = await t.onboarding.link({ email: 'a@example.com', password: 'wrong' });
  assert.deepEqual(plain(outcome), { kind: 'failed', message: 'Invalid email or password' });
  assert.ok(t.onboardingStore.getSnapshot().offer);
  assert.deepEqual(t.stored(), { access: null, refresh: null });
});

test('two taps on Create account send one request', async () => {
  const t = app();
  begin(t);
  const parked = t.net.hold((e) => e.path === '/auth/social/complete');
  const first = t.onboarding.create({ username: 'lifter', firstName: '', email: '' });
  await parked.reached;
  assert.equal((await t.onboarding.create({ username: 'lifter', firstName: '', email: '' })).kind, 'ignored');
  parked.respond(reply(201, { user: { id: 'N' }, tokens: t.server.seed('A') }));
  assert.equal((await first).kind, 'success');
  assert.equal(t.callsTo('/auth/social/complete').length, 1);
});

// ── deleting an account that has no password ─────────────────────────────

function deletionApp() {
  const t = app();
  const { createAccountDeletionStore } = t.load('account/deletion');
  const sent = [];
  const store = createAccountDeletionStore({
    deleteAccount: async (confirmation) => {
      sent.push(confirmation);
      if (confirmation && confirmation.authorization_code === 'known:A') return undefined;
      const error = new t.apiError(403, 'Sign-in did not match', 'reauth_failed');
      throw error;
    },
    currentEpoch: t.client.currentAuthEpoch,
  });
  return { ...t, store, sent };
}

test('confirming with the provider sends the fresh credential, once, and deletes', async () => {
  const t = deletionApp();
  let deleted = 0;
  t.store.setOnDeleted(() => { deleted += 1; });
  const outcome = await t.store.submit(async () => ({ provider: 'google', authorization_code: 'known:A' }));
  assert.deepEqual(plain(outcome), { kind: 'deleted' });
  assert.deepEqual(plain(t.sent), [{ provider: 'google', authorization_code: 'known:A' }]);
  assert.equal(deleted, 1);
});

test('closing the provider sheet cancels without a request or an error', async () => {
  const t = deletionApp();
  const outcome = await t.store.submit(async () => { throw new t.errors.SocialCancelledError(); });
  assert.deepEqual(plain(outcome), { kind: 'cancelled' });
  assert.equal(t.sent.length, 0);
  assert.deepEqual(plain(t.store.getSnapshot()), { phase: 'idle', error: null });
});

test('a different provider account is a mismatch, not a wrong password, and deletes nothing', async () => {
  const t = deletionApp();
  const outcome = await t.store.submit(async () => ({ provider: 'google', authorization_code: 'someone-else' }));
  assert.equal(outcome.kind, 'provider-mismatch');
  assert.match(outcome.message, /not been deleted/);
  assert.equal(plain(t.store.getSnapshot()).phase, 'failed');
});

test('a provider failure before anything is sent is a plain refusal', async () => {
  const t = deletionApp();
  const outcome = await t.store.submit(async () => { throw new Error('native blew up'); });
  assert.equal(outcome.kind, 'rejected');
  assert.equal(t.sent.length, 0);
});

test('a provider outage on the server says nothing was deleted, in the server\'s words', async () => {
  const { classifyDeletionError } = deletionApp().load('account/deletion');
  const outcome = classifyDeletionError({ name: 'ApiError', status: 503, code: 'social_provider_unavailable', message: 'Sign-in with Google is unavailable right now.' });
  assert.equal(outcome.kind, 'not-deleted');
  assert.match(outcome.message, /unavailable right now.*has not been deleted/);
  // Any other 503 keeps the standard wording.
  assert.match(classifyDeletionError({ name: 'ApiError', status: 503, message: 'x' }).message, /nothing was deleted/);
});

test('a password still works and an empty one is still refused on the device', async () => {
  const t = deletionApp();
  assert.equal((await t.store.submit('')).kind, 'invalid');
  assert.equal(t.sent.length, 0);
});

test('the deletion request carries a credential as provider_credential and a password as password', async () => {
  const world = createWorld();
  const server = createServer(world.net);
  const seeded = server.seed('A');
  world.store.data.set(ACCESS_KEY, seeded.access_token);
  world.store.data.set(REFRESH_KEY, seeded.refresh_token);
  const api = world.load('api/auth');
  await api.deleteAccount('wrong').catch(() => undefined);
  await api.deleteAccount({ provider: 'google', authorization_code: 'c' }).catch(() => undefined);
  const bodies = world.net.calls.filter((c) => c.path === '/users/me/delete-account').map((c) => plain(c.body));
  assert.deepEqual(bodies[0], { password: 'wrong' });
  assert.deepEqual(bodies[1], { provider_credential: { provider: 'google', authorization_code: 'c' } });
});

// ── the screens and the build, read statically ───────────────────────────

test('the sign-in screen orders email, "or", the providers, then Create account', () => {
  const source = read('app/(auth)/login.tsx');
  const at = (needle) => source.indexOf(needle);
  assert.ok(at('>Sign in</Text>') > 0);
  assert.ok(at('>Sign in</Text>') < at('>or</Text>'));
  assert.ok(at('>or</Text>') < at('<ProviderButtons'));
  assert.ok(at('<ProviderButtons') < at('Create account'));
  // Hidden until there is something to offer.
  assert.match(source, /offered\.apple \|\| offered\.google/);
});

test('the provider buttons are Apple\'s own and a flat Google one, at one size, and fully labelled', () => {
  // How they look and behave is covered by provider-buttons.test.cjs.
  const source = read('src/social/ProviderButtons.tsx');
  assert.match(source, /AppleAuthenticationButton/);
  assert.doesNotMatch(source, /GoogleSigninButton/);
  assert.match(source, /accessibilityLabel="Sign in with Apple"/);
  assert.match(source, /accessibilityLabel="Sign in with Google"/);
  assert.match(source, /apple: \{ width: "100%", height: BUTTON_HEIGHT \}/);
  assert.match(source, /Platform\.OS !== "ios"/);
});

test('the native SDKs are loaded lazily, so a build without them still starts', () => {
  for (const file of ['src/social/nativeProviders.ts', 'src/social/ProviderButtons.tsx']) {
    const source = read(file);
    assert.doesNotMatch(source, /^import .* from "(expo-apple-authentication|@react-native-google-signin\/google-signin)"/m, file);
    assert.match(source, /try \{\s*(\/\/.*\n\s*)?return require\(/, file);
  }
});

test('no secret reaches the app: only public client ids, no server secrets or public env vars for them', () => {
  const files = ['src/social/nativeProviders.ts', 'src/social/providerSignIn.ts', 'src/social/providerSession.ts',
    'src/social/onboarding.ts', 'src/api/social.ts', 'app.config.js', 'app/(auth)/social-onboarding.tsx'];
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /client_secret|CLIENT_SECRET|APPLE_PRIVATE_KEY|\.p8|EXPO_PUBLIC_[A-Z_]*(SECRET|PRIVATE|KEY)/, file);
  }
  // The server tells the app the public ids; none is configured in the app.
  assert.doesNotMatch(read('app.config.js'), /EXPO_PUBLIC/);
  assert.doesNotMatch(read('eas.json'), /GOOGLE|APPLE|SECRET/);
});

test('credentials are neither logged nor persisted', () => {
  for (const file of ['src/social/nativeProviders.ts', 'src/social/providerSignIn.ts', 'src/social/onboarding.ts', 'src/api/social.ts']) {
    const source = read(file);
    assert.doesNotMatch(source, /console\.|SecureStore|AsyncStorage|setItem/, file);
  }
});

test('the build adds the native pieces only when asked, and app.json keeps its own plugins', async () => {
  const config = require(path.join(root, 'app.config.js'));
  const base = JSON.parse(read('app.json')).expo;
  const names = (c) => c.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
  const saved = { a: process.env.AURES_APPLE_SIGN_IN, g: process.env.AURES_GOOGLE_IOS_URL_SCHEME };
  try {
    delete process.env.AURES_APPLE_SIGN_IN;
    delete process.env.AURES_GOOGLE_IOS_URL_SCHEME;
    const plainBuild = config({ config: base });
    assert.deepEqual(names(plainBuild), names(base));
    assert.equal(plainBuild.ios.usesAppleSignIn, undefined);

    process.env.AURES_APPLE_SIGN_IN = '1';
    process.env.AURES_GOOGLE_IOS_URL_SCHEME = 'com.googleusercontent.apps.123-abc';
    const full = config({ config: base });
    assert.ok(names(full).includes('expo-apple-authentication'));
    const google = full.plugins.find((p) => Array.isArray(p) && p[0] === '@react-native-google-signin/google-signin');
    assert.deepEqual(google[1], { iosUrlScheme: 'com.googleusercontent.apps.123-abc' });
    assert.equal(full.ios.usesAppleSignIn, true);
    assert.equal(full.ios.bundleIdentifier, base.ios.bundleIdentifier);
  } finally {
    for (const [key, value] of [['AURES_APPLE_SIGN_IN', saved.a], ['AURES_GOOGLE_IOS_URL_SCHEME', saved.g]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('the onboarding screen offers the link-to-existing path next to creating an account', () => {
  const source = read('app/(auth)/social-onboarding.tsx');
  assert.match(source, /I already have an Aures account/);
  assert.match(source, /Sign in and link/);
  assert.match(source, /Use a different account/);
  assert.match(source, /is_private_email/); // an Apple relay address is explained, not hidden
});

test('the delete-account screen asks an account without a password to sign in with its provider', () => {
  const source = read('app/(app)/profile/delete-account.tsx');
  assert.match(source, /!user\.has_password/);
  assert.match(source, /fetchSignInMethods/);
  assert.match(source, /obtainCredential\(provider, offered, providerDeps\)/);
});

