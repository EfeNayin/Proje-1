// Run with node --test tests/athlete-exercise-history.test.cjs. Pure logic, no I/O.
//
// The store tests drive the real store with a fake API. The panel tests call
// the real (hook-free) component and walk the element tree it returns. The
// screen tests at the end are source scans: they prove the wiring is present,
// not that it behaves on a device.
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

const { createAthleteExerciseHistoryStore } = load('src/coaching/athleteExerciseHistory.ts');
const units = load('src/units/weight.ts');
const display = load('src/coaching/athleteWorkoutDisplay.ts', { '../units/weight': units });
const { createAthleteWorkoutsStore } = load('src/coaching/athleteWorkouts.ts');
const { followDenials, createAthleteOverviewStore } = load('src/coaching/athleteOverview.ts');
const { refreshAthleteView } = load('src/coaching/openAthlete.ts');

// Values built inside the vm context are not reference-equal to this realm's, so compare as JSON.
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
const settle = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const apiError = (status, message = 'error') => Object.assign(new Error(message), { status });
const networkError = () => apiError(0, 'Cannot connect right now. Check your connection and try again.');

const ctx = (extra = {}) => ({
  userId: 'coach1', linkId: 'link1', workoutId: 'anchor', exerciseId: 'bench', ...extra,
});
const setOf = (n, weight, reps, rir = null, extra = {}) => ({
  set_number: n, weight_kg: weight, reps, rir, is_warmup: false, ...extra,
});
const session = (id, extra = {}) => ({
  workout_id: id, title: `W ${id}`, performed_at: '2026-10-01T10:00:00Z',
  sets: [setOf(1, '60.00', 5, 2)], ...extra,
});
const page = (ids, next = null) => ({ items: ids.map((id) => session(id)), next_cursor: next });

function fakeApi(impl) {
  const calls = [];
  return {
    api: { getHistory: (...args) => { calls.push(args); return impl(...args); } },
    calls,
  };
}
function makeStore(impl) {
  const fake = fakeApi(impl);
  const refusals = { forbidden: [], unavailable: [] };
  const store = createAthleteExerciseHistoryStore(fake.api, {
    onForbidden: (c) => refusals.forbidden.push(c),
    onUnavailable: (c) => refusals.unavailable.push(c),
  });
  return { store, refusals, ...fake };
}
const ids = (store) => JSON.parse(JSON.stringify(store.getSnapshot().items.map((item) => item.workout_id)));

// ── Store ───────────────────────────────────────────────────────────────

test('nothing is requested until the panel is opened, then the first page loads once', async () => {
  const { store, calls } = makeStore(async () => page(['a', 'b'], 'c1'));
  assert.equal(calls.length, 0);
  assert.equal(store.getSnapshot().context, null);

  const opening = store.open(ctx());
  assert.equal(store.getSnapshot().loading, true);
  await opening;

  same(calls, [['link1', 'anchor', 'bench', null]]);
  assert.deepEqual(ids(store), ['a', 'b']);
  assert.equal(store.getSnapshot().nextCursor, 'c1');
  assert.equal(store.getSnapshot().loaded, true);
  assert.equal(store.getSnapshot().loading, false);

  // Opening the one that is already open is not a second request.
  await store.open(ctx());
  assert.equal(calls.length, 1);
});

test('an empty history is a loaded, empty state rather than an error', async () => {
  const { store } = makeStore(async () => page([]));
  await store.open(ctx());
  const state = store.getSnapshot();
  assert.equal(state.loaded, true);
  assert.equal(state.items.length, 0);
  assert.equal(state.error, null);
  assert.equal(state.nextCursor, null);
});

test('rapid taps on load more fetch one page, and each page is fetched once in order', async () => {
  const gate = deferred();
  const { store, calls } = makeStore(async (_l, _w, _e, cursor) => {
    if (cursor === null) return page(['a'], 'c1');
    if (cursor === 'c1') { await gate.promise; return page(['b'], 'c2'); }
    return page(['c']);
  });
  await store.open(ctx());

  const first = store.loadMore();
  const second = store.loadMore();
  const third = store.loadMore();
  gate.resolve();
  await Promise.all([first, second, third]);
  same(calls.map((call) => call[3]), [null, 'c1']);

  await store.loadMore();
  await store.loadMore(); // the end: nothing more to ask for
  same(calls.map((call) => call[3]), [null, 'c1', 'c2']);
  assert.deepEqual(ids(store), ['a', 'b', 'c']);
  assert.equal(store.getSnapshot().nextCursor, null);
});

