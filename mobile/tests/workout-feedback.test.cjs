// Run with node --test tests/workout-feedback.test.cjs. Pure logic, no I/O.
//
// Store tests drive the real stores with fake APIs. Component tests call the
// real (hook-free) components and walk the element trees they return. The
// source scans at the end prove the wiring is present, not how it behaves on a
// device: no screen of this feature has been driven on a phone or simulator.
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

const read = (file) => readFileSync(path.join(mobileRoot, file), 'utf8');
function load(file, modules = {}, globals = {}) {
  const code = ts.transpileModule(read(file), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
    },
  }).outputText;
  const module_ = { exports: {} };
  vm.runInNewContext(code, {
    module: module_, exports: module_.exports, Error, Set, Math, Number, Date, Promise, ...globals,
    require: (name) => {
      if (!(name in modules)) throw new Error(`unexpected import ${name}`);
      return modules[name];
    },
  });
  return module_.exports;
}

const feedback = load('src/coaching/workoutFeedback.ts');
const { createWorkoutFeedbackStore, draftProblem, FEEDBACK_MAX_LENGTH } = feedback;
const { createReceivedFeedbackStore } = load('src/coaching/receivedFeedback.ts');
const display = load('src/coaching/feedbackDisplay.ts');
const presentation = load('src/coaching/presentation.ts');

// Values built inside the vm context are not reference-equal to this realm's, so compare as JSON.
const json = (value) => JSON.parse(JSON.stringify(value));
const same = (actual, expected) => assert.deepEqual(json(actual), expected);
const settle = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const apiError = (status, message = 'error') => Object.assign(new Error(message), { status });
const networkError = () => apiError(0, 'Cannot connect right now. Check your connection and try again.');

const ctx = (extra = {}) => ({ userId: 'coach1', linkId: 'link1', workoutId: 'w1', ...extra });
const entry = (body, version = 1, extra = {}) => ({
  id: 'fb1', body, version,
  created_at: '2026-10-01T10:00:00Z',
  updated_at: version > 1 ? '2026-10-02T10:00:00Z' : '2026-10-01T10:00:00Z',
  ...extra,
});

/** A fake backend that keeps one entry and records every call. */
function makeStore(overrides = {}) {
  const calls = [];
  const server = { entry: null };
  const api = {
    get: async (...args) => { calls.push(['get', ...args]); return { feedback: server.entry }; },
    create: async (link, workout, requestId, body) => {
      calls.push(['create', link, workout, requestId, body]);
      server.entry = entry(body, 1);
      return server.entry;
    },
    update: async (link, workout, body, version) => {
      calls.push(['update', link, workout, body, version]);
      server.entry = entry(body, version + 1);
      return server.entry;
    },
    remove: async (link, workout, version) => {
      calls.push(['remove', link, workout, version]);
      server.entry = null;
    },
    ...overrides,
  };
  const refusals = { forbidden: [], unavailable: [] };
  let counter = 0;
  const store = createWorkoutFeedbackStore(
    api,
    { onForbidden: (c) => refusals.forbidden.push(c), onUnavailable: (c) => refusals.unavailable.push(c) },
    () => `req-${++counter}`,
  );
  return { store, calls, server, refusals };
}
const kinds = (calls) => calls.map((c) => c[0]);
const snap = (store) => json(store.getSnapshot());

async function writing(store, text) {
  store.startEditing();
  store.setDraft(text);
  await store.save();
}

// ── Coach store ─────────────────────────────────────────────────────────

test('nothing is requested until opened; opening reads the entry once', async () => {
  const { store, calls } = makeStore();
  assert.equal(calls.length, 0);
  const opening = store.open(ctx());
  assert.equal(store.getSnapshot().loading, true);
  await opening;
  same(calls, [['get', 'link1', 'w1']]);
  assert.equal(store.getSnapshot().loaded, true);
  assert.equal(store.getSnapshot().saved, null);
  assert.equal(store.getSnapshot().loading, false);
});

test('a first read that fails offers a retry and never pretends there is no entry', async () => {
  let fail = true;
  const { store } = makeStore({ get: async () => { if (fail) throw networkError(); return { feedback: entry('Hi') }; } });
  await store.open(ctx());
  assert.equal(store.getSnapshot().loadError, true);
  assert.equal(store.getSnapshot().loaded, false);
  store.startEditing();
  assert.equal(store.getSnapshot().editing, false);
  fail = false;
  await store.retryLoad();
  assert.equal(store.getSnapshot().loaded, true);
  assert.equal(store.getSnapshot().saved.body, 'Hi');
});

test('creating sends the trimmed text under a request id and shows the saved entry', async () => {
  const { store, calls } = makeStore();
  await store.open(ctx());
  await writing(store, '  Good depth.  ');
  same(calls.slice(1), [['create', 'link1', 'w1', 'req-1', 'Good depth.']]);
  const state = snap(store);
  assert.equal(state.saved.body, 'Good depth.');
  assert.equal(state.saved.version, 1);
  assert.equal(state.editing, false);
  assert.equal(state.draft, '');
  assert.equal(state.saving, false);
});

