// Run with node --test tests/session-concurrency.test.cjs.
//
// Sign-out, refresh, account switching and sign-in answers that arrive out of
// order. Deterministic: the app's real token storage, API client and session
// controller are transpiled from source (see support/session-world.cjs) and only
// two edges are doubled, the Keychain and the network, each with timing the test
// controls. The "server" is a stand-in for the backend's token rules; what the real
// database does is established by backend/tests/test_logout_refresh_race.py.
//
// Storage ordering matters as much as network ordering here: several tests hold a
// Keychain write or delete *before it takes effect*, which is the case a check made
// before an awaited write cannot cover.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ACCESS_KEY, REFRESH_KEY, createServer, createWorld, reply } = require('./support/session-world.cjs');

const ACTIVE_KEY = 'bodytrack.active_workout_id';
const flush = () => new Promise(setImmediate);
const outcome = (promise) => promise.then((value) => ({ value }), (error) => ({ error }));
// A broken guard can leave a request waiting for something that never comes; fail instead of hanging.
const within = (promise, ms = 1500) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`still waiting after ${ms} ms`)), ms).unref()),
]);

function app() {
  const world = createWorld();
  const { net, store } = world;
  const server = createServer(net);
  const tokens = world.load('api/tokens');
  const client = world.load('api/client');
  const { createSessionController } = world.load('auth/sessionController');
  const views = [];
  const counts = { resets: 0, expired: 0 };
  const controller = createSessionController({
    resetAccountState: () => { counts.resets += 1; },
    apply: (view) => views.push(view),
  });
  client.setOnSessionExpired(() => { counts.expired += 1; controller.sessionExpired(); });
  // The device is already signed in as `user`.
  function signedInAs(user) {
    const pair = server.seed(user);
    store.data.set(ACCESS_KEY, pair.access_token);
    store.data.set(REFRESH_KEY, pair.refresh_token);
    return pair;
  }
  const stored = () => ({ access: store.get(ACCESS_KEY), refresh: store.get(REFRESH_KEY) });
  const signIn = (user, password = 'right') => controller.signIn(server.emails[user], password);
  const lastView = () => views[views.length - 1];
  const logoutCalls = () => net.calls.filter((c) => c.path === '/auth/logout');
  const refreshCalls = () => net.calls.filter((c) => c.path === '/auth/refresh');
  return { ...world, server, tokens, client, controller, views, counts, signedInAs, stored, signIn, lastView, logoutCalls, refreshCalls };
}

const isSessionChanged = (result) => result.error?.name === 'SessionChangedError';

// ── 1. Logout while a refresh is in flight ───────────────────────────────

test('logout during a refresh: the late answer does not bring the session back, and the server session ends', async () => {
  const t = app();
  t.signedInAs('A');
  t.server.expireAccess();
  const answer = t.net.delay((c) => c.path === '/auth/refresh');
  const request = outcome(t.client.apiRequest('/users/me'));
  await answer.reached; // the server has rotated A's token; the answer is on its way

  const out = await t.controller.signOut();
  assert.deepEqual(t.stored(), { access: null, refresh: null });
  assert.equal(t.lastView().status, 'signedOut');

  answer.release(); // now the rotated pair arrives
  assert.ok(isSessionChanged(await request), 'the caller of the obsolete request is not given a result');
  assert.deepEqual(t.stored(), { access: null, refresh: null }, 'credentials were not restored');
  assert.equal(t.counts.expired, 0, 'an obsolete refresh does not report an expiry');
  assert.equal(await out.revocation, 'confirmed');
  // The logout reached the server after the rotation; ending the session ended the successor too.
  assert.equal(t.server.liveRefreshTokens('A').length, 0);
});

test('a successful refresh answer arriving after logout is dropped and writes nothing', async () => {
  const t = app();
  t.signedInAs('A');
  t.server.expireAccess();
  const answer = t.net.delay((c) => c.path === '/auth/refresh');
  const request = outcome(t.client.apiRequest('/users/me'));
  await answer.reached;
  await t.controller.signOut();
  const writes = t.store.log.filter((l) => l.startsWith('set:')).length;

  answer.release();
  await request;
  assert.equal(t.store.log.filter((l) => l.startsWith('set:')).length, writes, 'no Keychain write after sign-out');
});