test('a page that repeats a session adds it once, and a cursor that points at itself ends paging', async () => {
  const { store, calls } = makeStore(async (_l, _w, _e, cursor) =>
    cursor === null ? page(['a', 'b'], 'c1') : page(['b', 'c'], 'c1'));
  await store.open(ctx());
  await store.loadMore();
  assert.deepEqual(ids(store), ['a', 'b', 'c']);
  assert.equal(store.getSnapshot().nextCursor, null);
  await store.loadMore();
  assert.equal(calls.length, 2);
});

test('sessions with the same name, date and sets stay separate rows', async () => {
  const twin = (id) => session(id, { title: 'Push', performed_at: '2026-10-01T10:00:00Z' });
  const { store } = makeStore(async () => ({ items: [twin('x'), twin('y')], next_cursor: null }));
  await store.open(ctx());
  assert.deepEqual(ids(store), ['x', 'y']);
});

test('a failed next page keeps the rows; retry asks for that same page, once, without skipping or repeating', async () => {
  let failNext = true;
  const gate = deferred();
  const { store, calls } = makeStore(async (_l, _w, _e, cursor) => {
    if (cursor === null) return page(['a', 'b'], 'c1');
    if (failNext) { failNext = false; throw networkError(); }
    await gate.promise;
    return page(['c']);
  });
  await store.open(ctx());
  await store.loadMore();

  let state = store.getSnapshot();
  assert.equal(state.error, 'more');
  assert.equal(state.loading, false);
  assert.deepEqual(ids(store), ['a', 'b']);
  assert.equal(state.nextCursor, 'c1');
  // A failure is not retried by scrolling or by another load-more tap.
  await store.loadMore();
  assert.equal(calls.length, 2);

  const first = store.retry();
  const second = store.retry();
  assert.equal(store.getSnapshot().error, null);
  assert.equal(store.getSnapshot().loading, true);
  gate.resolve();
  await Promise.all([first, second]);

  same(calls.map((call) => call[3]), [null, 'c1', 'c1']);
  assert.deepEqual(ids(store), ['a', 'b', 'c']);
  state = store.getSnapshot();
  assert.equal(state.error, null);
  assert.equal(state.nextCursor, null);
});

test('a failed first page shows an initial error, retry reloads it, and retry does nothing otherwise', async () => {
  let fail = true;
  const { store, calls } = makeStore(async () => {
    if (fail) { fail = false; throw networkError(); }
    return page(['a']);
  });
  await store.retry(); // nothing open
  assert.equal(calls.length, 0);

  await store.open(ctx());
  assert.equal(store.getSnapshot().error, 'initial');
  assert.equal(store.getSnapshot().loaded, false);
  assert.equal(ids(store).length, 0);

  await store.retry();
  assert.deepEqual(ids(store), ['a']);
  assert.equal(store.getSnapshot().error, null);

  await store.retry(); // healthy: nothing to retry
  assert.equal(calls.length, 2);
});

test('closing drops every row; reopening reloads from the first page', async () => {
  const { store, calls } = makeStore(async (_l, _w, _e, cursor) =>
    cursor === null ? page(['a'], 'c1') : page(['b']));
  await store.open(ctx());
  await store.loadMore();
  assert.deepEqual(ids(store), ['a', 'b']);

  store.close();
  assert.equal(store.getSnapshot().context, null);
  assert.equal(ids(store).length, 0);
  assert.equal(store.getSnapshot().nextCursor, null);

  await store.open(ctx());
  same(calls.map((call) => call[3]), [null, 'c1', null]);
  assert.deepEqual(ids(store), ['a']);
});

test('an answer that arrives after closing changes nothing, even if the same panel is reopened', async () => {
  const slow = deferred();
  let n = 0;
  const { store } = makeStore(async () => {
    n += 1;
    if (n === 1) return slow.promise;
    return page(['fresh']);
  });
  const stale = store.open(ctx());
  store.close();
  assert.equal(store.getSnapshot().context, null);

  await store.open(ctx()); // reopened: a new request
  assert.deepEqual(ids(store), ['fresh']);

  slow.resolve(page(['stale']));
  await stale;
  await settle();
  assert.deepEqual(ids(store), ['fresh']);
  assert.equal(store.getSnapshot().loading, false);
});