test('blank, whitespace-only and overlong drafts send nothing and say why', async () => {
  const { store, calls } = makeStore();
  await store.open(ctx());
  for (const text of ['', '   \n  ', ' ']) {
    await writing(store, text);
    assert.equal(store.getSnapshot().error, 'Write some feedback first.');
  }
  await writing(store, 'a'.repeat(FEEDBACK_MAX_LENGTH + 1));
  assert.match(store.getSnapshot().error, /at most 2000 characters/);
  assert.deepEqual(kinds(calls), ['get']);
  assert.equal(store.getSnapshot().editing, true);
  // The boundary itself is fine.
  await writing(store, 'a'.repeat(FEEDBACK_MAX_LENGTH));
  assert.deepEqual(kinds(calls), ['get', 'create']);
  assert.equal(draftProblem('a'.repeat(2000)), null);
  assert.equal(draftProblem('a'.repeat(2001)), 'too_long');
  assert.equal(draftProblem('x\u0000y'), 'invalid');
});

test('a failed save keeps the draft; the same text repeats under the same request id', async () => {
  let fail = true;
  const seen = [];
  const { store } = makeStore({
    create: async (_l, _w, requestId, body) => {
      seen.push([requestId, body]);
      if (fail) throw networkError();
      return entry(body, 1);
    },
  });
  await store.open(ctx());
  await writing(store, 'Keep the pause.');
  assert.match(store.getSnapshot().error, /Cannot connect/);
  assert.equal(store.getSnapshot().draft, 'Keep the pause.');
  assert.equal(store.getSnapshot().editing, true);
  assert.equal(store.getSnapshot().saving, false);

  await store.save(); // same text again
  assert.deepEqual(json(seen), [['req-1', 'Keep the pause.'], ['req-1', 'Keep the pause.']]);

  // A changed draft never rides on the earlier operation identity.
  store.setDraft('Keep the pause. And brace harder.');
  await store.save();
  assert.equal(seen[2][0], 'req-2');
  fail = false;
  await store.save();
  assert.deepEqual(json(seen[3]), ['req-2', 'Keep the pause. And brace harder.']);
  assert.equal(store.getSnapshot().saved.body, 'Keep the pause. And brace harder.');
});

test('after a successful create, a later entry for the same workout gets a new request id', async () => {
  const { store, calls } = makeStore();
  await store.open(ctx());
  await writing(store, 'One');
  await store.remove();
  await writing(store, 'One');
  const creates = calls.filter((c) => c[0] === 'create');
  assert.equal(creates.length, 2);
  assert.notEqual(creates[0][3], creates[1][3]);
});

test('double taps on save send one request', async () => {
  const gate = deferred();
  const { store, calls } = makeStore({ create: async (...a) => { calls.push(['create', ...a]); await gate.promise; return entry('Once'); } });
  await store.open(ctx());
  store.startEditing();
  store.setDraft('Once');
  const first = store.save();
  const second = store.save();
  const third = store.save();
  assert.equal(store.getSnapshot().saving, true);
  gate.resolve();
  await Promise.all([first, second, third]);
  assert.equal(calls.filter((c) => c[0] === 'create').length, 1);
});

test('typing is ignored while a save is running, so the saved text is what was sent', async () => {
  const gate = deferred();
  const { store } = makeStore({ create: async () => { await gate.promise; return entry('Sent'); } });
  await store.open(ctx());
  store.startEditing();
  store.setDraft('Sent');
  const saving = store.save();
  store.setDraft('Typed while saving');
  assert.equal(store.getSnapshot().draft, 'Sent');
  gate.resolve();
  await saving;
});

test('editing sends the version it saw; unchanged text sends nothing', async () => {
  const { store, calls, server } = makeStore();
  server.entry = entry('First', 3);
  await store.open(ctx());
  await writing(store, 'First');
  assert.deepEqual(kinds(calls), ['get']);
  assert.equal(store.getSnapshot().editing, false);

  await writing(store, 'Second');
  same(calls[1], ['update', 'link1', 'w1', 'Second', 3]);
  assert.equal(store.getSnapshot().saved.version, 4);
  assert.equal(store.getSnapshot().saved.body, 'Second');
});

test('editing starts from the saved text and cancel drops the draft', async () => {
  const { store, server } = makeStore();
  server.entry = entry('Saved text');
  await store.open(ctx());
  store.startEditing();
  assert.equal(store.getSnapshot().draft, 'Saved text');
  store.setDraft('Half way');
  store.cancelEditing();
  assert.equal(store.getSnapshot().draft, '');
  assert.equal(store.getSnapshot().editing, false);
  assert.equal(store.getSnapshot().saved.body, 'Saved text');
});

