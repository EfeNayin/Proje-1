// Run with node --test tests/athlete-workouts.test.cjs. Pure logic, no I/O.
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

function load(file, modules = {}) {
  const code = ts.transpileModule(readFileSync(path.join(mobileRoot, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module_ = { exports: {} };
  vm.runInNewContext(code, {
    module: module_, exports: module_.exports, Error, Set, Math, Number, Date, Promise,
    require: (name) => { if (!(name in modules)) throw new Error(`unexpected import ${name}`); return modules[name]; },
  });
  return module_.exports;
}

const units = load('src/units/weight.ts');
const { createAthleteWorkoutsStore } = load('src/coaching/athleteWorkouts.ts');
const display = load('src/coaching/athleteWorkoutDisplay.ts', { '../units/weight': units });
const { refreshAthleteView } = load('src/coaching/openAthlete.ts');
const { createCoachingStore } = load('src/coaching/coachingStore.ts');

// Values built inside the vm context are not reference-equal to this realm's, so compare as JSON.
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const apiError = (status, message) => Object.assign(new Error(message), { status });
const networkError = () => apiError(0, 'Cannot connect right now. Check your connection and try again.');

const scope = { userId: 'coach1', linkId: 'link1' };
const session = (id, extra = {}) => ({
  id, title: `W${id}`, performed_at: '2026-10-01T10:00:00Z', finished_at: '2026-10-01T11:05:00Z',
  finished_automatically: false, total_sets: 3, ...extra,
});
const page = (items, total = items.length, offset = 0) => ({ items, total, limit: 2, offset });
const detailOf = (id) => ({ ...session(id), exercises: [] });

function fakeApi(overrides = {}) {
  const calls = [];
  const record = (name, impl) => (...args) => { calls.push([name, ...args]); return impl(...args); };
  const api = {
    listWorkouts: record('listWorkouts', async () => page([])),
    getWorkout: record('getWorkout', async (_link, id) => detailOf(id)),
  };
  for (const [name, impl] of Object.entries(overrides)) api[name] = record(name, impl);
  return { api, calls, count: (name) => calls.filter((call) => call[0] === name).length };
}

test('first load, empty history and a refresh that fails while keeping what is shown', async () => {
  let mode = 'empty';
  const { api } = fakeApi({
    listWorkouts: async () => {
      if (mode === 'fail') throw networkError();
      return page(mode === 'empty' ? [] : [session('a')]);
    },
  });
  const store = createAthleteWorkoutsStore(api, 2);
  store.bind(scope);

  await store.refresh();
  assert.equal(store.getSnapshot().list.loaded, true);
  same(store.getSnapshot().list.items, []);
  assert.equal(store.getSnapshot().list.error, null);

  mode = 'one';
  await store.refresh();
  assert.equal(store.getSnapshot().list.items.length, 1);

  mode = 'fail';
  await store.refresh();
  const { list, denied } = store.getSnapshot();
  assert.equal(list.items.length, 1); // an ordinary failure keeps the data
  assert.equal(list.error, 'Cannot connect right now. Check your connection and try again.');
  assert.equal(denied, null);
});

test('simultaneous refreshes share one request', async () => {
  const gate = deferred();
  const { api, count } = fakeApi({ listWorkouts: () => gate.promise });
  const store = createAthleteWorkoutsStore(api, 2);
  store.bind(scope);

  const first = store.refresh();
  const second = store.refresh(); // e.g. focus event plus pull to refresh
  gate.resolve(page([session('a')]));
  await Promise.all([first, second]);

  assert.equal(count('listWorkouts'), 1);
  assert.equal(store.getSnapshot().list.items.length, 1);
});

test('paging walks the history by rows received, once per page, without duplicates', async () => {
  const all = ['a', 'b', 'c', 'd', 'e'].map((id) => session(id));
  const { api, calls } = fakeApi({
    listWorkouts: async (_link, limit, offset) => page(all.slice(offset, offset + limit), all.length, offset),
  });
  const store = createAthleteWorkoutsStore(api, 2);
  store.bind(scope);
  await store.refresh();

  const a = store.loadMore();
  const b = store.loadMore(); // end-of-list fires repeatedly
  await Promise.all([a, b]);
  await store.loadMore();
  await store.loadMore(); // already complete: no request
  await store.loadMore();

  same(store.getSnapshot().list.items.map((item) => item.id), ['a', 'b', 'c', 'd', 'e']);
  same(calls.map((call) => call[3]), [0, 2, 4]);
});

test('a failed next page keeps the list and can be retried', async () => {
  let fail = true;
  const all = ['a', 'b', 'c'].map((id) => session(id));
  const { api } = fakeApi({
    listWorkouts: async (_l, limit, offset) => {
      if (offset > 0 && fail) throw networkError();
      return page(all.slice(offset, offset + limit), all.length, offset);
    },
  });
  const store = createAthleteWorkoutsStore(api, 2);
  store.bind(scope);
  await store.refresh();

  await store.loadMore();
  assert.equal(store.getSnapshot().list.items.length, 2);
  assert.notEqual(store.getSnapshot().list.moreError, null);

  fail = false;
  await store.loadMore();
  assert.equal(store.getSnapshot().list.items.length, 3);
  assert.equal(store.getSnapshot().list.moreError, null);
});

test('a next-page answer that arrives after a refresh is dropped', async () => {
  const slow = deferred();
  const { api } = fakeApi({
    listWorkouts: async (_l, _limit, offset) => (offset === 0 ? page([session('a'), session('b')], 4) : slow.promise),
  });
  const store = createAthleteWorkoutsStore(api, 2);
  store.bind(scope);
  await store.refresh();

  const more = store.loadMore();
  await store.refresh();
  slow.resolve(page([session('c'), session('d')], 4, 2));
  await more;

  same(store.getSnapshot().list.items.map((item) => item.id), ['a', 'b']);
});

test('403 clears everything shown and says the athlete stopped sharing', async () => {
  let refuse = false;
  const { api } = fakeApi({
    listWorkouts: async () => { if (refuse) throw apiError(403, 'not sharing'); return page([session('a')]); },
    getWorkout: async () => { throw apiError(403, 'not sharing'); },
  });
  const store = createAthleteWorkoutsStore(api, 2);
  store.bind(scope);
  await store.refresh();
  assert.equal(store.getSnapshot().list.items.length, 1);

  refuse = true;
  await store.refresh();

  const state = store.getSnapshot();
  assert.equal(state.denied, 'not_shared');
  same(state.list.items, []);
  assert.equal(state.list.error, null); // no retry banner: retrying cannot help
  assert.equal(state.detail.data, null);
});

test('a refusal while a workout is open clears the workout too', async () => {
  const { api } = fakeApi({ getWorkout: async () => { throw apiError(403, 'no'); } });
  const store = createAthleteWorkoutsStore(api, 2);
  store.bind(scope);

  await store.loadDetail('w1');

  assert.equal(store.getSnapshot().denied, 'not_shared');
  assert.equal(store.getSnapshot().detail.data, null);
});

test('a 404 on the list means the connection ended; a 404 on one workout only means that workout is gone', async () => {
  let listStatus = 200;
  const { api } = fakeApi({
    listWorkouts: async () => { if (listStatus === 404) throw apiError(404, 'Connection not found.'); return page([session('a')]); },
    getWorkout: async () => { throw apiError(404, 'Workout not found.'); },
  });
  const store = createAthleteWorkoutsStore(api, 2);
  store.bind(scope);
  await store.refresh();

  await store.loadDetail('gone');
  assert.equal(store.getSnapshot().detail.missing, true);
  assert.equal(store.getSnapshot().denied, null);
  assert.equal(store.getSnapshot().list.items.length, 1); // the rest is still fine

  listStatus = 404;
  await store.refresh();
  assert.equal(store.getSnapshot().denied, 'ended');
  same(store.getSnapshot().list.items, []);
});

test('access can come back: a later successful refresh clears the refusal', async () => {
  let refuse = true;
  const { api } = fakeApi({
    listWorkouts: async () => { if (refuse) throw apiError(403, 'no'); return page([session('a')]); },
  });
  const store = createAthleteWorkoutsStore(api, 2);
  store.bind(scope);
  await store.refresh();
  assert.equal(store.getSnapshot().denied, 'not_shared');

  refuse = false;
  await store.refresh();

  assert.equal(store.getSnapshot().denied, null);
  assert.equal(store.getSnapshot().list.items.length, 1);
});

test('sign-out, another user or another athlete drops the data and voids late answers', async () => {
  for (const change of [
    (store) => store.reset(),
    (store) => store.bind({ userId: 'coach2', linkId: 'link1' }),
    (store) => store.bind({ userId: 'coach1', linkId: 'link2' }),
  ]) {
    const gate = deferred();
    const { api } = fakeApi({ listWorkouts: () => gate.promise, getWorkout: () => gate.promise });
    const store = createAthleteWorkoutsStore(api, 2);
    store.bind(scope);
    const listing = store.refresh();
    const opening = store.loadDetail('w1');

    change(store);
    gate.resolve(page([session('secret')]));
    await Promise.all([listing, opening]);

    const state = store.getSnapshot();
    same(state.list.items, []);
    assert.equal(state.detail.data, null);
    assert.equal(state.list.loaded, false);
  }
});

test('re-binding the same scope keeps what is loaded', async () => {
  const { api } = fakeApi({ listWorkouts: async () => page([session('a')]) });
  const store = createAthleteWorkoutsStore(api, 2);
  store.bind(scope);
  await store.refresh();

  store.bind({ ...scope });

  assert.equal(store.getSnapshot().list.items.length, 1);
});

test('a workout that finishes loading after the screen moved to another one is ignored', async () => {
  const gates = { w1: deferred(), w2: deferred() };
  const { api } = fakeApi({ getWorkout: (_link, id) => gates[id].promise });
  const store = createAthleteWorkoutsStore(api, 2);
  store.bind(scope);

  const first = store.loadDetail('w1');
  store.closeDetail();
  const second = store.loadDetail('w2');
  gates.w1.resolve(detailOf('w1'));
  gates.w2.resolve(detailOf('w2'));
  await Promise.all([first, second]);

  assert.equal(store.getSnapshot().detail.workoutId, 'w2');
  assert.equal(store.getSnapshot().detail.data.id, 'w2');
});

test('a failed reload of an open workout keeps it on screen', async () => {
  let fail = false;
  const { api } = fakeApi({
    getWorkout: async (_l, id) => { if (fail) throw networkError(); return detailOf(id); },
  });
  const store = createAthleteWorkoutsStore(api, 2);
  store.bind(scope);
  await store.loadDetail('w1');

  fail = true;
  await store.loadDetail('w1');

  assert.equal(store.getSnapshot().detail.data.id, 'w1');
  assert.notEqual(store.getSnapshot().detail.error, null);
});

// ── how the screen words things ─────────────────────────────────────────────

test('duration is shown only when the athlete pressed Finish', () => {
  assert.equal(display.durationText(session('a')), '1h 5m');
  assert.equal(
    display.durationText(session('a', { finished_at: '2026-10-01T10:45:30Z' })),
    '45m',
  );
  assert.equal(display.durationText(session('a', { finished_automatically: true })), 'Auto-closed · duration unknown');
  assert.equal(display.durationText(session('a', { finished_automatically: null })), 'Duration unavailable');
  // A closing time before the start (clock skew) is not shown as a negative duration.
  assert.equal(display.durationText(session('a', { finished_at: '2026-10-01T09:00:00Z' })), '0m');
});

test('0 kg is a real weight, and units are always written out', () => {
  assert.equal(display.setWeightText({ weight_kg: '0.00' }, 'kg'), '0 kg');
  assert.equal(display.setWeightText({ weight_kg: '82.50' }, 'kg'), '82.5 kg');
  assert.equal(display.setWeightText({ weight_kg: '82.50' }, 'lb'), '181.9 lb');
  assert.equal(display.setWeightText({ weight_kg: '0.00' }, 'lb'), '0 lb');
});

test('RIR 0 and an unrecorded RIR read differently', () => {
  assert.equal(display.rirText(0), 'RIR 0');
  assert.equal(display.rirText(3), 'RIR 3');
  assert.equal(display.rirText(null), 'RIR not logged');
  assert.notEqual(display.rirText(0), display.rirText(null));
});

test('warm-ups are marked, working sets are numbered, set counts pluralise', () => {
  assert.equal(display.setBadgeText({ is_warmup: true, set_number: 1 }), 'W');
  assert.equal(display.setBadgeText({ is_warmup: false, set_number: 2 }), '2');
  assert.equal(display.setCountText(0), '0 sets');
  assert.equal(display.setCountText(1), '1 set');
  assert.equal(display.setCountText(12), '12 sets');
});

// ── the refresh rule: do not ask when the answer is already known ─────────────

function athleteView(connections, listApi = {}) {
  const coachingCalls = { listAthletes: 0 };
  const coaching = createCoachingStore({
    enableCoach: async () => ({}), createInvite: async () => ({}), previewInvite: async () => ({}),
    acceptInvite: async () => ({}), listCoaches: async () => [], endConnection: async () => undefined,
    setWorkoutSharing: async () => ({}),
    listAthletes: async () => { coachingCalls.listAthletes += 1; return connections(); },
  });
  const calls = fakeApi({ listWorkouts: async () => page([session('a')]), ...listApi });
  const workouts = createAthleteWorkoutsStore(calls.api, 2);
  return { coaching, workouts, calls, coachingCalls };
}
const link = (shares) => ({
  id: 'link1', person: { username: 'sam', first_name: null, last_name: null },
  connected_at: '2026-10-24T10:00:00Z', shares_workouts: shares,
});

test('sharing on: the list is loaded', async () => {
  const view = athleteView(() => [link(true)]);

  await refreshAthleteView(view.coaching, view.workouts, scope);

  assert.equal(view.calls.count('listWorkouts'), 1);
  assert.equal(view.workouts.getSnapshot().list.items.length, 1);
});

test('sharing off: no workouts request is sent at all, and the reason is shown', async () => {
  const view = athleteView(() => [link(false)]);

  await refreshAthleteView(view.coaching, view.workouts, scope);

  assert.equal(view.calls.count('listWorkouts'), 0);
  assert.equal(view.workouts.getSnapshot().denied, 'not_shared');
});

test('connection gone from the list: no request, and old workouts are cleared', async () => {
  let connections = [link(true)];
  const view = athleteView(() => connections);
  await refreshAthleteView(view.coaching, view.workouts, scope);
  assert.equal(view.workouts.getSnapshot().list.items.length, 1);

  connections = [];
  await refreshAthleteView(view.coaching, view.workouts, scope);

  assert.equal(view.calls.count('listWorkouts'), 1);
  assert.equal(view.workouts.getSnapshot().denied, 'ended');
  same(view.workouts.getSnapshot().list.items, []);
});

test('switch turned off while away: on return the old workouts disappear without a new request', async () => {
  let shares = true;
  const view = athleteView(() => [link(shares)]);
  await refreshAthleteView(view.coaching, view.workouts, scope);

  shares = false;
  await refreshAthleteView(view.coaching, view.workouts, scope);

  assert.equal(view.calls.count('listWorkouts'), 1);
  same(view.workouts.getSnapshot().list.items, []);
});

test('if the connection list cannot be refreshed the backend is asked instead of guessing', async () => {
  let fail = false;
  const view = athleteView(() => { if (fail) throw networkError(); return [link(false)]; }, {
    listWorkouts: async () => { throw apiError(403, 'not sharing'); },
  });
  await refreshAthleteView(view.coaching, view.workouts, scope);
  assert.equal(view.calls.count('listWorkouts'), 0);

  fail = true;
  await refreshAthleteView(view.coaching, view.workouts, scope);

  assert.equal(view.calls.count('listWorkouts'), 1); // the server's answer, not a stale local one
  assert.equal(view.workouts.getSnapshot().denied, 'not_shared');
});

test('signing out while the connection list loads leaves nothing behind', async () => {
  const gate = deferred();
  const view = athleteView(() => gate.promise);
  const running = refreshAthleteView(view.coaching, view.workouts, scope);

  view.workouts.reset();
  view.coaching.reset();
  gate.resolve([link(true)]);
  await running;

  assert.equal(view.calls.count('listWorkouts'), 0);
  same(view.workouts.getSnapshot().list.items, []);
});
