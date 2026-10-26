// Run with node --test tests/rate-limit-handling.test.cjs. No network, no native modules.
//
// What the app does when the backend answers an auth request with 429 (rate
// limited) or 503 (the limiter's Redis is unavailable). The rule under test: only
// an explicit 401 ends a session; a limit or an outage must keep the tokens, keep
// the form usable, and never trigger a retry loop.
/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const mobileRoot = path.resolve(__dirname, '..');
const ts = require(require.resolve('typescript', {
  paths: [process.env.BODYTRACK_DEPENDENCIES || mobileRoot],
}));

function load(file, requires, globals = {}) {
  const code = ts.transpileModule(readFileSync(path.join(mobileRoot, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module_ = { exports: {} };
  const require_ = (name) => {
    if (!(name in requires)) throw new Error(`unexpected import ${name}`);
    return requires[name];
  };
  vm.runInNewContext(code, {
    module: module_, exports: module_.exports, require: require_,
    Error, Promise, JSON, ...globals,
  });
  return module_.exports;
}

function reply(status, body, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name] ?? null },
    json: async () => body,
  };
}

// The API client with an in-memory token store and a scripted fetch.
function clientWith(script) {
  const store = { access: 'access-1', refresh: 'refresh-1' };
  const calls = [];
  let expired = 0;
  const tokens = {
    saveTokens: async (pair) => { store.access = pair.access_token; store.refresh = pair.refresh_token; },
    getAccessToken: async () => store.access,
    getRefreshToken: async () => store.refresh,
    clearTokens: async () => { store.access = null; store.refresh = null; },
  };
  const fetch = async (url, options) => {
    const entry = { url: url.replace('http://api.test/api/v1', ''), method: options.method };
    calls.push(entry);
    return script(entry);
  };
  const exports_ = load('src/api/client.ts', {
    '../config': { API_URL: 'http://api.test', API_PREFIX: '/api/v1' },
    './tokens': tokens,
  }, { fetch });
  exports_.setOnSessionExpired(() => { expired += 1; });
  const refreshCalls = () => calls.filter((c) => c.url === '/auth/refresh').length;
  return { ...exports_, store, calls, refreshCalls, expired: () => expired };
}

const LIMIT_MESSAGE = 'Too many session refreshes. Try again in 9 minutes.';

test('a rate-limited refresh keeps the session: tokens stay, no sign-out, no retry', async () => {
  const client = clientWith((call) => {
    if (call.url === '/auth/refresh') {
      return reply(429, { detail: LIMIT_MESSAGE }, { 'Retry-After': '540' });
    }
    return reply(401, { detail: 'Invalid or expired access token' });
  });

  await assert.rejects(client.apiRequest('/users/me'), (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.message, LIMIT_MESSAGE); // actionable wording reaches the screen
    return true;
  });

  assert.deepEqual({ ...client.store }, { access: 'access-1', refresh: 'refresh-1' });
  assert.equal(client.expired(), 0);
  assert.equal(client.refreshCalls(), 1);
  assert.equal(client.calls.length, 2); // the request, the refresh; nothing re-sent
});

test('an unavailable limiter (503) during refresh also keeps the session', async () => {
  const client = clientWith((call) => (call.url === '/auth/refresh'
    ? reply(503, { detail: 'The service is temporarily unavailable. Try again in a moment.' })
    : reply(401, { detail: 'expired' })));

  await assert.rejects(client.apiRequest('/users/me'), (error) => error.status === 503);

  assert.equal(client.store.refresh, 'refresh-1');
  assert.equal(client.expired(), 0);
  assert.equal(client.refreshCalls(), 1);
});

test('only a 401 from refresh ends the session (control)', async () => {
  const client = clientWith((call) => (call.url === '/auth/refresh'
    ? reply(401, { detail: 'Invalid or expired refresh token' })
    : reply(401, { detail: 'expired' })));

  await assert.rejects(client.apiRequest('/users/me'), (error) => error.status === 401);

  assert.equal(client.store.refresh, null);
  assert.equal(client.expired(), 1);
});