test('an edit refused as stale fetches the latest, keeps the draft and changes nothing by itself', async () => {
  const { store, calls, server } = makeStore({
    update: async (...a) => { calls.push(['update', ...a]); throw apiError(409, 'changed'); },
  });
  server.entry = entry('v1', 1);
  await store.open(ctx());
  store.startEditing();
  store.setDraft('My edit');
  server.entry = entry('Edited elsewhere', 2);
  await store.save();

  assert.deepEqual(kinds(calls), ['get', 'update', 'get']);
  const state = snap(store);
  assert.equal(state.draft, 'My edit');
  assert.equal(state.conflict.action, 'save');
  assert.equal(state.conflict.loaded, true);
  assert.equal(state.conflict.latest.body, 'Edited elsewhere');
  assert.equal(state.saved.body, 'v1'); // not replaced until the coach chooses
  assert.equal(state.saving, false);

  // While the conflict is open nothing can be saved or edited or deleted.
  await store.save();
  store.setDraft('sneaky');
  await store.remove();
  assert.deepEqual(kinds(calls), ['get', 'update', 'get']);
  assert.equal(store.getSnapshot().draft, 'My edit');
});

test('"keep my text" rebases onto the latest version and needs a deliberate second save', async () => {
  // A backend that enforces versions like the real one.
  let current = entry('v1', 1);
  const writes = [];
  const store = createWorkoutFeedbackStore(
    {
      get: async () => ({ feedback: current }),
      create: async () => { throw new Error('unused'); },
      update: async (_l, _w, body, version) => {
        writes.push([body, version]);
        if (version !== current.version) throw apiError(409);
        current = entry(body, version + 1);
        return current;
      },
      remove: async () => {},
    },
    { onForbidden: () => {}, onUnavailable: () => {} },
    () => 'r',
  );
  await store.open(ctx());
  store.startEditing();
  store.setDraft('My edit');
  current = entry('Theirs', 2); // another device edited first
  await store.save();
  assert.equal(store.getSnapshot().conflict.latest.body, 'Theirs');

  store.keepMine();
  const state = snap(store);
  assert.equal(state.conflict, null);
  assert.equal(state.editing, true);
  assert.equal(state.draft, 'My edit');
  assert.equal(state.saved.version, 2);
  assert.deepEqual(writes, [['My edit', 1]], 'no automatic second write');

  await store.save();
  assert.deepEqual(writes, [['My edit', 1], ['My edit', 2]]);
  assert.equal(store.getSnapshot().saved.body, 'My edit');
  assert.equal(store.getSnapshot().saved.version, 3);
});

test('"use the latest" drops the draft and shows what is stored', async () => {
  const { store, server } = makeStore({ update: async () => { throw apiError(409); } });
  server.entry = entry('v1', 1);
  await store.open(ctx());
  store.startEditing();
  store.setDraft('Mine');
  server.entry = entry('Theirs', 2);
  await store.save();
  store.useLatest();
  const state = snap(store);
  assert.equal(state.conflict, null);
  assert.equal(state.editing, false);
  assert.equal(state.draft, '');
  assert.equal(state.saved.body, 'Theirs');
});

test('a conflict where the entry was deleted elsewhere: keeping my text then creates a new entry', async () => {
  const { store, calls, server } = makeStore({ update: async () => { throw apiError(409); } });
  server.entry = entry('v1', 1);
  await store.open(ctx());
  store.startEditing();
  store.setDraft('Mine');
  server.entry = null;
  await store.save();
  assert.equal(store.getSnapshot().conflict.latest, null);
  assert.equal(store.getSnapshot().conflict.loaded, true);

  store.keepMine();
  assert.equal(store.getSnapshot().saved, null);
  assert.equal(store.getSnapshot().draft, 'Mine');
  assert.equal(calls.filter((c) => c[0] === 'create').length, 0, 'not before the coach saves again');

  await store.save();
  const creates = calls.filter((c) => c[0] === 'create');
  assert.equal(creates.length, 1);
  assert.equal(creates[0][4], 'Mine');
  assert.equal(store.getSnapshot().saved.version, 1);
});

test('if the latest copy cannot be fetched after a conflict, nothing can be resolved until it is', async () => {
  let getFails = false;
  let phase = 0;
  const s = createWorkoutFeedbackStore(
    {
      get: async () => {
        phase += 1;
        if (phase === 1) return { feedback: entry('v1') };
        if (getFails) throw networkError();
        return { feedback: entry('Theirs', 2) };
      },
      create: async () => { throw new Error('unused'); },
      update: async () => { throw apiError(409); },
      remove: async () => {},
    },
    { onForbidden: () => {}, onUnavailable: () => {} },
    () => 'r',
  );
  await s.open(ctx());
  s.startEditing();
  s.setDraft('Mine');
  getFails = true;
  await s.save();
  assert.equal(s.getSnapshot().conflict.loaded, false);
  s.keepMine();
  s.useLatest();
  assert.notEqual(s.getSnapshot().conflict, null, 'unresolvable before the latest copy is known');
  assert.equal(s.getSnapshot().draft, 'Mine');

  getFails = false;
  await s.retryConflict();
  assert.equal(s.getSnapshot().conflict.loaded, true);
  assert.equal(s.getSnapshot().conflict.latest.body, 'Theirs');
});