// ── 2. Persistence already in progress when logout starts ────────────────

test('logout while the refreshed pair is being written: the write is not left behind, and the server gets the newest token', async () => {
  const t = app();
  t.signedInAs('A');
  t.server.expireAccess();
  const write = t.store.hold((o) => o.op === 'set' && o.key === REFRESH_KEY);
  const request = outcome(t.client.apiRequest('/users/me'));
  await write.reached; // the refresh succeeded; its Keychain write has begun and is stuck

  const signingOut = t.controller.signOut();
  assert.equal(t.lastView().status, 'signedOut', 'local state is gone before storage has finished anything');
  await flush();
  assert.equal(t.logoutCalls().length, 0, 'the token is taken only after the pending write');

  write.release();
  const out = await signingOut;
  assert.ok(isSessionChanged(await request));
  assert.deepEqual(t.stored(), { access: null, refresh: null }, 'the late write did not survive the clear');
  assert.equal(out.localClear, true);
  assert.equal(t.logoutCalls().length, 1);
  assert.match(t.logoutCalls()[0].body.refresh_token, /^A-refresh-/);
  assert.notEqual(t.logoutCalls()[0].body.refresh_token, 'A-refresh-1', 'logout carried the rotated token, not the stale one');
  assert.equal(t.server.liveRefreshTokens('A').length, 0);
});

// ── 3. Account B signs in while account A's work is pending ──────────────

test('B signs in while A\'s sign-out clear is still pending: B\'s tokens are written after it and survive', async () => {
  const t = app();
  t.signedInAs('A');
  const clear = t.store.hold((o) => o.op === 'delete' && o.key === ACCESS_KEY);
  const signingOut = t.controller.signOut();
  await clear.reached; // A's delete is stuck inside the Keychain

  let signedIn = false;
  const signingInB = t.signIn('B').then(() => { signedIn = true; });
  await flush();
  assert.equal(signedIn, false, 'B waits for A\'s cleanup instead of racing it');
  assert.match(t.stored().refresh, /^A-refresh-/, 'A is still on disk, not B');

  clear.release();
  await signingOut;
  await signingInB;
  assert.match(t.stored().refresh, /^B-refresh-/);
  assert.match(t.stored().access, /^B-access-/);
  assert.equal(t.lastView().status, 'signedIn');
  assert.equal(t.lastView().user.email, 'b@example.com');
});

test('B signs in while the active-workout pointer of A is still being cleared: B keeps the pointer it creates afterwards', async () => {
  const t = app();
  t.signedInAs('A');
  t.store.data.set(ACTIVE_KEY, 'workout-of-A');
  const clear = t.store.hold((o) => o.op === 'delete' && o.key === ACTIVE_KEY);
  const signingOut = t.controller.signOut();
  await clear.reached;

  const signingInB = t.signIn('B');
  await flush();
  assert.equal(t.lastView().status, 'signedOut', 'B is not shown before A\'s cleanup is done');
  clear.release();
  await signingOut;
  await signingInB;

  assert.equal(t.store.get(ACTIVE_KEY), null, 'A\'s pointer is gone');
  t.store.data.set(ACTIVE_KEY, 'workout-of-B'); // B starts a workout
  await flush();
  assert.equal(t.store.get(ACTIVE_KEY), 'workout-of-B');
  assert.equal(t.lastView().user.email, 'b@example.com');
});

test('a sign-in answer that arrives after a newer attempt is dropped; the newer account stays', async () => {
  const t = app();
  const slowA = t.net.hold((c) => c.path === '/auth/login' && c.body.email === 'a@example.com');
  const attemptA = outcome(t.signIn('A'));
  await slowA.reached;

  await t.signIn('B'); // the user went on and signed in as B; B's answer came first
  const storedB = t.stored();
  assert.equal(t.lastView().user.email, 'b@example.com');

  slowA.respond(reply(200, { user: { id: 'A', email: 'a@example.com' }, tokens: t.server.seed('A') }));
  assert.ok(isSessionChanged(await attemptA));
  assert.deepEqual(t.stored(), storedB, 'A\'s answer wrote nothing');
  assert.equal(t.lastView().user.email, 'b@example.com');
  assert.equal(t.views.filter((v) => v.status === 'signedIn').length, 1, 'A was never shown');
});

