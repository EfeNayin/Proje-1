// Test support, not a test (node --test tests/*.test.cjs skips it).
//
// A small world for the session-concurrency tests: the app's real token storage,
// API client and auth API, transpiled from source, with only the two I/O edges
// replaced by doubles whose timing the test controls:
//
//  * expo-secure-store: an in-memory Keychain. `store.hold(match)` makes the
//    first matching operation wait, *before it changes anything*, until the test
//    releases it. That models a native write that completes late, which is the
//    ordering a "check, then await the write" guard cannot see.
//  * fetch: scripted routes. `net.hold(match)` parks a matching request and lets
//    the test choose when, and with what, it is answered.
//
// Nothing here knows how the app avoids races; it only makes them reproducible.
/* global __dirname */
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const mobileRoot = path.resolve(__dirname, '..', '..');
const ts = require(require.resolve('typescript', {
  paths: [process.env.BODYTRACK_DEPENDENCIES || mobileRoot],
}));

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function reply(status, body = {}) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

function createSecureStore() {
  const data = new Map();
  const log = [];
  const holds = [];
  const failures = [];
  async function run(op, key, value) {
    const failure = failures.find((f) => !f.used && f.match({ op, key, value }));
    if (failure) {
      failure.used = true;
      throw new Error('Keychain unavailable');
    }
    const hold = holds.find((h) => !h.used && h.match({ op, key, value }));
    // A read takes its value when it starts and delivers it late; a write or a
    // delete takes effect late.
    const read = op === 'get' ? (data.get(key) ?? null) : undefined;
    if (hold) {
      hold.used = true;
      hold.reached.resolve();
      await hold.gate.promise;
    }
    if (op === 'set') data.set(key, value);
    if (op === 'delete') data.delete(key);
    log.push(`${op}:${key}`);
    return read;
  }
  return {
    data,
    log,
    setItemAsync: (key, value) => run('set', key, value),
    getItemAsync: (key) => run('get', key),
    deleteItemAsync: (key) => run('delete', key),
    /** The first operation matching `match({op, key, value})` waits for release() before it takes effect (a read has its value already, and delivers it late). */
    hold(match) {
      const entry = { match, used: false, gate: deferred(), reached: deferred() };
      holds.push(entry);
      return { reached: entry.reached.promise, release: () => entry.gate.resolve() };
    },
    /** The first operation matching `match({op, key, value})` fails once, changing nothing. */
    failOnce(match) { failures.push({ match, used: false }); },
    get(key) { return data.get(key) ?? null; },
  };
}

function createNetwork() {
  const calls = [];
  const routes = [];
  const holds = [];
  const delays = [];
  async function fetch(url, options = {}) {
    const entry = {
      path: url.replace('https://bodytrack.test/api/v1', ''),
      method: options.method ?? 'GET',
      auth: options.headers?.Authorization ?? null,
      body: options.body ? JSON.parse(options.body) : undefined,
    };
    calls.push(entry);
    const hold = holds.find((h) => !h.used && h.match(entry));
    if (hold) {
      hold.used = true;
      hold.reached.resolve(entry);
      return hold.answer.promise;
    }
    const slow = delays.find((d) => !d.used && d.match(entry));
    if (slow) slow.used = true;
    let answer = reply(404, { detail: `unscripted ${entry.method} ${entry.path}` });
    for (const route of routes) {
      if (route.match(entry)) {
        answer = await route.answer(entry);
        break;
      }
    }
    if (slow) {
      // The server has acted by now; only the answer is late.
      slow.reached.resolve(entry);
      await slow.gate.promise;
    }
    if (answer instanceof Error) throw answer;
    return answer;
  }
  return {
    calls,
    fetch,
    /** Answer every request matching `match(entry)` with `answer(entry)`. First route wins. */
    route(match, answer) { routes.push({ match, answer }); },
    /** Like route(), but checked before the routes added so far. */
    override(match, answer) { routes.unshift({ match, answer }); },
    /** Park the first request matching `match`; answer it later with respond()/fail(). */
    hold(match) {
      const entry = { match, used: false, answer: deferred(), reached: deferred() };
      holds.push(entry);
      return {
        reached: entry.reached.promise,
        respond: (response) => entry.answer.resolve(response),
        fail: () => entry.answer.resolve(Promise.reject(new TypeError('offline'))),
      };
    },
    /**
     * The first matching request is processed by the routes at once (the server
     * acts), but its answer is held back until release().
     */
    delay(match) {
      const entry = { match, used: false, gate: deferred(), reached: deferred() };
      delays.push(entry);
      return { reached: entry.reached.promise, release: () => entry.gate.resolve() };
    },
    count(pathName) { return calls.filter((c) => c.path === pathName).length; },
  };
}

