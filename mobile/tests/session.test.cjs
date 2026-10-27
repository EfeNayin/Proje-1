// Run with npm run test:session. Uses the project's TypeScript compiler and
// Node's test runner; native token storage and HTTP are the only I/O doubles.
/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const mobileRoot = path.resolve(__dirname, '..');
const ts = require(require.resolve('typescript', {
  paths: [process.env.BODYTRACK_DEPENDENCIES || mobileRoot],
}));

function fixture(handler, initial = { access_token: 'old-access', refresh_token: 'old-refresh' }) {
  let tokens = initial && { ...initial };
  let clears = 0;
  let expired = 0;
  const cache = new Map();
  const storage = {
    getAccessToken: async () => tokens?.access_token ?? null,
    getRefreshToken: async () => tokens?.refresh_token ?? null,
    saveTokensIf: async (value, _owner, isCurrent) => {
      if (!isCurrent()) return false;
      tokens = value;
      return true;
    },
    clearTokensIfOwner: async () => undefined,
    clearTokens: async () => { clears += 1; tokens = null; },
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, {
      module, exports: module.exports,
      fetch: handler,
      require: (id) => {
        const resolved = path.resolve(path.dirname(file), id);
        if (resolved === path.join(mobileRoot, 'src/api/tokens')) return storage;
        if (resolved === path.join(mobileRoot, 'src/config')) {
          return { API_URL: 'https://bodytrack.test', API_PREFIX: '/api/v1' };
        }
        if (!existsSync(`${resolved}.ts`)) throw new Error(`Unexpected import: ${id}`);
        return load(`${resolved}.ts`);
      },
    }, { filename: file });
    return module.exports;
  }
  const client = load(path.join(mobileRoot, 'src/api/client.ts'));
  client.setOnSessionExpired(() => { expired += 1; });
  const { restoreSession } = load(path.join(mobileRoot, 'src/auth/restoreSession.ts'));
  const authApi = load(path.join(mobileRoot, 'src/api/auth.ts'));
  return { client, authApi, restoreSession, tokens: () => tokens, clears: () => clears, expired: () => expired };
}