test('a sign-in answer whose write is in progress when a newer attempt starts is taken back if the newer one fails', async () => {
  const t = app();
  const write = t.store.hold((o) => o.op === 'set' && o.key === REFRESH_KEY && o.value.startsWith('A-'));
  const attemptA = outcome(t.signIn('A'));
  await write.reached; // A's tokens are being written

  const attemptB = outcome(t.signIn('B', 'wrong')); // newer attempt; it will be refused
  write.release();

  assert.ok(isSessionChanged(await attemptA));
  assert.equal((await attemptB).error.status, 401);
  assert.deepEqual(t.stored(), { access: null, refresh: null }, 'nothing of A is left behind');
  assert.equal(t.views.length, 0, 'neither account was shown');
});

test('a sign-up answer that is superseded is dropped the same way', async () => {
  const t = app();
  const slow = t.net.hold((c) => c.path === '/auth/register');
  const signUp = outcome(t.controller.signUp({ email: 'a@example.com', password: 'right', username: 'aaa' }));
  await slow.reached;
  await t.signIn('B');
  slow.respond(reply(201, { user: { id: 'A', email: 'a@example.com' }, tokens: t.server.seed('A') }));
  assert.ok(isSessionChanged(await signUp));
  assert.match(t.stored().refresh, /^B-refresh-/);
});

// ── 4. Obsolete requests ─────────────────────────────────────────────────

test('an obsolete 401 after B signed in does not sign B out, refresh with B\'s token, or reach B\'s screens', async () => {
  const t = app();
  t.signedInAs('A');
  const parked = t.net.hold((c) => c.path === '/workouts');
  const request = outcome(t.client.apiRequest('/workouts'));
  await parked.reached;
  await t.controller.signOut();
  await t.signIn('B');
  const before = t.stored();

  parked.respond(reply(401, { detail: 'Invalid or expired access token' }));
  assert.ok(isSessionChanged(await request));
  assert.deepEqual(t.stored(), before, 'B\'s tokens are untouched');
  assert.equal(t.counts.expired, 0, 'no expiry was reported against B');
  assert.equal(t.refreshCalls().length, 0, 'B\'s refresh token was not spent');
  assert.equal(t.lastView().status, 'signedIn');
  assert.equal(t.lastView().user.email, 'b@example.com');
});

test('an obsolete successful answer is not handed to its caller', async () => {
  const t = app();
  t.signedInAs('A');
  const parked = t.net.hold((c) => c.path === '/users/me');
  const request = outcome(t.client.apiRequest('/users/me'));
  await parked.reached;
  await t.controller.signOut();
  await t.signIn('B');

  parked.respond(reply(200, { email: 'a@example.com', private: 'A\'s data' }));
  const result = await request;
  assert.equal(result.value, undefined, 'A\'s private data did not reach the caller');
  assert.ok(isSessionChanged(result));
});

test('an obsolete error answer is not handed on either', async () => {
  const t = app();
  t.signedInAs('A');
  const parked = t.net.hold((c) => c.path === '/users/me');
  const request = outcome(t.client.apiRequest('/users/me'));
  await parked.reached;
  await t.controller.signOut();
  parked.respond(reply(500, { detail: 'boom about A' }));
  assert.ok(isSessionChanged(await request));
});

test('a request whose token was being read when the account changed sends nothing', async () => {
  const t = app();
  t.signedInAs('A');
  const read = t.store.hold((o) => o.op === 'get' && o.key === ACCESS_KEY);
  const request = outcome(t.client.apiRequest('/users/me'));
  await read.reached;
  await t.controller.signOut();
  read.release();
  assert.ok(isSessionChanged(await request));
  assert.equal(t.net.calls.filter((c) => c.path === '/users/me').length, 0, 'no request left the device');
});