test('deleting names the version; a stale delete becomes a review, not a deletion', async () => {
  const { store, calls, server } = makeStore();
  server.entry = entry('v1', 2);
  await store.open(ctx());
  await store.remove();
  same(calls[1], ['remove', 'link1', 'w1', 2]);
  assert.equal(store.getSnapshot().saved, null);
  assert.equal(store.getSnapshot().deleting, false);

  const stale = makeStore({ remove: async () => { throw apiError(409); } });
  stale.server.entry = entry('v1', 1);
  await stale.store.open(ctx());
  stale.server.entry = entry('v2', 2);
  await stale.store.remove();
  const conflict = snap(stale.store).conflict;
  assert.equal(conflict.action, 'delete');
  assert.equal(conflict.latest.body, 'v2');
  stale.store.keepMine(); // not offered for a delete
  assert.notEqual(stale.store.getSnapshot().conflict, null);
  stale.store.useLatest();
  assert.equal(stale.store.getSnapshot().saved.body, 'v2');
});

test('a failed delete keeps the entry and says so; double taps send one delete', async () => {
  const gate = deferred();
  let fail = true;
  const { store, calls, server } = makeStore({
    remove: async (...a) => { calls.push(['remove', ...a]); await gate.promise; if (fail) throw networkError(); },
  });
  server.entry = entry('keep me', 1);
  await store.open(ctx());
  const a = store.remove();
  const b = store.remove();
  gate.resolve();
  await Promise.all([a, b]);
  assert.equal(calls.filter((c) => c[0] === 'remove').length, 1);
  assert.equal(store.getSnapshot().saved.body, 'keep me');
  assert.match(store.getSnapshot().error, /Cannot connect/);
  fail = false;
  await store.remove();
  assert.equal(store.getSnapshot().saved, null);
});

test('403 on a save clears everything including the draft and reports the refusal', async () => {
  const { store, server, refusals } = makeStore({ update: async () => { throw apiError(403); } });
  server.entry = entry('v1');
  await store.open(ctx());
  store.startEditing();
  store.setDraft('private draft');
  await store.save();
  const state = snap(store);
  assert.equal(state.context, null);
  assert.equal(state.saved, null);
  assert.equal(state.draft, '');
  same(refusals.forbidden, [ctx()]);
});

test('403 on the first read also clears and reports', async () => {
  const { store, refusals } = makeStore({ get: async () => { throw apiError(403); } });
  await store.open(ctx());
  assert.equal(store.getSnapshot().context, null);
  same(refusals.forbidden, [ctx()]);
});

test('404 clears the entry and draft, marks it unavailable and lets the caller find out why', async () => {
  const { store, server, refusals } = makeStore({ remove: async () => { throw apiError(404); } });
  server.entry = entry('v1');
  await store.open(ctx());
  await store.remove();
  const state = snap(store);
  assert.equal(state.unavailable, true);
  assert.equal(state.saved, null);
  assert.equal(state.draft, '');
  assert.equal(state.loaded, false);
  same(refusals.unavailable, [ctx()]);
  // Nothing further can be started.
  store.startEditing();
  await store.save();
  assert.equal(store.getSnapshot().editing, false);
});

test('answers that arrive after close, reset or another context change nothing', async () => {
  for (const interrupt of [
    (s) => s.close(),
    (s) => s.reset(),
    (s) => s.open(ctx({ workoutId: 'w2' })),
    (s) => s.open(ctx({ userId: 'coach2' })),
  ]) {
    const gate = deferred();
    const { store } = makeStore({ create: async () => { await gate.promise; return entry('Late'); } });
    await store.open(ctx());
    store.startEditing();
    store.setDraft('Late');
    const saving = store.save();
    interrupt(store);
    const before = snap(store);
    gate.resolve();
    await saving;
    await settle();
    assert.equal(store.getSnapshot().saved, null);
    assert.equal(store.getSnapshot().draft, '');
    assert.equal(store.getSnapshot().saving, false);
    assert.equal(snap(store).saved, before.saved);
  }
});

test('a late first read for an earlier workout is discarded', async () => {
  const gates = { w1: deferred(), w2: deferred() };
  const { store } = makeStore({ get: async (_l, workout) => { await gates[workout].promise; return { feedback: entry(`for ${workout}`) }; } });
  const first = store.open(ctx());
  const second = store.open(ctx({ workoutId: 'w2' }));
  gates.w2.resolve();
  await second;
  gates.w1.resolve();
  await first;
  assert.equal(store.getSnapshot().context.workoutId, 'w2');
  assert.equal(store.getSnapshot().saved.body, 'for w2');
});

test('another context starts from nothing: no draft, entry or error carries over', async () => {
  const { store, server } = makeStore();
  server.entry = entry('A');
  await store.open(ctx());
  store.startEditing();
  store.setDraft('draft for A');
  await store.open(ctx({ workoutId: 'w2' }));
  const state = snap(store);
  assert.equal(state.editing, false);
  assert.equal(state.draft, '');
  assert.equal(state.error, null);
});

test('reopening the same context refreshes the entry but never disturbs a draft', async () => {
  const { store, calls, server } = makeStore();
  server.entry = entry('v1', 1);
  await store.open(ctx());
  server.entry = entry('v2', 2);
  await store.open(ctx());
  assert.equal(store.getSnapshot().saved.version, 2);
  assert.equal(calls.filter((c) => c[0] === 'get').length, 2);

  store.startEditing();
  store.setDraft('mid-edit');
  server.entry = entry('v3', 3);
  await store.open(ctx());
  assert.equal(store.getSnapshot().saved.version, 2, 'the base of a draft does not move silently');
  assert.equal(store.getSnapshot().draft, 'mid-edit');
});