function createWorld(extraFiles = {}) {
  const store = createSecureStore();
  const net = createNetwork();
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module_ = { exports: {} };
    cache.set(file, module_);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, {
      module: module_, exports: module_.exports, fetch: net.fetch, Error, Promise,
      JSON, console, setTimeout, clearTimeout,
      require: (id) => {
        if (id === 'expo-secure-store') return store;
        if (id in extraFiles) return extraFiles[id];
        const resolved = path.resolve(path.dirname(file), id);
        if (resolved === path.join(mobileRoot, 'src/config')) {
          return { API_URL: 'https://bodytrack.test', API_PREFIX: '/api/v1' };
        }
        if (!existsSync(`${resolved}.ts`)) throw new Error(`Unexpected import: ${id} from ${file}`);
        return load(`${resolved}.ts`);
      },
    }, { filename: file });
    return module_.exports;
  }
  const src = (name) => load(path.join(mobileRoot, 'src', `${name}.ts`));
  return { store, net, load: src, reply, deferred };
}

// A stand-in for the backend's token rules, nothing more: refresh rotates and a
// second use of a rotated token revokes every session of that user (reuse
// detection); logout ends the whole family of tokens the presented one belongs
// to; access tokens are valid until `expireAccess()`. It models the contract the
// real backend tests establish; it proves nothing about the database.
function createServer(net) {
  let counter = 0;
  const refresh = new Map(); // token -> { user, family, live }
  const access = new Map(); // token -> { user, valid }
  const emails = { A: 'a@example.com', B: 'b@example.com' };
  function issue(user, family = `fam-${user}-${++counter}`) {
    const pair = { access_token: `${user}-access-${++counter}`, refresh_token: `${user}-refresh-${++counter}` };
    access.set(pair.access_token, { user, valid: true });
    refresh.set(pair.refresh_token, { user, family, live: true });
    return pair;
  }
  const userFor = (entry) => access.get(entry.auth?.replace('Bearer ', ''));
  net.route(() => true, (entry) => {
    const body = entry.body ?? {};
    switch (entry.path) {
      case '/auth/login':
      case '/auth/register': {
        const user = Object.keys(emails).find((u) => emails[u] === body.email);
        if (!user || body.password === 'wrong') return reply(401, { detail: 'Invalid email or password' });
        return reply(200, { user: { id: user, email: body.email }, tokens: issue(user) });
      }
      case '/auth/refresh': {
        const row = refresh.get(body.refresh_token);
        if (!row) return reply(401, { detail: 'Invalid or expired refresh token' });
        if (!row.live) {
          for (const r of refresh.values()) if (r.user === row.user) r.live = false;
          return reply(401, { detail: 'Refresh token was already used. Please sign in again.' });
        }
        row.live = false;
        return reply(200, issue(row.user, row.family));
      }
      case '/auth/logout': {
        const row = refresh.get(body.refresh_token);
        if (row) {
          for (const [token, r] of refresh) {
            if (r.family === row.family && (r.live || token === body.refresh_token)) refresh.delete(token);
          }
        }
        return reply(204);
      }
      default: {
        const row = userFor(entry);
        return row && row.valid
          ? reply(200, { owner: row.user, email: emails[row.user], path: entry.path })
          : reply(401, { detail: 'Invalid or expired access token' });
      }
    }
  });
  return {
    emails,
    /** A signed-in session for `user`, as a pair (the caller stores it where the app would). */
    seed: (user) => issue(user),
    expireAccess() { for (const row of access.values()) row.valid = false; },
    liveRefreshTokens(user) {
      return [...refresh.entries()].filter(([, r]) => r.live && r.user === user).map(([t]) => t);
    },
  };
}

const ACCESS_KEY = 'bodytrack.access_token';
const REFRESH_KEY = 'bodytrack.refresh_token';

module.exports = { createServer, createWorld, reply, deferred, ACCESS_KEY, REFRESH_KEY, mobileRoot };