test('a late failure after closing does not mark the reopened panel as failed', async () => {
  const slow = deferred();
  let n = 0;
  const { store } = makeStore(async () => {
    n += 1;
    if (n === 1) return slow.promise;
    return page(['fresh']);
  });
  const stale = store.open(ctx());
  store.close();
  await store.open(ctx());
  slow.reject(networkError());
  await stale;
  assert.equal(store.getSnapshot().error, null);
  assert.deepEqual(ids(store), ['fresh']);
});

for (const [label, other] of [
  ['exercise', { exerciseId: 'squat' }],
  ['workout', { workoutId: 'other-anchor' }],
  ['connection', { linkId: 'link2' }],
  ['account', { userId: 'coach2' }],
]) {
  test(`switching the ${label} while a page is loading never mixes results`, async () => {
    const slow = deferred();
    let n = 0;
    const { store, calls } = makeStore(async (link, workout, exercise) => {
      n += 1;
      return n === 1 ? slow.promise : page([`${link}-${workout}-${exercise}`]);
    });
    const first = store.open(ctx());
    await store.open(ctx(other));
    const expected = `${other.linkId ?? 'link1'}-${other.workoutId ?? 'anchor'}-${other.exerciseId ?? 'bench'}`;
    assert.deepEqual(ids(store), [expected]);

    slow.resolve(page(['old-context']));
    await first;
    assert.deepEqual(ids(store), [expected]);
    assert.equal(calls.length, 2);
    assert.equal(store.getSnapshot().context.userId, other.userId ?? 'coach1');
  });
}

test('a late next page from the previous context is not appended', async () => {
  const slow = deferred();
  const { store } = makeStore(async (_l, _w, exercise, cursor) => {
    if (exercise === 'bench' && cursor === 'c1') return slow.promise;
    return exercise === 'bench' ? page(['a'], 'c1') : page(['s1']);
  });
  await store.open(ctx());
  const more = store.loadMore();
  await store.open(ctx({ exerciseId: 'squat' }));
  slow.resolve(page(['late']));
  await more;
  assert.deepEqual(ids(store), ['s1']);
});

test('reset (sign-out, session expiry) clears everything and voids what is still in flight', async () => {
  const slow = deferred();
  const { store, refusals } = makeStore(async () => slow.promise);
  const opening = store.open(ctx());
  store.reset();
  assert.equal(store.getSnapshot().context, null);
  slow.resolve(page(['private']));
  await opening;
  assert.equal(store.getSnapshot().context, null);
  assert.equal(ids(store).length, 0);

  // Failing after reset does not report a refusal for an account that left.
  const late = deferred();
  const again = makeStore(async () => late.promise);
  const second = again.store.open(ctx());
  again.store.reset();
  late.reject(apiError(403));
  await second;
  assert.equal(again.refusals.forbidden.length, 0);
  assert.equal(refusals.forbidden.length, 0);
});

test('a 403 closes the panel, drops the rows and reports the refusal once', async () => {
  let refuse = false;
  const { store, refusals, calls } = makeStore(async (_l, _w, _e, cursor) => {
    if (refuse) throw apiError(403, 'This athlete is not sharing workouts with you.');
    return page(['private-a'], cursor === null ? 'c1' : null);
  });
  await store.open(ctx());
  refuse = true;
  await store.loadMore();

  const state = store.getSnapshot();
  assert.equal(state.context, null);
  assert.equal(state.items.length, 0);
  assert.equal(state.nextCursor, null);
  assert.equal(refusals.forbidden.length, 1);
  same(refusals.forbidden[0], ctx());

  await store.loadMore();
  await store.retry();
  assert.equal(calls.length, 2);
});