test('editing cannot start while a read is running, so a draft never sits on a moving base', async () => {
  const gate = deferred();
  let first = true;
  const { store } = makeStore({
    get: async () => {
      if (first) { first = false; return { feedback: entry('v1', 1) }; }
      await gate.promise;
      return { feedback: entry('v2', 2) };
    },
  });
  await store.open(ctx());
  const refreshing = store.open(ctx());
  store.startEditing();
  assert.equal(store.getSnapshot().editing, false);
  gate.resolve();
  await refreshing;
  assert.equal(store.getSnapshot().saved.version, 2);
  store.startEditing();
  assert.equal(store.getSnapshot().draft, 'v2');
});

test('a malformed reply is a failed call, the draft stays and a repeat is safe', async () => {
  let bad = true;
  const seen = [];
  const s = createWorkoutFeedbackStore(
    {
      get: async () => ({ feedback: null }),
      create: async (_l, _w, requestId, body) => {
        seen.push(requestId);
        if (bad) return { nope: true };
        return entry(body);
      },
      update: async () => { throw new Error('unused'); },
      remove: async () => {},
    },
    { onForbidden: () => {}, onUnavailable: () => {} },
    (() => { let n = 0; return () => `k${++n}`; })(),
  );
  await s.open(ctx());
  await writing(s, 'Text');
  assert.equal(s.getSnapshot().saved, null);
  assert.equal(s.getSnapshot().draft, 'Text');
  assert.ok(s.getSnapshot().error);
  bad = false;
  await s.save();
  assert.deepEqual(seen, ['k1', 'k1']);
  assert.equal(s.getSnapshot().saved.body, 'Text');
});

test('a second device creating the entry first turns a create into a review', async () => {
  const { store, server } = makeStore({ create: async () => { throw apiError(409); } });
  await store.open(ctx());
  store.startEditing();
  store.setDraft('Mine');
  server.entry = entry('Theirs from the tablet', 1);
  await store.save();
  const state = snap(store);
  assert.equal(state.conflict.latest.body, 'Theirs from the tablet');
  assert.equal(state.draft, 'Mine');
  store.keepMine();
  assert.equal(store.getSnapshot().saved.version, 1);
  assert.equal(store.getSnapshot().editing, true);
});

test('subscribers are told about every change and can unsubscribe', async () => {
  const { store } = makeStore();
  let n = 0;
  const off = store.subscribe(() => { n += 1; });
  await store.open(ctx());
  assert.ok(n >= 2);
  off();
  const before = n;
  store.startEditing();
  assert.equal(n, before);
});

// ── Received (athlete) store ────────────────────────────────────────────

const received = (id, body, coach = 'coachA') => ({
  id, body, coach: { username: coach, first_name: null, last_name: null },
  created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z',
});
function makeReceived(impl) {
  const calls = [];
  const store = createReceivedFeedbackStore({ list: (...a) => { calls.push(a); return impl(...a); } });
  return { store, calls };
}
const scope = (extra = {}) => ({ userId: 'ath1', workoutId: 'w1', ...extra });

test('athlete: loads for the workout and holds each coach separately', async () => {
  const { store, calls } = makeReceived(async () => ({ items: [received('a', 'One'), received('b', 'Two', 'coachB')] }));
  assert.equal(calls.length, 0);
  await store.load(scope());
  same(calls, [['w1']]);
  assert.equal(store.getSnapshot().loaded, true);
  assert.deepEqual(json(store.getSnapshot().items.map((i) => i.coach.username)), ['coachA', 'coachB']);
});

test('athlete: concurrent loads share one request; a later load refreshes', async () => {
  const gate = deferred();
  const { store, calls } = makeReceived(async () => { await gate.promise; return { items: [] }; });
  const a = store.load(scope());
  const b = store.load(scope());
  gate.resolve();
  await Promise.all([a, b]);
  assert.equal(calls.length, 1);
  await store.load(scope());
  assert.equal(calls.length, 2);
});

test('athlete: a late answer for an earlier workout or account is discarded', async () => {
  const gates = { w1: deferred(), w2: deferred() };
  const { store } = makeReceived(async (workoutId) => { await gates[workoutId].promise; return { items: [received(workoutId, `for ${workoutId}`)] }; });
  const first = store.load(scope());
  const second = store.load(scope({ workoutId: 'w2' }));
  gates.w2.resolve();
  await second;
  gates.w1.resolve();
  await first;
  assert.equal(store.getSnapshot().scope.workoutId, 'w2');
  assert.deepEqual(json(store.getSnapshot().items.map((i) => i.body)), ['for w2']);

  const gate = deferred();
  const later = makeReceived(async () => { await gate.promise; return { items: [received('x', 'late')] }; });
  const pending = later.store.load(scope());
  later.store.reset();
  gate.resolve();
  await pending;
  assert.equal(later.store.getSnapshot().items.length, 0);
  assert.equal(later.store.getSnapshot().scope, null);
});