test('a refresh whose token was being read when the account changed sends nothing', async () => {
  const t = app();
  t.signedInAs('A');
  t.server.expireAccess();
  const read = t.store.hold((o) => o.op === 'get' && o.key === REFRESH_KEY);
  const request = outcome(t.client.apiRequest('/users/me')); // 401, then the refresh starts reading its token
  await read.reached;
  await t.controller.signOut();
  read.release(); // the read delivers A's refresh token, late
  assert.ok(isSessionChanged(await request));
  assert.equal(t.refreshCalls().length, 0, 'the signed-out account\'s token was not presented');
});

test('a stale profile refresh cannot put the previous account back on screen', async () => {
  const t = app();
  t.signedInAs('A');
  const parked = t.net.hold((c) => c.path === '/users/me');
  const { fetchMe } = t.load('api/auth');
  const profile = outcome(fetchMe());
  await parked.reached;
  await t.controller.signOut();
  await t.signIn('B');
  parked.respond(reply(200, { email: 'a@example.com' }));
  assert.ok(isSessionChanged(await profile));
});

test('an obsolete request that is refused outright does not end a newer session that has since expired', async () => {
  const t = app();
  t.signedInAs('A');
  const parked = t.net.hold((c) => c.path === '/workouts');
  const request = outcome(t.client.apiRequest('/workouts'));
  await parked.reached;
  await t.controller.signOut();
  await t.signIn('B');
  t.server.expireAccess(); // B's access token ends up expired too

  parked.respond(reply(401));
  assert.ok(isSessionChanged(await request));
  // B's own request still recovers by itself.
  assert.equal((await t.client.apiRequest('/users/me')).email, 'b@example.com');
  assert.equal(t.counts.expired, 0);
});

// ── 5. Concurrent refresh keeps single-flight, rotation and reuse detection ──

test('several 401s share one refresh, send the stored token once, and all retry with the new access token', async () => {
  const t = app();
  const pair = t.signedInAs('A');
  t.server.expireAccess();
  const answer = t.net.delay((c) => c.path === '/auth/refresh');
  const results = Promise.all([
    t.client.apiRequest('/users/me'), t.client.apiRequest('/workouts'), t.client.apiRequest('/programs'),
  ]);
  await answer.reached;
  answer.release();
  const done = await results;

  assert.equal(done.every((r) => r.owner === 'A'), true);
  assert.equal(t.refreshCalls().length, 1, 'one refresh');
  assert.equal(t.refreshCalls()[0].body.refresh_token, pair.refresh_token, 'with the stored token, once');
  assert.notEqual(t.stored().refresh, pair.refresh_token, 'rotated');
  assert.equal(t.server.liveRefreshTokens('A').length, 1, 'no replay was detected');
});

test('a refresh from an earlier account is not joined by the next account\'s requests', async () => {
  const t = app();
  t.signedInAs('A');
  t.server.expireAccess();
  const answer = t.net.delay((c) => c.path === '/auth/refresh' && c.body.refresh_token.startsWith('A-'));
  const oldRequest = outcome(t.client.apiRequest('/users/me'));
  await answer.reached;
  await t.controller.signOut();
  await t.signIn('B');
  t.server.expireAccess(); // both accounts' access tokens are expired by now

  const fresh = outcome(t.client.apiRequest('/users/me')); // B's own request refreshes with B's token
  await flush();
  const mine = await within(fresh);
  assert.equal(mine.value.owner, 'B', 'B\'s request was not answered with A\'s refresh');
  answer.release();
  assert.ok(isSessionChanged(await oldRequest));
  assert.match(t.stored().refresh, /^B-refresh-/);
});

test('the token a signed-out device gave up cannot be replayed into a theft signal for the other account', async () => {
  const t = app();
  t.signedInAs('A');
  t.server.expireAccess();
  const answer = t.net.delay((c) => c.path === '/auth/refresh');
  const request = outcome(t.client.apiRequest('/users/me'));
  await answer.reached;
  await t.controller.signOut();
  answer.release();
  await request;
  await t.signIn('B');
  assert.equal(t.server.liveRefreshTokens('B').length, 1, 'B\'s session is intact');
  assert.equal(t.refreshCalls().length, 1, 'the signed-out device sent no second refresh');
});