test('a 404 clears the rows, marks the history unavailable and asks the caller to find out why', async () => {
  let gone = false;
  const { store, refusals, calls } = makeStore(async (_l, _w, _e, cursor) => {
    if (gone) throw apiError(404, 'Connection not found.');
    return page(['a'], cursor === null ? 'c1' : null);
  });
  await store.open(ctx());
  gone = true;
  await store.loadMore();

  const state = store.getSnapshot();
  assert.equal(state.unavailable, true);
  assert.equal(state.items.length, 0);
  assert.equal(state.nextCursor, null);
  assert.equal(state.error, null);
  assert.equal(refusals.unavailable.length, 1);

  await store.loadMore();
  await store.retry();
  assert.equal(calls.length, 2);

  // Closing and opening again tries afresh.
  store.close();
  gone = false;
  await store.open(ctx());
  assert.equal(store.getSnapshot().unavailable, false);
  assert.deepEqual(ids(store), ['a']);
});

test('an unexpected reply is a failed page, not rows to draw', async () => {
  const replies = [
    { items: 'nope', next_cursor: null },
    { items: [{ title: 'no id', sets: [] }], next_cursor: null },
    { items: [], next_cursor: 5 },
    null,
  ];
  for (const reply of replies) {
    const { store } = makeStore(async () => reply);
    await store.open(ctx());
    assert.equal(store.getSnapshot().error, 'initial');
    assert.equal(ids(store).length, 0);
  }
  // On a later page the rows already loaded stay.
  const { store } = makeStore(async (_l, _w, _e, cursor) =>
    cursor === null ? page(['a'], 'c1') : { items: 'broken', next_cursor: null });
  await store.open(ctx());
  await store.loadMore();
  assert.equal(store.getSnapshot().error, 'more');
  assert.deepEqual(ids(store), ['a']);
});

test('subscribers hear about every change and can unsubscribe', async () => {
  const { store } = makeStore(async () => page(['a']));
  let heard = 0;
  const stop = store.subscribe(() => { heard += 1; });
  await store.open(ctx());
  assert.ok(heard >= 2);
  stop();
  const before = heard;
  store.close();
  assert.equal(heard, before);
});

// ── Wiring to the existing access-loss path ──────────────────────────────

function wiring({ historyApi, athletes = [{ id: 'link1', shares_workouts: true }] }) {
  const workoutsApi = {
    listWorkouts: async () => ({ items: [], total: 0, limit: 20, offset: 0 }),
    getWorkout: async () => ({ exercises: [] }),
  };
  const athleteWorkoutsStore = createAthleteWorkoutsStore(workoutsApi);
  const overview = createAthleteOverviewStore({
    getOverview: async () => ({
      items: [{
        id: 'link1', person: { username: 'a', first_name: null, last_name: null },
        connected_at: '2026-09-01T10:00:00Z', shares_workouts: true,
        activity: { latest_workout: null, workouts_in_window: 4, working_sets_in_window: 40 },
      }],
      total: 1, limit: 20, offset: 0,
      window: { start: '2026-09-17T11:55:00Z', end: '2026-10-15T11:55:00Z', days: 28 },
    }),
  });
  followDenials(athleteWorkoutsStore, overview);
  const coachingState = { userId: 'coach1', athletes: { loaded: true, error: null, items: athletes } };
  const coachingCalls = [];
  const coachingStore = {
    bind: () => {},
    load: async (role) => { coachingCalls.push(role); },
    getSnapshot: () => coachingState,
  };
  const session = load('src/coaching/athleteExerciseHistorySession.ts', {
    '../api/coaching': { getAthleteExerciseHistory: historyApi },
    './athleteExerciseHistory': { createAthleteExerciseHistoryStore },
    './athleteWorkoutsSession': { athleteWorkoutsStore },
    './coachingSession': { coachingStore },
    './openAthlete': { refreshAthleteView },
  });
  return {
    history: session.athleteExerciseHistoryStore, workouts: athleteWorkoutsStore, overview,
    coachingState, coachingCalls,
  };
}
const bound = { userId: 'coach1', linkId: 'link1' };

test('a 403 revokes the workout views and the roster card through the existing mechanism', async () => {
  const w = wiring({ historyApi: async () => { throw apiError(403); } });
  await w.overview.refresh?.();
  w.overview.bind('coach1');
  await w.overview.refresh();
  assert.equal(w.overview.getSnapshot().items[0].shares_workouts, true);
  w.workouts.bind(bound);

  await w.history.open(ctx());

  assert.equal(w.workouts.getSnapshot().denied, 'not_shared');
  assert.equal(w.history.getSnapshot().context, null);
  const card = w.overview.getSnapshot().items[0];
  assert.equal(card.shares_workouts, false);
  assert.equal(card.activity, null);
});