test('athlete: a failed refresh keeps what was shown and says so; a first failure is an error, not "no feedback"', async () => {
  let fail = false;
  const { store } = makeReceived(async () => { if (fail) throw networkError(); return { items: [received('a', 'Kept')] }; });
  await store.load(scope());
  fail = true;
  await store.load(scope());
  assert.equal(store.getSnapshot().items.length, 1);
  assert.match(store.getSnapshot().error, /Showing what was loaded earlier/);

  const fresh = makeReceived(async () => { throw networkError(); });
  await fresh.store.load(scope());
  assert.equal(fresh.store.getSnapshot().loaded, false);
  assert.match(fresh.store.getSnapshot().error, /Could not load coach feedback/);
});

test('athlete: 404 (workout gone) shows nothing; a malformed reply is an error', async () => {
  const gone = makeReceived(async () => { throw apiError(404); });
  await gone.store.load(scope());
  assert.equal(gone.store.getSnapshot().loaded, true);
  assert.equal(gone.store.getSnapshot().items.length, 0);
  assert.equal(gone.store.getSnapshot().error, null);

  const bad = makeReceived(async () => ({ items: [{ id: 1 }] }));
  await bad.store.load(scope());
  assert.equal(bad.store.getSnapshot().loaded, false);
  assert.ok(bad.store.getSnapshot().error);
});

test('athlete: a synchronous failure of the API does not wedge later loads', async () => {
  let n = 0;
  const { store } = makeReceived(() => { n += 1; if (n === 1) throw new Error('boom'); return Promise.resolve({ items: [received('a', 'ok')] }); });
  await store.load(scope());
  assert.ok(store.getSnapshot().error);
  await store.load(scope());
  assert.equal(store.getSnapshot().items.length, 1);
});

// ── Display helpers ─────────────────────────────────────────────────────

test('times: written always, edited only when the text changed afterwards', () => {
  const unedited = display.feedbackTimeLines('2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z');
  assert.equal(unedited.length, 1);
  assert.match(unedited[0], /^Written .*2026/);
  const edited = display.feedbackTimeLines('2026-10-01T10:00:00Z', '2026-10-02T11:30:00Z');
  assert.equal(edited.length, 2);
  assert.match(edited[1], /^Edited .*2026/);
  assert.equal(display.feedbackWasEdited('garbage', 'garbage'), false);
  assert.equal(display.formatFeedbackTime('garbage'), '');
});

// ── Components ──────────────────────────────────────────────────────────

const react = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
};
function expand(tree) {
  if (tree === null || tree === undefined || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(expand);
  if (typeof tree.type === 'function') return expand(tree.type(tree.props));
  return [tree, ...expand(tree.props?.children)];
}
const flat = (c) => [c].flat(8).filter((x) => typeof x === 'string' || typeof x === 'number').join('');
const texts = (tree) => expand(tree).filter((n) => n.type === 'Text').map((n) => flat(n.props.children));
const allText = (tree) => texts(tree).join('\n');
const pressables = (tree) => expand(tree).filter((n) => n.type === 'Pressable');
const button = (tree, re) => pressables(tree).find((n) => re.test(n.props.accessibilityLabel ?? ''));

const alerts = [];
const storeCalls = [];
const fakeStore = new Proxy({}, { get: (_t, name) => (...args) => { storeCalls.push([name, ...args]); } });
const rn = {
  ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', Text: 'Text', TextInput: 'TextInput', View: 'View',
  Alert: { alert: (...args) => { alerts.push(args); } },
  StyleSheet: { create: (v) => v, hairlineWidth: 1 },
};
const theme = { roman: {}, romanFont: {} };
const coachModule = load('src/coaching/CoachFeedbackSection.tsx', {
  'react-native': rn,
  '../romanTheme': theme,
  './feedbackDisplay': display,
  './workoutFeedback': feedback,
  './workoutFeedbackSession': { workoutFeedbackStore: fakeStore },
}, { React: react });
const { CoachFeedbackSection } = coachModule;
const closedState = feedback.initialWorkoutFeedbackState;
const open = (changes = {}) => ({ ...json(closedState()), context: ctx(), loaded: true, ...changes });
const drawCoach = (state) => CoachFeedbackSection({ state, athleteName: 'Ada Lovelace' });
const reset = () => { alerts.length = 0; storeCalls.length = 0; };

test('coach section: labelled, says the athlete can see it, and the workout stays read-only', () => {
  const tree = drawCoach(open());
  assert.match(allText(tree), /Your feedback/);
  assert.match(allText(tree), /Ada Lovelace can see feedback you save here/);
  assert.match(allText(tree), /workout above stays read-only/);
  assert.match(allText(tree), /You have not left feedback/);
  assert.ok(button(tree, /^Write feedback$/));
});

test('coach section: loading, load error with retry, unavailable', () => {
  reset();
  assert.ok(expand(drawCoach(open({ loaded: false, loading: true }))).some((n) => n.type === 'ActivityIndicator'));
  const failed = drawCoach(open({ loaded: false, loadError: true }));
  assert.match(allText(failed), /Could not load your feedback/);
  button(failed, /^Try again$/).props.onPress();
  assert.deepEqual(storeCalls.map((c) => c[0]), ['retryLoad']);
  const gone = drawCoach(open({ loaded: false, unavailable: true }));
  assert.match(allText(gone), /no longer available/);
  assert.equal(button(gone, /Write feedback|Edit|Delete/), undefined);
});

test('coach section: shows the saved text, its times, and edit/delete', () => {
  reset();
  const saved = entry('Nice depth.\nKeep the pause.', 2);
  const tree = drawCoach(open({ saved }));
  assert.match(allText(tree), /Nice depth\.\nKeep the pause\./);
  assert.match(allText(tree), /Written/);
  assert.match(allText(tree), /Edited/);
  button(tree, /^Edit$/).props.onPress();
  assert.deepEqual(storeCalls.map((c) => c[0]), ['startEditing']);
});

test('coach section: delete asks first, and only the confirmation deletes', () => {
  reset();
  const tree = drawCoach(open({ saved: entry('Text') }));
  button(tree, /^Delete$/).props.onPress();
  assert.equal(storeCalls.length, 0);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0][0], /Delete feedback/);
  assert.match(alerts[0][1], /Ada Lovelace will no longer see it/);
  const buttons = alerts[0][2];
  assert.equal(buttons.find((b) => b.style === 'cancel').onPress, undefined);
  buttons.find((b) => b.style === 'destructive').onPress();
  assert.deepEqual(storeCalls.map((c) => c[0]), ['remove']);
});