test('concurrent 401s share one refresh even when that refresh is rate limited', async () => {
  const client = clientWith((call) => (call.url === '/auth/refresh'
    ? reply(429, { detail: LIMIT_MESSAGE })
    : reply(401, { detail: 'expired' })));

  const results = await Promise.allSettled([
    client.apiRequest('/users/me'),
    client.apiRequest('/workouts'),
    client.apiRequest('/programs'),
  ]);

  assert.deepEqual(results.map((r) => r.reason.status), [429, 429, 429]);
  assert.equal(client.refreshCalls(), 1);
  assert.equal(client.expired(), 0);
});

test('after the limit passes, the next user action refreshes and carries on', async () => {
  const refreshAnswers = [reply(429, { detail: LIMIT_MESSAGE }), reply(200, {
    access_token: 'access-2', refresh_token: 'refresh-2',
  })];
  const client = clientWith((call) => {
    if (call.url === '/auth/refresh') return refreshAnswers.shift();
    return reply(client.store.access === 'access-2' ? 200 : 401, { ok: true });
  });

  await assert.rejects(client.apiRequest('/users/me'), (error) => error.status === 429);
  assert.equal(client.refreshCalls(), 1); // nothing retried on its own

  assert.deepEqual({ ...(await client.apiRequest('/users/me')) }, { ok: true });
  assert.equal(client.refreshCalls(), 2);
  assert.equal(client.store.refresh, 'refresh-2');
});

test('a rate-limited sign-in surfaces the retry wording and sends no refresh', async () => {
  const client = clientWith(() => reply(
    429, { detail: 'Too many sign-in attempts. Try again in 12 minutes.' }, { 'Retry-After': '700' },
  ));

  await assert.rejects(
    client.apiRequest('/auth/login', { method: 'POST', body: { email: 'a@b.co', password: 'pw' }, anonymous: true }),
    (error) => error.status === 429 && /Try again in 12 minutes/.test(error.message),
  );

  assert.equal(client.refreshCalls(), 0);
  assert.equal(client.calls.length, 1);
  assert.deepEqual({ ...client.store }, { access: 'access-1', refresh: 'refresh-1' });
});

test('the login form releases its guard after a rate limit and lets the user try again', async () => {
  const { createLoginSubmitter } = load('src/auth/loginSubmit.ts', {});
  const answers = [
    Object.assign(new Error('Too many sign-in attempts. Try again in 12 minutes.'), { status: 429 }),
    null,
  ];
  let calls = 0;
  const submit = createLoginSubmitter(async () => {
    calls += 1;
    const failure = answers.shift();
    if (failure) throw failure;
  });

  const limited = await submit('a@b.co', 'secret');
  assert.deepEqual({ ...limited }, { kind: 'failed', message: 'Too many sign-in attempts. Try again in 12 minutes.' });

  assert.equal((await submit('a@b.co', 'secret')).kind, 'success'); // guard released, same values accepted
  assert.equal(calls, 2);
});

test('the register form shows the retry wording and stays usable', async () => {
  const { createRegisterSubmitter } = load('src/auth/registerSubmit.ts', {});
  let calls = 0;
  const submit = createRegisterSubmitter(async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('Too many sign-up attempts. Try again in 40 minutes.'), { status: 429 });
  });
  const fields = { email: 'a@b.co', username: 'abc', password: 'longenough', firstName: '' };

  assert.deepEqual({ ...(await submit(fields)) }, {
    kind: 'failed', message: 'Too many sign-up attempts. Try again in 40 minutes.',
  });
  assert.equal((await submit(fields)).kind, 'success');
});

test('startup treats a limit or an outage as "unavailable", never as signed out', async () => {
  class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }
  const restoreWith = async (failure) => {
    const { restoreSession } = load('src/auth/restoreSession.ts', {
      '../api/auth': { fetchMe: async () => { throw failure; } },
      '../api/client': { ApiError },
      '../api/tokens': { getAccessToken: async () => 'a', getRefreshToken: async () => 'r' },
    });
    return (await restoreSession()).status;
  };

  assert.equal(await restoreWith(new ApiError(429, 'Too many session refreshes.')), 'unavailable');
  assert.equal(await restoreWith(new ApiError(503, 'The service is temporarily unavailable.')), 'unavailable');
  assert.equal(await restoreWith(new ApiError(0, 'Cannot connect right now.')), 'unavailable');
  assert.equal(await restoreWith(new ApiError(401, 'Your session has expired.')), 'signedOut');
});