test('a 403 for a different view than the one on screen does not revoke it', async () => {
  const w = wiring({ historyApi: async () => { throw apiError(403); } });
  w.workouts.bind({ userId: 'coach1', linkId: 'someone-else' });
  await w.history.open(ctx());
  assert.equal(w.workouts.getSnapshot().denied, null);
});

test('a 404 refreshes the athlete view, which revokes as ended when the connection is gone', async () => {
  const w = wiring({ historyApi: async () => { throw apiError(404); }, athletes: [] });
  w.workouts.bind(bound);
  await w.history.open(ctx());
  await settle();
  assert.deepEqual(w.coachingCalls, ['coach']);
  assert.equal(w.workouts.getSnapshot().denied, 'ended');
  // Revoking took the panel with it.
  assert.equal(w.history.getSnapshot().context, null);
});

test('a 404 for a vanished workout alone leaves the connection and sharing as they were', async () => {
  const w = wiring({ historyApi: async () => { throw apiError(404); } });
  w.workouts.bind(bound);
  await w.history.open(ctx());
  await settle();
  assert.equal(w.workouts.getSnapshot().denied, null);
  assert.equal(w.history.getSnapshot().unavailable, true);
  assert.equal(w.history.getSnapshot().items.length, 0);
});

test('the panel closes when the workout views are reset, revoked, or pointed at another view', async () => {
  for (const act of [
    (w) => w.workouts.reset(),
    (w) => w.workouts.revoke('not_shared'),
    (w) => w.workouts.revoke('ended'),
    (w) => w.workouts.bind({ userId: 'coach1', linkId: 'link2' }),
    (w) => w.workouts.bind({ userId: 'coach2', linkId: 'link1' }),
  ]) {
    const w = wiring({ historyApi: async () => page(['a']) });
    w.workouts.bind(bound);
    await w.history.open(ctx());
    assert.deepEqual(ids(w.history), ['a']);
    act(w);
    assert.equal(w.history.getSnapshot().context, null);
    assert.equal(ids(w.history).length, 0);
  }
});

test('sign-out and session expiry both reset the history store', () => {
  // The reset list is written once (resetAccountState) and the controller runs
  // it on both ways out of an account.
  const source = read('src/auth/AuthContext.tsx');
  assert.match(source, /athleteExerciseHistoryStore\.reset\(\)/);
  assert.equal(source.match(/athleteExerciseHistoryStore\.reset\(\)/g).length, 1);
  const controller = read('src/auth/sessionController.ts');
  assert.equal(controller.match(/hooks\.resetAccountState\(\)/g).length, 2);
});

// ── Panel ───────────────────────────────────────────────────────────────