test('coach section: the editor has a counter, a multiline input limited to 2000, and save asks first with the notice', () => {
  reset();
  const tree = drawCoach(open({ editing: true, draft: 'Hello' }));
  const input = expand(tree).find((n) => n.type === 'TextInput');
  assert.equal(input.props.multiline, true);
  assert.equal(input.props.maxLength, 2000);
  assert.equal(input.props.value, 'Hello');
  assert.equal(input.props.editable, true);
  assert.match(input.props.accessibilityLabel, /Feedback/);
  assert.match(allText(tree), /5\/2000/);
  input.props.onChangeText('Hello!');
  assert.deepEqual(storeCalls.map((c) => c[0]), ['setDraft']);

  reset();
  button(tree, /^Save feedback$/).props.onPress();
  assert.equal(storeCalls.length, 0, 'nothing is saved before the confirmation');
  assert.match(alerts[0][1], /Ada Lovelace will be able to read this feedback/);
  alerts[0][2].find((b) => b.text === 'Save feedback').onPress();
  assert.deepEqual(storeCalls.map((c) => c[0]), ['save']);
});

test('coach section: while saving the input and buttons are disabled and an error keeps the draft visible', () => {
  const saving = drawCoach(open({ editing: true, draft: 'Hello', saving: true }));
  assert.equal(expand(saving).find((n) => n.type === 'TextInput').props.editable, false);
  assert.equal(button(saving, /Saving feedback/).props.disabled, true);
  assert.equal(button(saving, /^Cancel$/).props.disabled, true);

  const failed = drawCoach(open({ editing: true, draft: 'Kept draft', error: 'Cannot connect right now.' }));
  assert.match(allText(failed), /Cannot connect right now/);
  assert.equal(expand(failed).find((n) => n.type === 'TextInput').props.value, 'Kept draft');
  assert.equal(button(failed, /^Save feedback$/).props.disabled, false);
});

test('coach section: a conflict shows the latest copy and offers keep/use, but keep only for a save', () => {
  reset();
  const latest = entry('Latest text', 2);
  const tree = drawCoach(open({ editing: true, draft: 'Mine', conflict: { action: 'save', latest, loaded: true } }));
  assert.match(allText(tree), /changed since you opened it/);
  assert.match(allText(tree), /Latest text/);
  assert.equal(expand(tree).find((n) => n.type === 'TextInput'), undefined, 'review first, no typing meanwhile');
  button(tree, /Keep my text/).props.onPress();
  button(tree, /^Use the latest$/).props.onPress();
  assert.deepEqual(storeCalls.map((c) => c[0]), ['keepMine', 'useLatest']);

  const del = drawCoach(open({ saved: entry('x'), conflict: { action: 'delete', latest, loaded: true } }));
  assert.equal(button(del, /Keep my text/), undefined);
  assert.ok(button(del, /^Use the latest$/));

  const gone = drawCoach(open({ conflict: { action: 'save', latest: null, loaded: true } }));
  assert.match(allText(gone), /was deleted/);

  reset();
  const unknown = drawCoach(open({ conflict: { action: 'save', latest: null, loaded: false } }));
  assert.equal(button(unknown, /Keep my text|Use the latest/), undefined);
  button(unknown, /^Try again$/).props.onPress();
  assert.deepEqual(storeCalls.map((c) => c[0]), ['retryConflict']);
});

test('coach section: touch targets are at least 44 points', () => {
  const source = read('src/coaching/CoachFeedbackSection.tsx');
  assert.match(source, /const MIN_TOUCH = 44/);
  assert.ok((source.match(/minHeight: MIN_TOUCH/g) ?? []).length >= 2);
});