// ── 6. Rate limits and outages during transitions ────────────────────────

test('a 429 or 503 on refresh keeps only the still-current session', async () => {
  for (const status of [429, 503]) {
    const t = app();
    const pair = t.signedInAs('A');
    t.server.expireAccess();
    t.net.override((c) => c.path === '/auth/refresh', () => reply(status, { detail: 'Try again in 5 minutes.' }));

    const failed = await outcome(t.client.apiRequest('/users/me'));
    assert.equal(failed.error.status, status);
    assert.equal(t.stored().refresh, pair.refresh_token, `${status}: the session is kept`);
    assert.equal(t.counts.expired, 0);
    assert.equal(t.refreshCalls().length, 1, 'not retried on its own');
  }
});

test('a 429 on refresh followed by sign-out leaves the device signed out, not restored', async () => {
  const t = app();
  t.signedInAs('A');
  t.server.expireAccess();
  const answer = t.net.hold((c) => c.path === '/auth/refresh');
  const request = outcome(t.client.apiRequest('/users/me'));
  await answer.reached;
  await t.controller.signOut();
  answer.respond(reply(429, { detail: 'Too many session refreshes. Try again in 9 minutes.' }));
  await request;
  assert.deepEqual(t.stored(), { access: null, refresh: null });
  assert.equal(t.counts.expired, 0);
});

test('a 429 or 503 arriving for A after B signed in does not touch B', async () => {
  for (const status of [429, 503]) {
    const t = app();
    t.signedInAs('A');
    t.server.expireAccess();
    const answer = t.net.hold((c) => c.path === '/auth/refresh');
    const request = outcome(t.client.apiRequest('/users/me'));
    await answer.reached;
    await t.controller.signOut();
    await t.signIn('B');
    const before = t.stored();
    answer.respond(reply(status, { detail: 'later' }));
    await request;
    assert.deepEqual(t.stored(), before);
    assert.equal(t.counts.expired, 0);
    assert.equal(t.lastView().user.email, 'b@example.com');
  }
});

test('a rejected refresh expires the session once, however many requests were waiting', async () => {
  const t = app();
  t.signedInAs('A');
  t.server.expireAccess();
  t.net.override((c) => c.path === '/auth/refresh', () => reply(401, { detail: 'Invalid or expired refresh token' }));
  const results = await Promise.all([
    outcome(t.client.apiRequest('/users/me')), outcome(t.client.apiRequest('/workouts')),
  ]);
  assert.ok(results.every((r) => r.error.status === 401));
  assert.equal(t.counts.expired, 1, 'one expiry');
  assert.deepEqual(t.stored(), { access: null, refresh: null });
  assert.equal(t.lastView().status, 'signedOut');
  await t.signIn('B');
  assert.match(t.stored().refresh, /^B-refresh-/);
});

// ── 7. Local logout reliability ──────────────────────────────────────────

test('sign-out leaves the account and resets private state before any storage or network work', () => {
  const t = app();
  t.signedInAs('A');
  const pending = t.controller.signOut(); // not awaited
  assert.equal(t.lastView().status, 'signedOut');
  assert.equal(t.counts.resets, 1);
  assert.equal(t.net.calls.length, 0);
  return pending;
});

test('local sign-out completes when the server cannot be reached, and is not retried', async () => {
  const t = app();
  t.signedInAs('A');
  t.net.override((c) => c.path === '/auth/logout', () => new TypeError('offline'));
  const out = await t.controller.signOut();

  assert.equal(out.localClear, true);
  assert.deepEqual(t.stored(), { access: null, refresh: null });
  assert.equal(await out.revocation, 'unconfirmed');
  await flush();
  assert.equal(t.logoutCalls().length, 1, 'one attempt; no background retry');
  assert.equal(t.server.liveRefreshTokens('A').length, 1, 'the server session is still live: local clearance is not revocation');

  // A later account is unaffected by the failed attempt.
  await t.signIn('B');
  await flush();
  assert.equal(t.logoutCalls().length, 1);
});

