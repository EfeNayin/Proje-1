// Run with node --test tests/coaching-store.test.cjs. Pure logic, no I/O.
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

const code = ts.transpileModule(readFileSync(path.join(mobileRoot, 'src/coaching/coachingStore.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module_ = { exports: {} };
// Share this realm's Error so `instanceof Error` in the module matches errors thrown by the test.
vm.runInNewContext(code, { module: module_, exports: module_.exports, Error, Set });
const { createCoachingStore } = module_.exports;

// Values built inside the vm context are not reference-equal to this realm's, so compare as JSON.
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const apiError = (status, message) => Object.assign(new Error(message), { status });
const networkError = () => apiError(0, 'Cannot connect right now. Check your connection and try again.');
const connection = (id, username) => ({
  id, person: { username, first_name: null, last_name: null }, connected_at: '2026-10-24T10:00:00Z',
});

function fakeApi(overrides = {}) {
  const calls = [];
  const record = (name, impl) => (...args) => { calls.push([name, ...args]); return impl(...args); };
  const api = {
    enableCoach: record('enableCoach', async () => ({})),
    createInvite: record('createInvite', async () => ({ id: 'i1', code: 'AAAA-BBBB-CCCC', expires_at: 'x' })),
    previewInvite: record('previewInvite', async () => ({ coach: { username: 'efe' }, expires_at: 'x' })),
    acceptInvite: record('acceptInvite', async () => connection('l1', 'efe')),
    listAthletes: record('listAthletes', async () => []),
    listCoaches: record('listCoaches', async () => []),
    endConnection: record('endConnection', async () => undefined),
  };
  for (const [name, impl] of Object.entries(overrides)) api[name] = record(name, impl);
  return { api, calls, count: name => calls.filter(call => call[0] === name).length };
}

test('accepting twice at once sends one request and the second tap is ignored', async () => {
  const gate = deferred();
  const { api, count } = fakeApi({ acceptInvite: () => gate.promise });
  const store = createCoachingStore(api);
  store.bind('u1');

  const first = store.acceptCode('CODE', 'efe');
  const second = await store.acceptCode('CODE', 'efe'); // e.g. a double tap
  assert.equal(second.kind, 'ignored');
  assert.equal(store.getSnapshot().accepting, true);

  gate.resolve(connection('l1', 'efe'));
  const outcome = await first;
  assert.equal(outcome.kind, 'done');
  assert.equal(count('acceptInvite'), 1);
  assert.equal(store.getSnapshot().accepting, false);
  same(store.getSnapshot().coaches.items.map(item => item.id), ['l1']);
});

test('a server refusal is shown as is, no re-read happens, and a retry is possible', async () => {
  let attempt = 0;
  const { api, count } = fakeApi({
    acceptInvite: async () => {
      attempt += 1;
      if (attempt === 1) throw apiError(410, 'This invite code has expired.');
      return connection('l1', 'efe');
    },
  });
  const store = createCoachingStore(api);
  store.bind('u1');

  assert.deepEqual({ ...(await store.acceptCode('CODE', 'efe')) },
    { kind: 'failed', message: 'This invite code has expired.', ambiguous: false });
  assert.equal(count('listCoaches'), 0);
  assert.equal(store.getSnapshot().accepting, false);
  assert.equal((await store.acceptCode('CODE', 'efe')).kind, 'done');
});

test('a lost accept response is checked by re-reading: connected means success', async () => {
  const { api, count } = fakeApi({
    acceptInvite: async () => { throw networkError(); },
    listCoaches: async () => [connection('l9', 'Efe')], // the write did happen
  });
  const store = createCoachingStore(api);
  store.bind('u1');

  const outcome = await store.acceptCode('CODE', 'efe');

  assert.equal(outcome.kind, 'done');
  assert.equal(outcome.connection.id, 'l9');
  assert.equal(count('acceptInvite'), 1); // not repeated behind the user's back
  same(store.getSnapshot().coaches.items.map(item => item.id), ['l9']);
});

test('a lost accept that did not happen is reported as not connected', async () => {
  const { api } = fakeApi({
    acceptInvite: async () => { throw apiError(503, 'Service unavailable'); },
    listCoaches: async () => [],
  });
  const store = createCoachingStore(api);
  store.bind('u1');

  const outcome = await store.acceptCode('CODE', 'efe');

  assert.equal(outcome.kind, 'failed');
  assert.match(outcome.message, /was not created/);
  assert.equal(store.getSnapshot().accepting, false);
});

test('when the result cannot be re-read either, it is "unknown", not a failure', async () => {
  const { api } = fakeApi({
    acceptInvite: async () => { throw networkError(); },
    listCoaches: async () => { throw networkError(); },
  });
  const store = createCoachingStore(api);
  store.bind('u1');

  const outcome = await store.acceptCode('CODE', 'efe');

  assert.equal(outcome.kind, 'unknown');
  assert.equal(store.getSnapshot().accepting, false); // the lock does not stay closed
});

test('ending a connection: a double tap sends one request and removes it from the list', async () => {
  const gate = deferred();
  const { api, count } = fakeApi({
    listAthletes: async () => [connection('l1', 'a'), connection('l2', 'b')],
    endConnection: () => gate.promise,
  });
  const store = createCoachingStore(api);
  store.bind('u1');
  await store.load('coach');

  const first = store.endConnection('coach', 'l1');
  assert.equal((await store.endConnection('coach', 'l1')).kind, 'ignored');
  same(store.getSnapshot().ending, ['l1']);
  gate.resolve();

  assert.equal((await first).kind, 'done');
  assert.equal(count('endConnection'), 1);
  same(store.getSnapshot().athletes.items.map(item => item.id), ['l2']);
  same(store.getSnapshot().ending, []);
});

test('a lost end response is checked by re-reading the list', async () => {
  let gone = true;
  const { api } = fakeApi({
    listCoaches: async () => (gone ? [] : [connection('l1', 'efe')]),
    endConnection: async () => { throw networkError(); },
  });
  const store = createCoachingStore(api);
  store.bind('u1');

  assert.equal((await store.endConnection('athlete', 'l1')).kind, 'done'); // it did end

  gone = false;
  const still = await store.endConnection('athlete', 'l1');
  assert.equal(still.kind, 'failed'); // still connected: say so, allow a retry
  same(store.getSnapshot().ending, []);
});

test('ending a connection that is already gone (404) counts as done', async () => {
  const { api } = fakeApi({
    listCoaches: async () => [connection('l1', 'efe')],
    endConnection: async () => { throw apiError(404, 'Connection not found.'); },
  });
  const store = createCoachingStore(api);
  store.bind('u1');
  await store.load('athlete');

  assert.equal((await store.endConnection('athlete', 'l1')).kind, 'done');
  same(store.getSnapshot().coaches.items, []);
});

test('sign-out while a request is in flight: its late answer changes nothing', async () => {
  const gate = deferred();
  const { api } = fakeApi({ acceptInvite: () => gate.promise });
  const store = createCoachingStore(api);
  store.bind('u1');

  const pending = store.acceptCode('CODE', 'efe');
  store.reset(); // sign-out
  gate.resolve(connection('l1', 'efe'));

  assert.equal((await pending).kind, 'stale');
  const state = store.getSnapshot();
  assert.equal(state.userId, null);
  same(state.coaches.items, []);
  assert.equal(state.accepting, false);
});

test('a second user never sees the first one\'s lists or invite code, and is not locked out by their request', async () => {
  const gate = deferred();
  let accepts = 0;
  const { api } = fakeApi({
    listAthletes: async () => [connection('l1', 'secret')],
    acceptInvite: () => { accepts += 1; return accepts === 1 ? gate.promise : Promise.resolve(connection('n1', 'new')); },
  });
  const store = createCoachingStore(api);
  store.bind('u1');
  await store.load('coach');
  await store.createInvite();
  const oldRequest = store.acceptCode('OLD', 'x');
  assert.equal(store.getSnapshot().invite.created.code, 'AAAA-BBBB-CCCC');

  store.bind('u2'); // account switch
  const state = store.getSnapshot();
  assert.equal(state.userId, 'u2');
  same(state.athletes.items, []);
  assert.equal(state.athletes.loaded, false);
  assert.equal(state.invite.created, null);

  const mine = await store.acceptCode('NEW', 'new'); // the old lock does not carry over
  assert.equal(mine.kind, 'done');
  gate.resolve(connection('l7', 'x'));
  assert.equal((await oldRequest).kind, 'stale');
  same(store.getSnapshot().coaches.items.map(item => item.id), ['n1']);
});

test('binding the same user again keeps what is loaded', async () => {
  const { api } = fakeApi({ listAthletes: async () => [connection('l1', 'a')] });
  const store = createCoachingStore(api);
  store.bind('u1');
  await store.load('coach');
  store.bind('u1');
  assert.equal(store.getSnapshot().athletes.items.length, 1);
});

test('a failed reload keeps the list; concurrent loads share one request', async () => {
  let mode = 'ok';
  const gate = deferred();
  const { api, count } = fakeApi({
    listAthletes: () => (mode === 'ok' ? Promise.resolve([connection('l1', 'a')])
      : mode === 'slow' ? gate.promise : Promise.reject(networkError())),
  });
  const store = createCoachingStore(api);
  store.bind('u1');
  await store.load('coach');

  mode = 'fail';
  await store.load('coach');
  let list = store.getSnapshot().athletes;
  assert.equal(list.items.length, 1);
  assert.match(list.error, /Cannot connect/);
  assert.equal(list.loading, false);

  mode = 'slow';
  const a = store.load('coach');
  const b = store.load('coach');
  assert.equal(count('listAthletes'), 3); // initial + failed + ONE shared
  gate.resolve([connection('l1', 'a'), connection('l2', 'b')]);
  await Promise.all([a, b]);
  list = store.getSnapshot().athletes;
  assert.equal(list.items.length, 2);
  assert.equal(list.error, null);
});

test('a list answer that arrives after sign-out is dropped', async () => {
  const gate = deferred();
  const { api } = fakeApi({ listCoaches: () => gate.promise });
  const store = createCoachingStore(api);
  store.bind('u1');

  const loading = store.load('athlete');
  store.reset();
  gate.resolve([connection('l1', 'efe')]);
  await loading;

  same(store.getSnapshot().coaches.items, []);
  assert.equal(store.getSnapshot().coaches.loaded, false);
});

test('invite creation: one request for a double tap, code kept until cleared or signed out', async () => {
  const gate = deferred();
  const { api, count } = fakeApi({ createInvite: () => gate.promise });
  const store = createCoachingStore(api);
  store.bind('u1');

  const first = store.createInvite();
  assert.equal((await store.createInvite()).kind, 'ignored');
  assert.equal(store.getSnapshot().invite.creating, true);
  gate.resolve({ id: 'i1', code: 'WXYZ-2345-6789', expires_at: 'x' });
  assert.equal((await first).kind, 'done');
  assert.equal(count('createInvite'), 1);
  assert.equal(store.getSnapshot().invite.created.code, 'WXYZ-2345-6789');

  store.clearInvite();
  assert.equal(store.getSnapshot().invite.created, null);
});

test('a lost invite response is not reported as a plain failure and can be retried', async () => {
  let attempt = 0;
  const { api } = fakeApi({
    createInvite: async () => {
      attempt += 1;
      if (attempt === 1) throw networkError();
      if (attempt === 2) throw apiError(403, 'Turn on coach tools first.');
      return { id: 'i', code: 'CODE', expires_at: 'x' };
    },
  });
  const store = createCoachingStore(api);
  store.bind('u1');

  const lost = await store.createInvite();
  assert.equal(lost.kind, 'failed');
  assert.equal(lost.ambiguous, true);
  assert.match(lost.message, /Could not confirm/);

  const refused = await store.createInvite();
  assert.equal(refused.ambiguous, false);
  assert.equal(refused.message, 'Turn on coach tools first.');

  assert.equal((await store.createInvite()).kind, 'done');
});

test('turning on coach tools: one request for a double tap; a lost response is flagged as unconfirmed', async () => {
  const gate = deferred();
  let attempt = 0;
  const { api, count } = fakeApi({
    enableCoach: () => { attempt += 1; return attempt === 1 ? gate.promise : Promise.reject(networkError()); },
  });
  const store = createCoachingStore(api);
  store.bind('u1');

  const first = store.enableCoach();
  assert.equal((await store.enableCoach()).kind, 'ignored');
  gate.resolve({});
  assert.equal((await first).kind, 'done');
  assert.equal(count('enableCoach'), 1);

  const lost = await store.enableCoach();
  assert.equal(lost.kind, 'failed');
  assert.equal(lost.ambiguous, true); // the screen re-reads the profile
  assert.equal(store.getSnapshot().enabling, false);
});

test('previewing a code: a refusal carries the server message; a late answer after sign-out is stale', async () => {
  const gate = deferred();
  let attempt = 0;
  const { api } = fakeApi({
    previewInvite: () => {
      attempt += 1;
      if (attempt === 1) return Promise.reject(apiError(404, 'This invite code is not valid.'));
      return gate.promise;
    },
  });
  const store = createCoachingStore(api);
  store.bind('u1');

  assert.deepEqual({ ...(await store.previewCode('BAD')) }, { kind: 'failed', message: 'This invite code is not valid.' });

  const pending = store.previewCode('GOOD');
  assert.equal((await store.previewCode('GOOD')).kind, 'ignored');
  store.reset();
  gate.resolve({ coach: { username: 'efe' }, expires_at: 'x' });
  assert.equal((await pending).kind, 'stale');
});