const receivedModule = load('src/coaching/ReceivedFeedbackSection.tsx', {
  'expo-router': { useFocusEffect: () => {} },
  react: { useCallback: (fn) => fn },
  'react-native': rn,
  '../lightTheme': { light: {} },
  './feedbackDisplay': display,
  './presentation': presentation,
  './receivedFeedback': {},
  './receivedFeedbackSession': { receivedFeedbackStore: fakeStore },
  './useReceivedFeedback': { useReceivedFeedback: () => null },
}, { React: react });
const { ReceivedFeedbackView } = receivedModule;
const rstate = (changes = {}) => ({ scope: { userId: 'a', workoutId: 'w' }, items: [], loaded: true, loading: false, error: null, ...changes });

test('athlete view: nothing is drawn while there is no feedback, so the workout looks as before', () => {
  assert.equal(expand(ReceivedFeedbackView({ state: rstate(), onRetry() {} })).length, 0);
  assert.equal(expand(ReceivedFeedbackView({ state: rstate({ loaded: false }), onRetry() {} })).length, 0);
  const loading = ReceivedFeedbackView({ state: rstate({ loaded: false, loading: true }), onRetry() {} });
  assert.ok(expand(loading).some((n) => n.type === 'ActivityIndicator'));
});

test('athlete view: labelled as the coach\'s, with author name, handle, text and times, and nothing to edit', () => {
  const items = [
    { ...received('a', 'Solid session.\nBrace harder.', 'coachA'), coach: { username: 'coachA', first_name: 'Grace', last_name: 'Hopper' } },
    { ...received('b', 'Second opinion.', 'coachB'), updated_at: '2026-10-03T12:00:00Z' },
  ];
  const tree = ReceivedFeedbackView({ state: rstate({ items }), onRetry() {} });
  const text = allText(tree);
  assert.match(text, /Coach feedback/);
  assert.match(text, /not part of your workout log/);
  assert.match(text, /Grace Hopper/);
  assert.match(text, /@coachA/);
  assert.match(text, /Solid session\.\nBrace harder\./);
  assert.match(text, /coachB/);
  assert.match(text, /Written/);
  assert.match(text, /Edited/);
  assert.equal(expand(tree).filter((n) => n.type === 'TextInput').length, 0);
  assert.equal(pressables(tree).length, 0, 'no controls without an error');
  const labels = expand(tree).map((n) => n.props?.accessibilityLabel).filter(Boolean);
  assert.ok(labels.some((l) => /^Feedback from Grace Hopper\./.test(l)));
});

test('athlete view: a failed refresh keeps the entries and offers a retry', () => {
  reset();
  const tree = ReceivedFeedbackView({
    state: rstate({ items: [received('a', 'Kept text')], error: 'Could not refresh coach feedback. Showing what was loaded earlier.' }),
    onRetry: () => storeCalls.push(['retry']),
  });
  assert.match(allText(tree), /Kept text/);
  assert.match(allText(tree), /Could not refresh/);
  button(tree, /Try loading coach feedback again/).props.onPress();
  assert.deepEqual(storeCalls, [['retry']]);

  const first = ReceivedFeedbackView({ state: rstate({ loaded: false, error: 'Could not load coach feedback.' }), onRetry() {} });
  assert.match(allText(first), /Could not load coach feedback/);
});

// ── Wiring (source scans: presence, not behaviour on a device) ──────────

test('wiring: sign-out and session expiry reset both feedback stores', () => {
  const auth = read('src/auth/AuthContext.tsx');
  assert.equal((auth.match(/workoutFeedbackStore\.reset\(\)/g) ?? []).length, 2);
  assert.equal((auth.match(/receivedFeedbackStore\.reset\(\)/g) ?? []).length, 2);
});

test('wiring: the coach screen mounts the section, keeps the workout read-only and handles the keyboard', () => {
  const screen = read('app/(app)/coaching/athlete/[linkId]/workout/[workoutId].tsx');
  assert.match(screen, /<CoachFeedbackSection/);
  assert.match(screen, /workoutFeedbackStore\.open\(\{ userId, linkId, workoutId \}\)/);
  assert.match(screen, /keyboardShouldPersistTaps="handled"/);
  assert.match(screen, /automaticallyAdjustKeyboardInsets/);
  assert.match(screen, /AthleteExerciseHistoryPanel/);
  assert.match(screen, /athleteExerciseHistoryStore\.close\(\)/);
});

test('wiring: the athlete\'s own workout shows received feedback only for finished workouts', () => {
  const screen = read('app/(app)/workout/[id].tsx');
  assert.match(screen, /isFinished \? <ReceivedFeedbackSection/);
});

test('wiring: the feedback store closes when the athlete view changes or loses access', () => {
  const session = read('src/coaching/workoutFeedbackSession.ts');
  assert.match(session, /athleteWorkoutsStore\.subscribe/);
  assert.match(session, /workoutFeedbackStore\.close\(\)/);
  assert.match(session, /revoke\("not_shared"\)/);
});