test('a server error on logout is reported as unconfirmed, and 204 as confirmed', async () => {
  const failing = app();
  failing.signedInAs('A');
  failing.net.override((c) => c.path === '/auth/logout', () => reply(503, { detail: 'down' }));
  assert.equal(await (await failing.controller.signOut()).revocation, 'unconfirmed');

  const working = app();
  working.signedInAs('A');
  assert.equal(await (await working.controller.signOut()).revocation, 'confirmed');
});

test('signing out with nothing stored sends no request', async () => {
  const t = app();
  const out = await t.controller.signOut();
  assert.equal(out.localClear, true);
  assert.equal(await out.revocation, 'none');
  assert.equal(t.net.calls.length, 0);
});

test('a Keychain read failure during sign-out still clears the tokens', async () => {
  const t = app();
  t.signedInAs('A');
  t.store.failOnce((o) => o.op === 'get' && o.key === REFRESH_KEY);
  const out = await t.controller.signOut();
  assert.equal(out.localClear, true);
  assert.deepEqual(t.stored(), { access: null, refresh: null });
  assert.equal(t.lastView().status, 'signedOut');
  assert.equal(await out.revocation, 'none', 'no token was readable, so none could be sent');
});

test('a Keychain delete that fails once is retried once; a persistent failure is reported, not hidden', async () => {
  const once = app();
  once.signedInAs('A');
  once.store.failOnce((o) => o.op === 'delete' && o.key === ACCESS_KEY);
  const recovered = await once.controller.signOut();
  assert.equal(recovered.localClear, true, 'the second attempt cleared it');
  assert.deepEqual(once.stored(), { access: null, refresh: null });

  const persistent = app();
  persistent.signedInAs('A');
  persistent.store.failOnce((o) => o.op === 'delete' && o.key === ACCESS_KEY);
  persistent.store.failOnce((o) => o.op === 'delete' && o.key === ACCESS_KEY);
  const out = await persistent.controller.signOut();
  assert.equal(persistent.lastView().status, 'signedOut', 'the screens leave the account regardless');
  assert.equal(out.localClear, false);
});

test('sign-out clears the active-workout pointer and nothing else of the device\'s preferences', async () => {
  const t = app();
  t.signedInAs('A');
  t.store.data.set(ACTIVE_KEY, 'workout-of-A');
  t.store.data.set('bodytrack.rest_seconds', '90');
  await t.controller.signOut();
  assert.equal(t.store.get(ACTIVE_KEY), null);
  assert.equal(t.store.get('bodytrack.rest_seconds'), '90');
});

test('session expiry is treated like sign-out for what the device remembers', async () => {
  const t = app();
  t.signedInAs('A');
  t.store.data.set(ACTIVE_KEY, 'workout-of-A');
  t.server.expireAccess();
  t.net.override((c) => c.path === '/auth/refresh', () => reply(401));
  await outcome(t.client.apiRequest('/users/me'));
  await flush();
  assert.equal(t.store.get(ACTIVE_KEY), null);
  assert.equal(t.counts.resets, 1);
  assert.equal(t.lastView().status, 'signedOut');
});

// ── 8. Launch-time restore ───────────────────────────────────────────────

test('a restore that finishes after the account changed is discarded', async () => {
  const t = app();
  t.signedInAs('A');
  const parked = t.net.hold((c) => c.path === '/users/me');
  const restoring = t.controller.restore();
  await parked.reached;
  await t.controller.signOut();
  parked.respond(reply(200, { email: 'a@example.com' }));
  assert.equal(await restoring, null);
});

test('a restore that nothing interrupts returns its result', async () => {
  const t = app();
  t.signedInAs('A');
  const restored = await t.controller.restore();
  assert.equal(restored.status, 'signedIn');
  assert.equal(restored.user.owner, 'A');
});

// ── 9. Token write order ─────────────────────────────────────────────────

test('a refreshed pair is written refresh token first', async () => {
  const t = app();
  t.signedInAs('A');
  t.server.expireAccess();
  await t.client.apiRequest('/users/me');
  const sets = t.store.log.filter((l) => l.startsWith('set:'));
  assert.deepEqual(sets, [`set:${REFRESH_KEY}`, `set:${ACCESS_KEY}`]);
});
