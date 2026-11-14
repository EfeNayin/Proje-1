// Run with node --test tests/password-recovery.test.cjs.
//
// Password recovery on the device. The real token storage, API client, auth API, session
// controller and recovery store are transpiled from source (see support/session-world.cjs);
// only the Keychain and the network are doubled, with timing the test controls. The
// "server" is a stand-in for the endpoints' contract (generic acknowledgement, 400 for any
// bad code, 204 and nothing else on success); what the real database, Redis and mailbox do
// is established by backend/tests/test_password_recovery.py and the native flow
// e2e/flows/password-recovery.yaml. Nothing here renders a screen; the screens are only
// checked statically at the end.
/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { ACCESS_KEY, REFRESH_KEY, createServer, createWorld, reply } = require('./support/session-world.cjs');

const root = path.resolve(__dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const REQUEST = '/auth/password-recovery/request';
const CONFIRM = '/auth/password-recovery/confirm';
const plain = (value) => JSON.parse(JSON.stringify(value));
const EMAIL = 'a@example.com';
const GOOD = { code: '12345678', password: 'brand-new-pass-9', confirmation: 'brand-new-pass-9' };

function app({ answerRequest, answerConfirm } = {}) {
  const world = createWorld();
  const { net, store } = world;
  const server = createServer(net);
  const client = world.load('api/client');
  const authApi = world.load('api/auth');
  const recovery = world.load('auth/recovery');
  const { createSessionController } = world.load('auth/sessionController');
  const clock = { now: 1_000_000 };
  const counts = { changed: 0, resets: 0 };
  const views = [];
  let store_;
  const controller = createSessionController({
    resetAccountState: () => { counts.resets += 1; store_.reset(); },
    apply: (view) => views.push(view),
  });
  client.setOnSessionExpired(() => controller.sessionExpired());
  store_ = recovery.createRecoveryStore({
    requestCode: authApi.requestPasswordRecovery,
    confirmReset: authApi.confirmPasswordRecovery,
    currentEpoch: client.currentAuthEpoch,
    now: () => clock.now,
    onChanged: () => { counts.changed += 1; },
  });
  net.override((e) => e.path === REQUEST, (e) => (answerRequest
    ? answerRequest(e)
    : reply(202, { message: 'If an account exists...', code_valid_minutes: 15, resend_after_seconds: 60 })));
  net.override((e) => e.path === CONFIRM, (e) => (answerConfirm ? answerConfirm(e) : reply(204)));
  const signedInAs = (user) => {
    const pair = server.seed(user);
    store.data.set(ACCESS_KEY, pair.access_token);
    store.data.set(REFRESH_KEY, pair.refresh_token);
    return pair;
  };
  return {
    ...world, ...recovery, server, client, controller, views, counts, clock, signedInAs,
    recovery: store_, state: () => plain(store_.getSnapshot()),
    calls: (p) => net.calls.filter((c) => c.path === p),
    stored: () => ({ access: store.get(ACCESS_KEY), refresh: store.get(REFRESH_KEY) }),
  };
}

const toConfirm = async (t) => { await t.recovery.requestCode(EMAIL); };

// ── the first step ───────────────────────────────────────────────────────

test('a malformed or empty address is refused on the device, with no request', async () => {
  const t = app();
  for (const bad of ['', '   ', 'no-at-sign', 'a@b', 'a b@c.d']) {
    const outcome = await t.recovery.requestCode(bad);
    assert.equal(outcome.kind, 'invalid', JSON.stringify(bad));
  }
  assert.equal(t.net.calls.length, 0);
  assert.equal(t.state().phase, 'request');
});

test('asking for a code sends only the address, then moves to the second step with it kept', async () => {
  const t = app();

  const outcome = await t.recovery.requestCode(`  ${EMAIL} `);

  assert.equal(outcome.kind, 'sent');
  assert.deepEqual(plain(t.calls(REQUEST)[0].body), { email: EMAIL });
  const state = t.state();
  assert.equal(state.phase, 'confirm');
  assert.equal(state.email, EMAIL);
  assert.equal(state.codeValidMinutes, 15);
  assert.equal(state.resendAvailableAt, t.clock.now + 60_000);
  assert.equal(state.working, null);
  assert.equal(t.calls(REQUEST)[0].auth, null, 'anonymous: no session is involved');
});

test('a second tap while the request runs is ignored (one request)', async () => {
  const t = app();
  const held = t.net.hold((e) => e.path === REQUEST);

  const first = t.recovery.requestCode(EMAIL);
  await held.reached;
  const second = await t.recovery.requestCode(EMAIL);
  assert.equal(second.kind, 'ignored');
  assert.equal(t.state().working, 'requesting');
  held.respond(reply(202, { message: 'm', code_valid_minutes: 15, resend_after_seconds: 60 }));

  assert.equal((await first).kind, 'sent');
  assert.equal(t.calls(REQUEST).length, 1);
});

test('failures of the request release the guard and are never retried by themselves', async () => {
  let status = 503;
  const t = app({ answerRequest: () => reply(status, { detail: 'down' }) });

  const unavailable = await t.recovery.requestCode(EMAIL);
  assert.equal(unavailable.kind, 'unavailable');
  assert.match(unavailable.message, /try again in a moment/i);
  assert.equal(t.calls(REQUEST).length, 1, 'no automatic retry');
  assert.equal(t.state().working, null);
  assert.equal(t.state().phase, 'request');

  status = 202;
  assert.equal((await t.recovery.requestCode(EMAIL)).kind, 'sent', 'a later, deliberate try works');
  assert.equal(t.calls(REQUEST).length, 2);
});

test('no connection at all is the same "could not send" state', async () => {
  const t = app({ answerRequest: () => new TypeError('offline') });

  const outcome = await t.recovery.requestCode(EMAIL);

  assert.equal(outcome.kind, 'unavailable');
  assert.equal(t.state().working, null);
});

test('a rate limit shows the server wording and sets the wait it names', async () => {
  const t = app({
    answerRequest: () => reply(429, { detail: 'A recovery code was requested recently. Try again in 40 seconds.' }),
  });

  const outcome = await t.recovery.requestCode(EMAIL);

  assert.equal(outcome.kind, 'rate-limited');
  assert.match(outcome.message, /40 seconds/);
  assert.equal(t.state().resendAvailableAt, t.clock.now + 40_000);
  assert.equal(t.state().phase, 'request', 'nothing was sent, so nothing moves on');
});

test('"I already have a code" goes to the second step without a request', async () => {
  const t = app();

  assert.equal(t.recovery.haveCode(' a@example.com '), null);

  assert.equal(t.net.calls.length, 0);
  assert.equal(t.state().phase, 'confirm');
  assert.equal(t.state().email, EMAIL);
  assert.equal(t.recovery.haveCode('nope').kind, 'invalid');
});

// ── resend ───────────────────────────────────────────────────────────────

test('a new code cannot be asked for during the cooldown, then can, and clears the wrong-code count', async () => {
  const t = app({ answerConfirm: () => reply(400, { detail: 'bad' }) });
  await toConfirm(t);
  await t.recovery.submitReset(GOOD);
  assert.equal(t.state().wrongCodes, 1);

  assert.equal((await t.recovery.requestCode(EMAIL, { resend: true })).kind, 'cooldown');
  assert.equal(t.calls(REQUEST).length, 1);

  t.clock.now += 60_000;
  assert.equal((await t.recovery.requestCode(EMAIL, { resend: true })).kind, 'sent');
  const state = t.state();
  assert.equal(state.resent, true);
  assert.equal(state.wrongCodes, 0);
  assert.equal(state.exhausted, false);
  assert.equal(t.calls(REQUEST).length, 2);
});

test('a refused resend stays on the second step with its message and a wait', async () => {
  let refuse = false;
  const t = app({
    answerRequest: () => (refuse
      ? reply(429, { detail: 'Try again in 2 minutes.' })
      : reply(202, { message: 'm', code_valid_minutes: 15, resend_after_seconds: 60 })),
  });
  await toConfirm(t);
  t.clock.now += 61_000;
  refuse = true;

  const outcome = await t.recovery.requestCode(EMAIL, { resend: true });

  assert.equal(outcome.kind, 'rate-limited');
  assert.equal(t.state().phase, 'confirm');
  assert.equal(t.state().resendAvailableAt, t.clock.now + 120_000);
});

// ── the second step: what is checked on the device ───────────────────────

test('the code and the new password are checked before anything is sent', async () => {
  const t = app();
  await toConfirm(t);
  const cases = [
    [{ ...GOOD, code: '' }, /8-digit code/],
    [{ ...GOOD, code: '1234567' }, /8-digit code/],
    [{ ...GOOD, code: '1234 56ab' }, /8-digit code/],
    [{ ...GOOD, password: 'short', confirmation: 'short' }, /at least 8/],
    [{ ...GOOD, password: 'ş'.repeat(37), confirmation: 'ş'.repeat(37) }, /too long/],
    [{ ...GOOD, confirmation: 'something-else-1' }, /do not match/],
  ];
  for (const [input, message] of cases) {
    const outcome = await t.recovery.submitReset(input);
    assert.equal(outcome.kind, 'invalid');
    assert.match(outcome.message, message);
  }
  assert.equal(t.calls(CONFIRM).length, 0);
  assert.equal(t.state().working, null, 'the guard is free after each refusal');
});

test('the byte limit counts bytes, not characters, and the longest allowed password goes through whole', async () => {
  const t = app();
  await toConfirm(t);
  assert.equal(t.utf8Length('ş'.repeat(36)), 72);
  assert.equal(t.utf8Length('a'.repeat(72)), 72);
  const longest = 'ş'.repeat(36);

  const outcome = await t.recovery.submitReset({ code: '1234 5678', password: longest, confirmation: longest });

  assert.equal(outcome.kind, 'changed');
  assert.deepEqual(plain(t.calls(CONFIRM)[0].body), {
    email: EMAIL, code: '12345678', new_password: longest,
  });
});

test('a pasted code is reduced to its digits', async () => {
  const t = app();
  assert.equal(t.normalizeCode(' 1234 5678\n'), '12345678');
  assert.equal(t.normalizeCode('1234-5678'), '12345678');
  assert.equal(t.normalizeCode('1234 567'), null);
  assert.equal(t.normalizeCode('１２３４５６７８'), null, 'full-width digits are not accepted');
});

test('the wait named in a rate-limit message is read in seconds, minutes and hours', () => {
  const { waitFromMessage } = app();
  assert.equal(waitFromMessage('Try again in 1 second.'), 1000);
  assert.equal(waitFromMessage('Try again in 12 minutes.'), 720_000);
  assert.equal(waitFromMessage('Try again in 2 hours.'), 7_200_000);
  assert.equal(waitFromMessage('Slow down'), null);
});

// ── the second step: answers ─────────────────────────────────────────────

test('204 is the only proof: the flow is done, the notice is raised once, nobody is signed in', async () => {
  const t = app();
  await toConfirm(t);

  const outcome = await t.recovery.submitReset(GOOD);

  assert.equal(outcome.kind, 'changed');
  assert.equal(t.state().phase, 'done');
  assert.equal(t.counts.changed, 1);
  assert.deepEqual(t.stored(), { access: null, refresh: null }, 'no tokens: it does not sign in');
  assert.equal(t.views.length, 0, 'the session controller was never involved');
  assert.deepEqual(t.net.calls.map((c) => c.path), [REQUEST, CONFIRM]);
  assert.equal(t.calls(CONFIRM)[0].auth, null);
});

test('the code and passwords go in one request body and are kept nowhere', async () => {
  const t = app();
  await toConfirm(t);
  await t.recovery.submitReset(GOOD);

  assert.equal(JSON.stringify(t.net.calls.filter((c) => c.path !== CONFIRM)).includes(GOOD.password), false);
  assert.equal(JSON.stringify(t.net.calls.filter((c) => c.path !== CONFIRM)).includes(GOOD.code), false);
  const kept = JSON.stringify(t.state());
  assert.equal(kept.includes(GOOD.password), false);
  assert.equal(kept.includes(GOOD.code), false);
  assert.equal([...t.store.data.values()].some((v) => String(v).includes(GOOD.password)), false);
  assert.deepEqual(t.store.log, [], 'nothing was written to the Keychain at all');
});

test('a wrong code keeps the step, says so, and can be retried; five make the code unusable', async () => {
  const t = app({ answerConfirm: () => reply(400, { detail: 'That code is not valid...' }) });
  await toConfirm(t);

  for (let n = 1; n <= 4; n += 1) {
    const outcome = await t.recovery.submitReset(GOOD);
    assert.equal(outcome.kind, 'wrong-code');
    assert.match(outcome.message, /not valid|expired/);
    assert.equal(t.state().phase, 'confirm');
    assert.equal(t.state().wrongCodes, n);
  }
  const last = await t.recovery.submitReset(GOOD);
  assert.equal(last.kind, 'exhausted');
  assert.equal(t.state().exhausted, true);

  const before = t.calls(CONFIRM).length;
  const refused = await t.recovery.submitReset(GOOD);
  assert.equal(refused.kind, 'exhausted');
  assert.equal(t.calls(CONFIRM).length, before, 'a used-up code is not sent again');
  assert.equal(t.counts.changed, 0);
});

test('failures that happened before anything changed say the password is unchanged', async () => {
  for (const [status, kind, message] of [
    [503, 'unavailable', /has not been changed/],
    [429, 'rate-limited', /Try again/],
    [422, 'invalid', /not accepted/],
  ]) {
    const t = app({ answerConfirm: () => reply(status, { detail: 'Try again in 5 minutes.' }) });
    await toConfirm(t);
    const outcome = await t.recovery.submitReset(GOOD);
    assert.equal(outcome.kind, kind, String(status));
    assert.match(outcome.message, message);
    assert.equal(t.state().phase, 'confirm');
    assert.equal(t.state().working, null, 'the guard is released');
    assert.equal(t.counts.changed, 0);
  }
});

test('no answer, or a server error, is "unconfirmed": it never claims either outcome', async () => {
  for (const answer of [() => new TypeError('offline'), () => reply(500, { detail: 'boom' })]) {
    const t = app({ answerConfirm: answer });
    await toConfirm(t);

    const outcome = await t.recovery.submitReset(GOOD);

    assert.equal(outcome.kind, 'unconfirmed');
    assert.match(outcome.message, /could not confirm/);
    assert.match(outcome.message, /new password/);
    assert.equal(t.state().phase, 'confirm', 'the step stays, so the same code can be tried again');
    assert.equal(t.counts.changed, 0, 'no success is announced');
    assert.equal(t.calls(CONFIRM).length, 1, 'nothing retries on its own');
  }
});

test('after any failure the same inputs can be submitted again', async () => {
  let status = 503;
  const t = app({ answerConfirm: () => reply(status, status === 204 ? undefined : { detail: 'x' }) });
  await toConfirm(t);
  assert.equal((await t.recovery.submitReset(GOOD)).kind, 'unavailable');

  status = 204;
  assert.equal((await t.recovery.submitReset(GOOD)).kind, 'changed');
  assert.equal(t.calls(CONFIRM).length, 2);
});

test('a second submit while one runs is ignored (one request)', async () => {
  const t = app();
  await toConfirm(t);
  const held = t.net.hold((e) => e.path === CONFIRM);

  const first = t.recovery.submitReset(GOOD);
  await held.reached;
  assert.equal((await t.recovery.submitReset(GOOD)).kind, 'ignored');
  assert.equal((await t.recovery.requestCode(EMAIL, { resend: true })).kind, 'ignored');
  held.respond(reply(204));

  assert.equal((await first).kind, 'changed');
  assert.equal(t.calls(CONFIRM).length, 1);
  assert.equal(t.counts.changed, 1);
});

// ── leaving, and other accounts ──────────────────────────────────────────

test('leaving the screen mid-request drops the late answer: no result, no notice', async () => {
  const t = app();
  await toConfirm(t);
  const held = t.net.hold((e) => e.path === CONFIRM);
  const running = t.recovery.submitReset(GOOD);
  await held.reached;

  t.recovery.reset();
  held.respond(reply(204));

  assert.equal((await running).kind, 'obsolete');
  assert.equal(t.state().phase, 'request');
  assert.equal(t.state().email, '', 'the address is forgotten with the visit');
  assert.equal(t.counts.changed, 0);
});

test('a late answer for the old visit does not disturb a new one', async () => {
  const t = app();
  await toConfirm(t);
  const held = t.net.hold((e) => e.path === CONFIRM);
  const running = t.recovery.submitReset(GOOD);
  await held.reached;
  t.recovery.reset();
  await t.recovery.requestCode('other@example.com');

  held.respond(reply(204));

  assert.equal((await running).kind, 'obsolete');
  assert.equal(t.state().phase, 'confirm');
  assert.equal(t.state().email, 'other@example.com');
  assert.equal(t.counts.changed, 0);
});

test('a delayed answer after another account signed in changes nothing about that account', async () => {
  const t = app();
  t.signedInAs('A');
  await toConfirm(t);
  const held = t.net.hold((e) => e.path === CONFIRM);
  const running = t.recovery.submitReset(GOOD);
  await held.reached;

  // Account A signs out and account B signs in while the reset is still unanswered.
  await t.controller.signOut();
  await t.controller.signIn(t.server.emails.B, 'right');
  const tokensOfB = t.stored();
  const viewsBefore = t.views.length;
  held.respond(reply(204));

  assert.equal((await running).kind, 'obsolete');
  assert.deepEqual(t.stored(), tokensOfB, "B's tokens are untouched");
  assert.notEqual(tokensOfB.access, null);
  assert.equal(t.views.length, viewsBefore, 'no sign-out, no view change');
  assert.equal(t.counts.changed, 0, 'no notice for a flow that is no longer ours');
});

test('a session that expires while the reset runs is not revived or cleared by it', async () => {
  const t = app();
  t.signedInAs('A');
  await toConfirm(t);
  const held = t.net.hold((e) => e.path === CONFIRM);
  const running = t.recovery.submitReset(GOOD);
  await held.reached;
  t.client.advanceAuthEpoch();

  held.respond(reply(204));

  assert.equal((await running).kind, 'obsolete');
  assert.equal(t.counts.changed, 0);
});

test('the different-email link keeps the address and nothing else', async () => {
  const t = app({ answerConfirm: () => reply(400, { detail: 'x' }) });
  await toConfirm(t);
  await t.recovery.submitReset(GOOD);

  t.recovery.changeEmail();

  assert.equal(t.state().phase, 'request');
  assert.equal(t.state().email, EMAIL);
  assert.equal(t.state().error, null);
});

// ── the screens, statically ──────────────────────────────────────────────

test('sign-in links to recovery, carries the address (never the password) and shows the notice', () => {
  const source = read('app/(auth)/login.tsx');
  assert.match(source, /accessibilityLabel="Forgot password\?"/);
  assert.match(source, /router\.push\("\/forgot-password"\)/);
  assert.match(source, /recoveryStore\.setEmail\(email\.trim\(\)\)/);
  assert.doesNotMatch(source, /forgot-password\?|forgot-password[^"]*password/);
  assert.match(source, /Your password was changed\. Sign in with your new password\./);
});

test('recovery screen: autofill, keyboard, visibility, confirmation and accessible controls', () => {
  const source = read('app/(auth)/forgot-password.tsx');
  for (const prop of [
    'textContentType="oneTimeCode"', 'keyboardType="number-pad"', 'textContentType="newPassword"',
    'autoComplete="new-password"', 'secureTextEntry={!showPasswords}', 'returnKeyType="go"',
    'keyboardShouldPersistTaps="handled"', 'KeyboardAvoidingView', 'accessibilityLiveRegion="polite"',
    '"Hide passwords" : "Show passwords"', 'accessibilityLabel="Confirm new password"',
    'accessibilityLabel="Reset code"',
  ]) assert.ok(source.includes(prop), prop);
  for (const id of ['recovery-email', 'recovery-send', 'recovery-code', 'recovery-password',
    'recovery-confirm', 'recovery-submit', 'recovery-resend', 'recovery-done']) {
    assert.ok(source.includes(`testID="${id}"`), id);
  }
  assert.match(source, /disabled=\{resetting \|\| recovery\.exhausted\}|disabled=\{locked \|\| recovery\.exhausted\}/);
  assert.match(source, /lightTheme/);
  assert.doesNotMatch(source, /romanTheme|LinearGradient|gold/i);
});

test('nothing in recovery writes to storage or puts a secret in a route', () => {
  for (const file of ['src/auth/recovery.ts', 'src/auth/recoverySession.ts', 'src/auth/useRecovery.ts',
    'app/(auth)/forgot-password.tsx']) {
    const source = read(file);
    assert.doesNotMatch(source, /SecureStore|AsyncStorage|localStorage|setItemAsync|console\./, file);
    assert.doesNotMatch(source, /params|searchParams|href=\{\{/, file);
  }
  const api = read('src/api/auth.ts');
  assert.match(api, /password-recovery\/request[\s\S]*anonymous: true/);
  assert.match(api, /password-recovery\/confirm[\s\S]*anonymous: true/);
});

test('the session is reset around recovery: AuthContext drops it and clears the notice on sign-in', () => {
  const source = read('src/auth/AuthContext.tsx');
  assert.match(source, /recoveryStore\.reset\(\)/);
  assert.match(source, /clearPasswordChangedNotice\(\)/);
});