const react = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
};
const actions = { closed: 0, retried: 0, loadedMore: 0 };
const panelModule = load('src/coaching/AthleteExerciseHistoryPanel.tsx', {
  'react-native': {
    ActivityIndicator: 'ActivityIndicator', FlatList: 'FlatList', Modal: 'Modal',
    Pressable: 'Pressable', Text: 'Text', View: 'View',
    StyleSheet: { create: (v) => v, hairlineWidth: 1, absoluteFill: { position: 'absolute' } },
  },
  'react-native-safe-area-context': { SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView' },
  '../lightTheme': { light: {} },
  '../units/weight': units,
  './athleteExerciseHistorySession': {
    athleteExerciseHistoryStore: {
      close: () => { actions.closed += 1; },
      retry: () => { actions.retried += 1; },
      loadMore: () => { actions.loadedMore += 1; },
    },
  },
  './athleteWorkoutDisplay': display,
}, { React: react });
const { AthleteExerciseHistoryPanel } = panelModule;

function expand(tree) {
  if (tree === null || tree === undefined || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(expand);
  if (typeof tree.type === 'function') return expand(tree.type(tree.props));
  if (tree.type === 'FlatList') {
    const { data = [], renderItem, ListHeaderComponent, ListFooterComponent } = tree.props;
    return [
      tree,
      ...expand(ListHeaderComponent),
      ...data.flatMap((item) => expand(renderItem({ item }))),
      ...expand(ListFooterComponent),
    ];
  }
  return [tree, ...expand(tree.props?.children)];
}
const texts = (tree) => expand(tree).filter((n) => n.type === 'Text')
  .map((n) => [n.props.children].flat(5).filter((c) => typeof c === 'string' || typeof c === 'number').join(''));
const allText = (tree) => texts(tree).join('\n');
const pressables = (tree) => expand(tree).filter((n) => n.type === 'Pressable');
const byLabel = (tree, re) => pressables(tree).find((n) => re.test(n.props.accessibilityLabel ?? ''));
const byText = (tree, re) => pressables(tree).find((n) => expand(n.props.children).some(
  (c) => c.type === 'Text' && re.test([c.props.children].flat(5).join(''))));

const openState = (changes = {}) => ({
  context: ctx(), items: [], nextCursor: null, loaded: true, loading: false, error: null,
  unavailable: false, ...changes,
});
const draw = (state, props = {}) => AthleteExerciseHistoryPanel({
  state, exerciseName: 'Barbell Bench Press', athleteName: 'Ada Lovelace', unit: 'kg', ...props,
});

test('the panel is absent while closed and names the athlete and exercise while open', () => {
  assert.equal(draw({ ...openState(), context: null }), null);
  const tree = draw(openState());
  assert.equal(expand(tree)[0].type, 'Modal');
  assert.match(allText(tree), /Earlier sessions/);
  assert.match(allText(tree), /Barbell Bench Press/);
  assert.match(allText(tree), /Ada Lovelace/);
  assert.match(allText(tree), /Read-only/);
  assert.match(allText(tree), /warm-ups are not shown/);
});

test('rows show date, workout name, weight with a unit, reps and RIR; 0 kg and RIR 0 are real values', () => {
  const state = openState({
    items: [
      session('s1', {
        title: 'Push A',
        sets: [setOf(1, '0.00', 12, 0), setOf(2, '0.00', 10, null), setOf(3, '60.00', 5, 3)],
      }),
    ],
  });
  const kg = allText(draw(state));
  assert.match(kg, /Push A/);
  assert.match(kg, /0 kg/);
  assert.match(kg, /60 kg/);
  assert.match(kg, /RIR 0/);
  assert.match(kg, /RIR not logged/);
  assert.match(kg, /RIR 3/);
  assert.match(kg, /× 12/);
  assert.match(kg, /2026/);

  const lb = allText(draw(state, { unit: 'lb' }));
  assert.match(lb, /132\.3 lb/);
  assert.match(lb, /0 lb/);
  assert.doesNotMatch(lb, /60 kg/);
});

test('a set marked as a warm-up is distinguished, and set rows have spoken labels', () => {
  const tree = draw(openState({
    items: [session('s1', { sets: [setOf(1, '20.00', 10, null, { is_warmup: true }), setOf(2, '60.00', 5, 2)] })],
  }));
  assert.match(allText(tree), /\bW\b/);
  const labels = expand(tree).map((n) => n.props?.accessibilityLabel).filter(Boolean);
  assert.ok(labels.some((l) => /^Warm-up set, 20 kg, 10 reps, RIR not logged$/.test(l)));
  assert.ok(labels.some((l) => /^Set 2, 60 kg, 5 reps, RIR 2$/.test(l)));
});

test('separate sessions with the same name, date and sets are drawn as separate sessions', () => {
  const twin = (id) => session(id, { title: 'Push', sets: [setOf(1, '60.00', 5, 2)] });
  const tree = draw(openState({ items: [twin('x'), twin('y')] }));
  assert.equal(texts(tree).filter((t) => t === 'Push').length, 2);
  const list = expand(tree).find((n) => n.type === 'FlatList');
  assert.deepEqual(list.props.data.map(list.props.keyExtractor), ['x', 'y']);
});

test('loading, empty, end and load-more states', () => {
  const loading = draw(openState({ loaded: false, loading: true }));
  assert.ok(expand(loading).some((n) => n.type === 'ActivityIndicator'));
  assert.doesNotMatch(allText(loading), /No earlier completed session/);

  const empty = draw(openState());
  assert.match(allText(empty), /No earlier completed session of this exercise/);
  assert.doesNotMatch(allText(empty), /All earlier sessions loaded/);

  const more = draw(openState({ items: [session('a')], nextCursor: 'c1' }));
  assert.ok(byText(more, /Load older sessions/));
  byText(more, /Load older sessions/).props.onPress();
  assert.equal(actions.loadedMore, 1);

  const end = draw(openState({ items: [session('a')] }));
  assert.match(allText(end), /All earlier sessions loaded/);
  assert.equal(byText(end, /Load older sessions/), undefined);
});

test('a first-page error and a next-page error are worded apart, and the loaded rows stay', () => {
  const initial = draw(openState({ loaded: false, error: 'initial' }));
  assert.match(allText(initial), /Could not load earlier sessions\./);
  assert.equal(byText(initial, /Load older sessions/), undefined);
  const retry = byText(initial, /Try again/);
  assert.ok(retry);
  retry.props.onPress();
  assert.equal(actions.retried, 1);

  const later = draw(openState({ items: [session('kept', { title: 'Kept row' })], nextCursor: 'c1', error: 'more' }));
  assert.match(allText(later), /Could not load older sessions\. Loaded sessions are kept\./);
  assert.match(allText(later), /Kept row/);
  assert.equal(byText(later, /Load older sessions/), undefined);
  assert.ok(byText(later, /Try again/));
});

test('an unavailable history says so and offers no way to continue', () => {
  const tree = draw(openState({ loaded: false, unavailable: true }));
  assert.match(allText(tree), /This history is no longer available/);
  assert.equal(byText(tree, /Try again/), undefined);
  assert.equal(byText(tree, /Load older sessions/), undefined);
});

test('close button, backdrop and the Modal back request all use the same close path', () => {
  const tree = draw(openState());
  const before = actions.closed;
  const nodesOf = expand(tree);
  const close = byLabel(tree, /^Close earlier sessions$/);
  const backdrop = pressables(tree).find((n) => n.props.testID === 'coach-history-backdrop');
  const modal = nodesOf.find((n) => n.type === 'Modal');
  close.props.onPress();
  backdrop.props.onPress();
  modal.props.onRequestClose();
  assert.equal(actions.closed - before, 3);
  // The backdrop is a sibling of the panel, so touches inside the list never reach it.
  const panel = nodesOf.find((n) => n.type === 'SafeAreaView');
  assert.ok(!expand(panel.props.children).includes(backdrop));
  assert.equal(modal.props.statusBarTranslucent, true);
});

test('touch targets are at least 44 points', () => {
  const source = read('src/coaching/AthleteExerciseHistoryPanel.tsx');
  assert.match(source, /const MIN_TOUCH = 44/);
  assert.match(source, /closeButton: \{ minWidth: MIN_TOUCH, minHeight: MIN_TOUCH/);
  assert.match(source, /button: \{ minHeight: MIN_TOUCH/);
  assert.doesNotMatch(source, /allowFontScaling=\{false\}/);
});

// ── Screen (source scan; not a device test) ──────────────────────────────

test('the coach workout screen offers an accessible entry per exercise and closes the panel on leaving', () => {
  const screen = read('app/(app)/coaching/athlete/[linkId]/workout/[workoutId].tsx');
  assert.match(screen, /accessibilityLabel=\{`Earlier sessions of \$\{exercise\.name\}`\}/);
  assert.match(screen, /<Text style=\{styles\.secondaryText\}>Earlier sessions<\/Text>/);
  assert.match(screen, /athleteExerciseHistoryStore\.close\(\);\s*athleteWorkoutsStore\.closeDetail\(\)/);
  assert.match(screen, /exerciseId: exercise\.exercise_id/);
  assert.match(screen, /useAthleteExerciseHistory\(userId, linkId, workoutId\)/);
  assert.match(screen, /<AthleteExerciseHistoryPanel/);
});

test('the coach history reads only: the API module exposes a single GET for it', () => {
  const api = read('src/api/coaching.ts');
  const start = api.indexOf('export function getAthleteExerciseHistory');
  const body = api.slice(start, api.indexOf('\n}\n', start));
  assert.match(body, /\/coaching\/athletes\/\$\{linkId\}\/workouts\/\$\{workoutId\}\/exercises\/\$\{exerciseId\}\/history/);
  assert.doesNotMatch(body, /method:/);
  // The athlete's editable screen was not touched for this feature.
  assert.doesNotMatch(read('app/(app)/workout/[id].tsx'), /athleteExerciseHistory/);
});