const response = (status, body = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
const newTokens = { access_token: 'new-access', refresh_token: 'new-refresh' };
const isStatus = (status) => (error) => error.status === status;

test('a normal connection failure preserves the session', async () => {
  const f = fixture(async () => { throw new TypeError('offline'); });
  await assert.rejects(f.client.apiRequest('/users/me'), isStatus(0));
  assert.equal(f.clears(), 0);
  assert.equal(f.expired(), 0);
});

test('offline refresh preserves tokens and reconnecting can recover', async () => {
  let online = false;
  const f = fixture(async (url, options) => {
    if (url.endsWith('/auth/refresh')) {
      if (!online) throw new TypeError('offline');
      return response(200, newTokens);
    }
    return options.headers.Authorization === 'Bearer new-access'
      ? response(200, { id: 'user' }) : response(401);
  });
  await assert.rejects(f.client.apiRequest('/users/me'), isStatus(0));
  assert.equal(f.tokens().refresh_token, 'old-refresh');
  assert.equal(f.expired(), 0);
  online = true;
  assert.equal((await f.client.apiRequest('/users/me')).id, 'user');
  assert.equal(f.clears(), 0);
});

for (const status of [429, 500, 503]) {
  test(`refresh HTTP ${status} preserves the session`, async () => {
    const f = fixture(async (url) => response(url.endsWith('/auth/refresh') ? status : 401));
    await assert.rejects(f.client.apiRequest('/users/me'), isStatus(status));
    assert.equal(f.clears(), 0);
    assert.equal(f.expired(), 0);
  });
}

test('an explicitly rejected refresh clears tokens and reports expiry', async () => {
  const f = fixture(async () => response(401));
  await assert.rejects(f.client.apiRequest('/users/me'), isStatus(401));
  assert.equal(f.clears(), 1);
  assert.equal(f.expired(), 1);
});

test('a missing refresh token expires an already rejected access token', async () => {
  const f = fixture(async () => response(401), { access_token: 'old-access' });
  await assert.rejects(f.client.apiRequest('/users/me'), isStatus(401));
  assert.equal(f.clears(), 1);
});

test('concurrent 401 responses share one refresh and retry with new access', async () => {
  let refreshes = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const f = fixture(async (url, options) => {
    if (url.endsWith('/auth/refresh')) {
      refreshes += 1;
      await gate;
      return response(200, newTokens);
    }
    return options.headers.Authorization === 'Bearer new-access'
      ? response(200, { ok: true }) : response(401);
  });
  const pending = Promise.all([f.client.apiRequest('/users/me'), f.client.apiRequest('/workouts')]);
  await new Promise(setImmediate);
  assert.equal(refreshes, 1);
  release();
  const result = await pending;
  assert.equal(result.every((item) => item.ok), true);
  assert.equal(refreshes, 1);
});

test('network failure after successful rotation keeps the new tokens', async () => {
  const f = fixture(async (url, options) => {
    if (url.endsWith('/auth/refresh')) return response(200, newTokens);
    if (options.headers.Authorization === 'Bearer new-access') throw new TypeError('offline');
    return response(401);
  });
  await assert.rejects(f.client.apiRequest('/users/me'), isStatus(0));
  assert.equal(f.tokens().refresh_token, 'new-refresh');
  assert.equal(f.clears(), 0);
});

test('a second 401 after refresh expires the session without an infinite retry', async () => {
  let calls = 0;
  const f = fixture(async (url) => {
    calls += 1;
    return url.endsWith('/auth/refresh') ? response(200, newTokens) : response(401);
  });
  await assert.rejects(f.client.apiRequest('/users/me'), isStatus(401));
  assert.equal(calls, 3);
  assert.equal(f.clears(), 1);
});

test('anonymous login rejection does not clear an existing session', async () => {
  const f = fixture(async () => response(401));
  await assert.rejects(f.client.apiRequest('/auth/login', { anonymous: true }), isStatus(401));
  assert.equal(f.clears(), 0);
});

test('startup without stored tokens goes to login without making a request', async () => {
  const f = fixture(async () => { throw new Error('Must not fetch'); }, null);
  assert.equal((await f.restoreSession()).status, 'signedOut');
  assert.equal(f.clears(), 0);
});

test('offline startup can be retried successfully with the same saved session', async () => {
  let online = false;
  const f = fixture(async () => {
    if (!online) throw new TypeError('offline');
    return response(200, { id: 'user' });
  });
  assert.equal((await f.restoreSession()).status, 'unavailable');
  assert.equal(f.clears(), 0);
  online = true;
  const restored = await f.restoreSession();
  assert.equal(restored.status, 'signedIn');
  assert.equal(restored.user.id, 'user');
});

test('startup server failure offers retry and keeps tokens', async () => {
  const f = fixture(async () => response(503));
  assert.equal((await f.restoreSession()).status, 'unavailable');
  assert.equal(f.clears(), 0);
});

test('startup with rejected credentials goes to login', async () => {
  const f = fixture(async () => response(401));
  assert.equal((await f.restoreSession()).status, 'signedOut');
  assert.equal(f.clears(), 1);
});

test('startup recovers when only the refresh token is available', async () => {
  const f = fixture(async (url, options) => {
    if (url.endsWith('/auth/refresh')) return response(200, newTokens);
    return options.headers.Authorization === 'Bearer new-access'
      ? response(200, { id: 'user' }) : response(401);
  }, { refresh_token: 'old-refresh' });
  assert.equal((await f.restoreSession()).status, 'signedIn');
  assert.equal(f.clears(), 0);
});

test('logout posts the refresh token anonymously and leaves local state alone', async () => {
  const seen = [];
  const f = fixture(async (url, options) => {
    seen.push({ url, method: options.method, headers: options.headers, body: options.body });
    return new Response(null, { status: 204 });
  });
  await f.authApi.logout('old-refresh');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://bodytrack.test/api/v1/auth/logout');
  assert.equal(seen[0].method, 'POST');
  assert.deepEqual(JSON.parse(seen[0].body), { refresh_token: 'old-refresh' });
  // No access token goes with it, so an expired one cannot divert a sign-out into a refresh.
  assert.equal(seen[0].headers.Authorization, undefined);
  assert.equal(f.clears(), 0);
  assert.equal(f.expired(), 0);
});

test('a rejected or failed logout never refreshes, clears tokens or expires the session', async () => {
  const urls = [];
  const rejected = fixture(async (url) => { urls.push(url); return response(401); });
  await assert.rejects(rejected.authApi.logout('old-refresh'), isStatus(401));
  assert.deepEqual(urls, ['https://bodytrack.test/api/v1/auth/logout']);
  assert.equal(rejected.tokens().refresh_token, 'old-refresh');
  assert.equal(rejected.expired(), 0);

  const offline = fixture(async () => { throw new TypeError('offline'); });
  await assert.rejects(offline.authApi.logout('old-refresh'), isStatus(0));
  assert.equal(offline.clears(), 0);
});

test('signing out takes the refresh token and ends the server session without waiting for it', () => {
  const source = readFileSync(path.join(mobileRoot, 'src/auth/sessionController.ts'), 'utf8')
    .replace(/\r\n/g, '\n');
  const signOut = source.slice(source.indexOf('async function signOut'), source.indexOf('/** The API client gave up'));
  const left = signOut.indexOf('leaveAccount()');
  const take = signOut.indexOf('await takeRefreshToken()');
  const call = signOut.indexOf('authApi.logout(refreshToken)');
  assert.ok(left > -1 && left < take, 'the account is left before any storage work');
  assert.ok(take > -1 && take < call, 'the token is taken (read and cleared in one step) before the request is built');
  assert.doesNotMatch(signOut, /await authApi\.logout/, 'signing out must not wait for the network');
  assert.match(signOut, /authApi\.logout\(refreshToken\)\.then\(/, 'failure is reported as unconfirmed, never thrown');
});
