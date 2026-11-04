// Run with node --test tests/account-deletion.test.cjs.
//
// Deleting the account from the app. The real token storage, API client, auth API,
// session controller and deletion store are transpiled from source (see
// support/session-world.cjs); only the Keychain and the network are doubled, with
// timing the test controls. The "server" is a stand-in for the endpoint's contract
// (own account only, right password or 403, 204 and nothing of the account left);
// what the real database does is established by backend/tests/test_account_deletion.py.
// Nothing here renders a screen: the on-device behaviour is covered by the Maestro
// flow e2e/flows/account-deletion.yaml, and the screen source is only checked
// statically at the end of this file.
/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { ACCESS_KEY, REFRESH_KEY, createServer, createWorld, reply } = require('./support/session-world.cjs');

const root = path.resolve(__dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const ACTIVE_KEY = 'bodytrack.active_workout_id';
const DELETE = '/users/me/delete-account';
const flush = () => new Promise(setImmediate);
// Objects made inside the vm have another Object.prototype; compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value));

function app() {
  const world = createWorld();
  const { net, store } = world;
  const server = createServer(net);
  const client = world.load('api/client');
  const authApi = world.load('api/auth');
  const { createSessionController } = world.load('auth/sessionController');
  const { createAccountDeletionStore } = world.load('account/deletion');
  const views = [];
  const counts = { resets: 0, announced: 0 };
  let deletion;
  const controller = createSessionController({
    resetAccountState: () => { counts.resets += 1; deletion.reset(); },
    apply: (view) => views.push(view),
    announceDeletion: () => { counts.announced += 1; },
  });
  client.setOnSessionExpired(() => controller.sessionExpired());
  deletion = createAccountDeletionStore({
    deleteAccount: authApi.deleteAccount,
    currentEpoch: client.currentAuthEpoch,
  });
  deletion.setOnDeleted((epoch) => controller.accountDeleted(epoch));

  function signedInAs(user) {
    const pair = server.seed(user);
    store.data.set(ACCESS_KEY, pair.access_token);
    store.data.set(REFRESH_KEY, pair.refresh_token);
    return pair;
  }
  return {
    ...world, server, client, controller, deletion, views, counts, signedInAs,
    stored: () => ({ access: store.get(ACCESS_KEY), refresh: store.get(REFRESH_KEY) }),
    lastView: () => views[views.length - 1],
    deleteCalls: () => net.calls.filter((c) => c.path === DELETE),
    state: () => plain(deletion.getSnapshot()),
  };
}

const signedIn = (t) => t.stored().access !== null && t.stored().refresh !== null;

// ── leaving without deleting ─────────────────────────────────────────────

test('cancelling, or leaving the screen, sends nothing and changes nothing', async () => {
  const t = app();
  t.signedInAs('A');

  t.deletion.leave();

  assert.equal(t.net.calls.length, 0);
  assert.equal(signedIn(t), true);
  assert.deepEqual(t.state(), { phase: 'idle', error: null });
});

test('an empty password is refused on the device, with no request', async () => {
  const t = app();
  t.signedInAs('A');

  const outcome = await t.deletion.submit('');

  assert.equal(outcome.kind, 'invalid');
  assert.equal(t.net.calls.length, 0);
  assert.equal(t.state().phase, 'failed');
  assert.equal(signedIn(t), true);
});

test('leaving after a failure forgets the failure', async () => {
  const t = app();
  t.signedInAs('A');
  await t.deletion.submit('nope');
  assert.equal(t.state().phase, 'failed');

  t.deletion.leave();

  assert.deepEqual(t.state(), { phase: 'idle', error: null });
});

// ── a wrong password is not a dead session ───────────────────────────────

test('a wrong password says so, keeps the session and the account, and can be retried', async () => {
  const t = app();
  t.signedInAs('A');

  const outcome = await t.deletion.submit('not-the-password');

  assert.equal(outcome.kind, 'wrong-password');
  assert.match(outcome.message, /not correct/);
  assert.match(outcome.message, /has not been deleted/);
  assert.equal(signedIn(t), true, 'tokens kept');
  assert.equal(t.net.count('/auth/refresh'), 0, '403 is not read as an expired session');
  assert.equal(t.net.count('/auth/logout'), 0);
  assert.equal(t.counts.announced, 0);
  assert.equal(t.views.length, 0, 'the screens never left the account');
  assert.equal(t.server.isDeleted('A'), false);
  assert.equal(t.state().phase, 'failed');

  const retry = await t.deletion.submit('right');
  assert.equal(retry.kind, 'deleted');
  assert.equal(t.server.isDeleted('A'), true);
});

// ── a confirmed deletion ─────────────────────────────────────────────────

test('204 signs the device out: tokens, active workout and screens, with no sign-out request', async () => {
  const t = app();
  t.signedInAs('A');
  t.store.data.set(ACTIVE_KEY, 'workout-of-A');

  const outcome = await t.deletion.submit('right');

  assert.equal(outcome.kind, 'deleted');
  assert.deepEqual(t.stored(), { access: null, refresh: null });
  assert.equal(t.store.get(ACTIVE_KEY), null);
  assert.equal(t.lastView().status, 'signedOut');
  assert.equal(t.counts.resets, 1);
  assert.equal(t.counts.announced, 1, 'the sign-in screen is told it was a deletion');
  assert.equal(t.net.count('/auth/logout'), 0, 'its sessions went with the account');
  assert.equal(t.server.isDeleted('A'), true);
});

test('the password goes in one request body and nowhere else', async () => {
  const t = app();
  t.signedInAs('A');

  await t.deletion.submit('right');

  const [call] = t.deleteCalls();
  assert.equal(t.deleteCalls().length, 1);
  assert.equal(call.method, 'POST');
  assert.equal(call.path, DELETE, 'no query string, no id in the path');
  assert.deepEqual(plain(call.body), { password: 'right' }, 'no user id, no extra fields');
  assert.equal(JSON.stringify(t.net.calls.filter((c) => c.path !== DELETE)).includes('right'), false);
  assert.equal(JSON.stringify(t.state()).includes('right'), false, 'the store keeps no copy');
  assert.equal([...t.store.data.values()].some((v) => String(v).includes('right')), false, 'nothing is stored');
});

test('after a confirmed deletion a relaunch stays signed out, and the old tokens are dead', async () => {
  const t = app();
  const pair = t.signedInAs('A');
  await t.deletion.submit('right');
  const before = t.net.calls.length;

  const restored = await t.controller.restore();

  assert.equal(restored.status, 'signedOut');
  assert.equal(t.net.calls.length, before, 'nothing to restore, so no request');
  // What the old session held cannot authenticate any more.
  const me = await t.net.fetch('https://bodytrack.test/api/v1/users/me', {
    headers: { Authorization: `Bearer ${pair.access_token}` },
  });
  assert.equal(me.status, 401);
  const refresh = await t.net.fetch('https://bodytrack.test/api/v1/auth/refresh', {
    method: 'POST', body: JSON.stringify({ refresh_token: pair.refresh_token }),
  });
  assert.equal(refresh.status, 401);
  const login = await t.controller.signIn(t.server.emails.A, 'right').then(() => 'in', () => 'refused');
  assert.equal(login, 'refused', 'the credentials no longer sign in');
  assert.equal(signedIn(t), false);
});

test('an expired access token is renewed once and the deletion goes through', async () => {
  const t = app();
  t.signedInAs('A');
  t.server.expireAccess();

  const outcome = await t.deletion.submit('right');

  assert.equal(outcome.kind, 'deleted');
  assert.equal(t.net.count('/auth/refresh'), 1);
  assert.equal(t.deleteCalls().length, 2, 'refused once as expired, then sent again');
  assert.equal(t.server.isDeleted('A'), true);
});

// ── answers that do not settle it ────────────────────────────────────────

test('a lost connection is "unconfirmed": nothing is claimed, nothing on the device changes', async () => {
  const t = app();
  t.signedInAs('A');
  const parked = t.net.hold((c) => c.path === DELETE);

  const pending = t.deletion.submit('right');
  await parked.reached;
  assert.equal(t.state().phase, 'deleting');
  parked.fail();
  const outcome = await pending;

  assert.equal(outcome.kind, 'unconfirmed');
  assert.match(outcome.message, /could not confirm/i);
  assert.doesNotMatch(outcome.message, /has been deleted|is deleted|deleted successfully/i);
  assert.equal(signedIn(t), true);
  assert.equal(t.counts.announced, 0);
  assert.equal(t.views.length, 0);
  assert.equal(t.state().phase, 'failed');
});

test('an unconfirmed attempt that had in fact succeeded: trying again ends signed out, without claiming deletion', async () => {
  const t = app();
  const pair = t.signedInAs('A');
  const parked = t.net.hold((c) => c.path === DELETE);
  const first = t.deletion.submit('right');
  await parked.reached;
  // The server did delete the account, but the answer is lost on the way back.
  await t.net.fetch('https://bodytrack.test/api/v1/users/me/delete-account', {
    method: 'POST',
    headers: { Authorization: `Bearer ${pair.access_token}` },
    body: JSON.stringify({ password: 'right' }),
  });
  parked.fail();
  assert.equal((await first).kind, 'unconfirmed');
  assert.equal(signedIn(t), true, 'the device cannot know, so it keeps the session');

  const again = await t.deletion.submit('right');

  assert.equal(again.kind, 'obsolete', 'the dead session ended the app session instead');
  assert.equal(t.lastView().status, 'signedOut');
  assert.equal(t.counts.announced, 0, 'no proof, so no "deleted" notice');
  assert.deepEqual(t.stored(), { access: null, refresh: null });
  assert.equal((await t.controller.restore()).status, 'signedOut');
});

test('a request that never answers gives up as "no answer", the same as a lost connection', async () => {
  const t = app();
  t.signedInAs('A');
  t.net.hold((c) => c.path === '/users/me'); // never answered

  const result = await t.client.apiRequest('/users/me', { timeoutMs: 20 }).then(
    () => null,
    (error) => error,
  );

  assert.equal(result.status, 0);
  const { classifyDeletionError } = t.load('account/deletion');
  assert.equal(classifyDeletionError(result).kind, 'unconfirmed');
  assert.equal(signedIn(t), true, 'a timeout is not an expired session');
});

test('the deletion request carries a deadline, so the screen cannot wait forever', () => {
  assert.match(read('src/api/auth.ts'), /timeoutMs: DELETE_ACCOUNT_TIMEOUT_MS/);
});

for (const [status, kind, pattern] of [
  [429, 'rate-limited', /Too many attempts/],
  [503, 'not-deleted', /nothing was deleted/],
  [500, 'unconfirmed', /could not confirm/i],
  [502, 'unconfirmed', /could not confirm/i],
  [422, 'invalid', /Enter your current password/],
  [400, 'rejected', /refused|detail from server/],
]) {
  test(`${status} is "${kind}", and the session stays`, async () => {
    const t = app();
    t.signedInAs('A');
    t.net.override((c) => c.path === DELETE, () => reply(status, { detail: 'detail from server' }));

    const outcome = await t.deletion.submit('right');

    assert.equal(outcome.kind, kind);
    assert.match(outcome.message, pattern);
    assert.equal(signedIn(t), true);
    assert.equal(t.counts.announced, 0);
    assert.equal(t.net.count('/auth/refresh'), 0);
    assert.equal(t.state().phase, 'failed');
    assert.equal(t.state().error.kind, kind);
  });
}

// ── one request at a time ────────────────────────────────────────────────

test('tapping twice sends one request', async () => {
  const t = app();
  t.signedInAs('A');
  const parked = t.net.hold((c) => c.path === DELETE);

  const first = t.deletion.submit('right');
  await parked.reached;
  const second = await t.deletion.submit('right');
  const third = await t.deletion.submit('right');

  assert.equal(second.kind, 'ignored');
  assert.equal(third.kind, 'ignored');
  assert.equal(t.deleteCalls().length, 1);
  assert.equal(t.state().phase, 'deleting');

  parked.respond(reply(204));
  assert.equal((await first).kind, 'deleted');
  assert.equal(t.deleteCalls().length, 1);
});

test('leaving the screen mid-request does not stop the deletion or its sign-out', async () => {
  const t = app();
  t.signedInAs('A');
  const parked = t.net.hold((c) => c.path === DELETE);
  const pending = t.deletion.submit('right');
  await parked.reached;

  t.deletion.leave();
  assert.equal(t.state().phase, 'deleting', 'the request is still ours to finish');

  parked.respond(reply(204));
  assert.equal((await pending).kind, 'deleted');
  assert.equal(t.lastView().status, 'signedOut');
  assert.deepEqual(t.stored(), { access: null, refresh: null });
});

// ── the account changes while the request runs ───────────────────────────

test('signed out and into another account meanwhile: the late 204 touches nothing of the new account', async () => {
  const t = app();
  t.signedInAs('A');
  const answer = t.net.delay((c) => c.path === DELETE);
  const pending = t.deletion.submit('right');
  await answer.reached; // the server deleted A; the answer is on its way

  await t.controller.signOut();
  await t.controller.signIn(t.server.emails.B, 'right');
  const announced = t.counts.announced;
  const resets = t.counts.resets;
  answer.release();
  const outcome = await pending;

  assert.equal(outcome.kind, 'obsolete');
  assert.match(t.stored().access, /^B-access-/, "B's tokens are still there");
  assert.match(t.stored().refresh, /^B-refresh-/);
  assert.equal(t.lastView().status, 'signedIn');
  assert.equal(t.counts.announced, announced, 'no "deleted" notice for B');
  assert.equal(t.counts.resets, resets, "B's state was not reset");
  assert.deepEqual(t.state(), { phase: 'idle', error: null }, 'nothing of A\'s attempt is shown');
});

test('signed straight into another account (no sign-out): the late 204 is dropped by the epoch alone', async () => {
  const t = app();
  t.signedInAs('A');
  const answer = t.net.delay((c) => c.path === DELETE);
  const pending = t.deletion.submit('right');
  await answer.reached;

  await t.controller.signIn(t.server.emails.B, 'right'); // does not reset the stores
  answer.release();
  const outcome = await pending;

  assert.equal(outcome.kind, 'obsolete');
  assert.match(t.stored().access, /^B-access-/);
  assert.equal(t.lastView().status, 'signedIn');
  assert.equal(t.counts.announced, 0);
});

test('a late wrong-password answer for the old account shows nothing on the new one', async () => {
  const t = app();
  t.signedInAs('A');
  const parked = t.net.hold((c) => c.path === DELETE);
  const pending = t.deletion.submit('bad');
  await parked.reached;
  await t.controller.signOut();
  await t.controller.signIn(t.server.emails.B, 'right');

  parked.respond(reply(403, { detail: 'Incorrect password' }));

  assert.equal((await pending).kind, 'obsolete');
  assert.deepEqual(t.state(), { phase: 'idle', error: null });
});

test("the new account's own deletion is not held up by the old account's request", async () => {
  const t = app();
  t.signedInAs('A');
  const parked = t.net.hold((c) => c.path === DELETE);
  const old = t.deletion.submit('right');
  await parked.reached;
  await t.controller.signOut();
  await t.controller.signIn(t.server.emails.B, 'right');

  const mine = await t.deletion.submit('right');

  assert.equal(mine.kind, 'deleted');
  assert.equal(t.server.isDeleted('B'), true);
  parked.respond(reply(204));
  assert.equal((await old).kind, 'obsolete');
});

test('the session ending during the request is a plain sign-out, not a claim of deletion', async () => {
  const t = app();
  t.signedInAs('A');
  t.store.data.set(REFRESH_KEY, 'unknown-to-the-server');
  t.server.expireAccess();

  const outcome = await t.deletion.submit('right');

  assert.equal(outcome.kind, 'obsolete');
  assert.equal(t.lastView().status, 'signedOut');
  assert.equal(t.counts.announced, 0, 'nothing proved the account was deleted');
  assert.deepEqual(t.state(), { phase: 'idle', error: null });
});

test('a deletion confirmed under a sign-in that is over ends nothing', async () => {
  const t = app();
  t.signedInAs('A');
  const epoch = t.client.currentAuthEpoch();
  t.client.advanceAuthEpoch(); // another sign-in has begun

  const result = await t.controller.accountDeleted(epoch);

  assert.equal(result.applied, false);
  assert.equal(signedIn(t), true);
  assert.equal(t.views.length, 0);
  assert.equal(t.counts.announced, 0);
});

test('a failure to clear the Keychain does not undo the sign-out; the next launch finishes it', async () => {
  const t = app();
  t.signedInAs('A');
  t.store.failOnce((o) => o.op === 'get' && o.key === REFRESH_KEY);
  t.store.failOnce((o) => o.op === 'delete');

  const outcome = await t.deletion.submit('right');

  assert.equal(outcome.kind, 'deleted');
  assert.equal(t.lastView().status, 'signedOut', 'the screens left regardless');
  // Whatever a failed Keychain left behind, the server no longer knows it.
  const relaunch = await t.controller.restore();
  assert.notEqual(relaunch.status, 'signedIn');
});

// ── the store alone, with the epoch and reset under the test's control ───

function bare() {
  const { createAccountDeletionStore } = createWorld().load('account/deletion');
  let epoch = 1;
  const pending = [];
  const deleted = [];
  const store = createAccountDeletionStore({
    deleteAccount: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    currentEpoch: () => epoch,
  });
  store.setOnDeleted((e) => { deleted.push(e); });
  return { store, pending, deleted, moveOn: () => { epoch += 1; } };
}

test('store: a success whose sign-in has ended is dropped even if nobody reset the store', async () => {
  const s = bare();
  const submitted = s.store.submit('pw');
  s.moveOn();
  s.pending[0].resolve();

  assert.equal((await submitted).kind, 'obsolete');
  assert.deepEqual(s.deleted, []);
});

test('store: a confirmed deletion hands over the epoch it was made under, once', async () => {
  const s = bare();
  const submitted = s.store.submit('pw');
  s.pending[0].resolve();

  assert.equal((await submitted).kind, 'deleted');
  assert.deepEqual(s.deleted, [1]);
});

test('store: reset voids the running request; its failure is not shown', async () => {
  const s = bare();
  const submitted = s.store.submit('pw');
  s.store.reset();
  s.pending[0].reject(Object.assign(new Error('x'), { status: 0 }));

  assert.equal((await submitted).kind, 'obsolete');
  assert.deepEqual(plain(s.store.getSnapshot()), { phase: 'idle', error: null });
});

test('store: a thrown value that is not an API error is "unconfirmed", never "deleted"', async () => {
  const s = bare();
  const submitted = s.store.submit('pw');
  s.pending[0].reject(new Error('boom'));

  const outcome = await submitted;
  assert.equal(outcome.kind, 'unconfirmed');
  assert.deepEqual(s.deleted, []);
});

test('store: with no session handler registered a confirmed deletion still ends cleanly', async () => {
  const s = bare();
  s.store.setOnDeleted(null);
  const submitted = s.store.submit('pw');
  s.pending[0].resolve();

  assert.equal((await submitted).kind, 'deleted');
  assert.equal(s.store.getSnapshot().phase, 'deleted');
});

test('store: subscribers hear about every change, and unsubscribing stops them', async () => {
  const s = bare();
  const phases = [];
  const off = s.store.subscribe(() => phases.push(s.store.getSnapshot().phase));
  const submitted = s.store.submit('pw');
  s.pending[0].reject(Object.assign(new Error('x'), { status: 403 }));
  await submitted;
  off();
  s.store.leave();

  assert.deepEqual(phases, ['deleting', 'failed']);
});

// ── the screen, read as source (nothing here renders it) ─────────────────

test('screen source: secure field, two-step confirmation, cancel paths, no persistence of the password', () => {
  const source = read('app/(app)/profile/delete-account.tsx');
  assert.match(source, /secureTextEntry=\{!showPassword\}/);
  assert.match(source, /accessibilityLabel="Current password"/);
  assert.match(source, /Yes, delete my account/);
  assert.match(source, /Keep my account/);
  assert.match(source, /accessibilityLabel="Cancel"/);
  assert.match(source, /cannot be undone/i);
  assert.match(source, /minHeight: 52/);
  assert.match(source, /useSafeAreaInsets/);
  assert.match(source, /KeyboardAvoidingView/);
  assert.match(source, /gestureEnabled: !deleting/);
  assert.match(source, /hardwareBackPress/);
  assert.doesNotMatch(source, /SecureStore|AsyncStorage|console\./, 'the password is never stored or logged');
  assert.doesNotMatch(source, /router\.(push|replace|navigate)\([^)]*password/, 'never passed through a route');
  assert.doesNotMatch(source, /params/, 'no route params carry anything');
});

test('the Profile screen offers it under Account, and the route is registered', () => {
  const profile = read('app/(app)/(tabs)/profile.tsx');
  assert.match(profile, /label="Delete account"/);
  assert.match(profile, /router\.push\("\/profile\/delete-account"\)/);
  assert.match(read('app/(app)/_layout.tsx'), /name="profile\/delete-account"/);
});

test('the sign-in screen can say the account was deleted, and the notice is cleared on sign-in', () => {
  assert.match(read('app/(auth)/login.tsx'), /Your account has been deleted/);
  assert.match(read('src/auth/AuthContext.tsx'), /if \(view\.status === "signedIn"\) \{\s*clearAccountDeletedNotice\(\)/);
  assert.match(read('src/auth/AuthContext.tsx'), /accountDeletionStore\.reset\(\)/);
});

test('every wait in this file settled', async () => {
  await flush();
});
