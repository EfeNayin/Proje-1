// Run with node --test tests/athlete-overview.test.cjs. Pure logic, no I/O.
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
    module: module_, exports: module_.exports, Error, Set, Math, Number, Date, Promise, Array,
    require: (name) => { if (!(name in modules)) throw new Error(`unexpected import ${name}`); return modules[name]; },
  });
  return module_.exports;
}

const { createAthleteOverviewStore, followDenials, initialOverviewState } = load('src/coaching/athleteOverview.ts');
const presentation = load('src/coaching/presentation.ts');
const { describeActivity, activityLabel } = load('src/coaching/activityDisplay.ts', {
  './presentation': presentation,
});

// Values built inside the vm context are not reference-equal to this realm's, so compare as JSON.
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const apiError = (status, message) => Object.assign(new Error(message), { status });
const networkError = () => apiError(0, 'Cannot connect right now. Check your connection and try again.');

const WINDOW = { start: '2026-09-17T11:55:00Z', end: '2026-10-15T11:55:00Z', days: 28 };
const sharing = (id, extra = {}) => ({
  id, person: { username: `u${id}`, first_name: null, last_name: null },
  connected_at: '2026-09-01T10:00:00Z', shares_workouts: true,
  activity: {
    latest_workout: { title: `Day ${id}`, performed_at: '2026-10-10T10:00:00Z' },
    workouts_in_window: 3, working_sets_in_window: 30,
  },
  ...extra,
});
const closed = (id) => sharing(id, { shares_workouts: false, activity: null });
const page = (items, total = items.length, offset = 0, window = WINDOW) => ({
  items, total, limit: 2, offset, window,
});

function fakeApi(impl) {
  const calls = [];
  return {
    api: { getOverview: (...args) => { calls.push(args); return impl(...args); } },
    calls,
  };
}

test('one request loads the roster page with every card, and sharing off stays unavailable', async () => {
  const { api, calls } = fakeApi(async () => page([sharing('a'), closed('b')], 2));
  const store = createAthleteOverviewStore(api, 2);
  store.bind('coach1');

  await store.refresh();

  const state = store.getSnapshot();
  assert.equal(calls.length, 1);
  same(calls[0], [2, 0]);
  assert.equal(state.loaded, true);
  assert.equal(state.items[1].shares_workouts, false);
  // Not shared is null, never an object of zeros.
  assert.equal(state.items[1].activity, null);
  same(state.window, WINDOW);
});

test('a sharing athlete with nothing recorded keeps their zeros and no latest workout', async () => {
  const empty = sharing('a', {
    activity: { latest_workout: null, workouts_in_window: 0, working_sets_in_window: 0 },
  });
  const { api } = fakeApi(async () => page([empty]));
  const store = createAthleteOverviewStore(api, 2);
  store.bind('coach1');

  await store.refresh();

  same(store.getSnapshot().items[0].activity, {
    latest_workout: null, workouts_in_window: 0, working_sets_in_window: 0,
  });
});

test('an empty roster is loaded, not an error', async () => {
  const { api } = fakeApi(async () => page([], 0));
  const store = createAthleteOverviewStore(api, 2);
  store.bind('coach1');

  await store.refresh();

  const state = store.getSnapshot();
  assert.equal(state.loaded, true);
  assert.equal(state.items.length, 0);
  assert.equal(state.error, null);
});

test('focus and pull-to-refresh at the same time share one request', async () => {
  const gate = deferred();
  const { api, calls } = fakeApi(() => gate.promise);
  const store = createAthleteOverviewStore(api, 2);
  store.bind('coach1');

  const first = store.refresh();
  const second = store.refresh();
  gate.resolve(page([sharing('a')]));
  await Promise.all([first, second]);

  assert.equal(calls.length, 1);
});

test('without a bound user nothing is requested', async () => {
  const { api, calls } = fakeApi(async () => page([]));
  const store = createAthleteOverviewStore(api, 2);

  await store.refresh();

  assert.equal(calls.length, 0);
});

test('later pages reuse the first page window, append and never duplicate', async () => {
  const pages = [
    page([sharing('a'), sharing('b')], 4),
    // The same instant written the other way round still counts as the same window.
    page([sharing('b'), sharing('c')], 4, 2, { ...WINDOW, end: '2026-10-15T11:55:00.000+00:00' }),
  ];
  const { api, calls } = fakeApi(async () => pages.shift());
  const store = createAthleteOverviewStore(api, 2);
  store.bind('coach1');
  await store.refresh();

  await store.loadMore();

  same(calls[1], [2, 2, WINDOW.end]);
  same(store.getSnapshot().items.map((item) => item.id), ['a', 'b', 'c']);
});

test('a page counted over a different window is discarded, not mixed in', async () => {
  const pages = [
    page([sharing('a'), sharing('b')], 4),
    page([sharing('c'), sharing('d')], 4, 2, { ...WINDOW, end: '2026-10-15T12:30:00Z' }),
  ];
  const { api } = fakeApi(async () => pages.shift());
  const store = createAthleteOverviewStore(api, 2);
  store.bind('coach1');
  await store.refresh();

  await store.loadMore();

  const state = store.getSnapshot();
  same(state.items.map((item) => item.id), ['a', 'b']);
  assert.match(state.moreError, /counting period changed/);
  same(state.window, WINDOW);
});

test('paging stops at the total, on an empty page, and while a refresh runs', async () => {
  const pages = [page([sharing('a'), sharing('b')], 3), page([], 3, 2)];
  const { api, calls } = fakeApi(async () => pages.shift());
  const store = createAthleteOverviewStore(api, 2);
  store.bind('coach1');
  await store.refresh();

  await store.loadMore(); // empty page although total says 3
  assert.equal(store.getSnapshot().total, 2);
  await store.loadMore(); // now complete: no request
  assert.equal(calls.length, 2);
});

test('a failed next page keeps the cards, offers a retry, and the retry succeeds', async () => {
  let fail = true;
  const { api, calls } = fakeApi(async (_limit, offset) => {
    if (offset === 0) return page([sharing('a'), sharing('b')], 3);
    if (fail) throw networkError();
    return page([sharing('c')], 3, 2);
  });
  const store = createAthleteOverviewStore(api, 2);
  store.bind('coach1');
  await store.refresh();

  await store.loadMore();
  assert.match(store.getSnapshot().moreError, /Cannot connect/);
  assert.equal(store.getSnapshot().items.length, 2);
  fail = false;
  await store.loadMore();

  const state = store.getSnapshot();
  assert.equal(state.moreError, null);
  assert.equal(state.items.length, 3);
  assert.equal(calls.length, 3);
});

test('a refresh that fails keeps the authorised data and says so; the retry clears the error', async () => {
  let fail = false;
  const { api } = fakeApi(async () => {
    if (fail) throw networkError();
    return page([sharing('a')]);
  });
  const store = createAthleteOverviewStore(api, 2);
  store.bind('coach1');
  await store.refresh();

  fail = true;
  await store.refresh();
  let state = store.getSnapshot();
  assert.match(state.error, /Cannot connect/);
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].activity.workouts_in_window, 3);
  assert.equal(state.loading, false);

  fail = false;
  await store.refresh();
  state = store.getSnapshot();
  assert.equal(state.error, null);
  assert.equal(state.loaded, true);
});

test('a first load that fails is an error with nothing shown, then retries', async () => {
  let fail = true;
  const { api } = fakeApi(async () => {
    if (fail) throw networkError();
    return page([sharing('a')]);
  });
  const store = createAthleteOverviewStore(api, 2);
  store.bind('coach1');

  await store.refresh();
  assert.equal(store.getSnapshot().loaded, false);
  assert.ok(store.getSnapshot().error);
  fail = false;
  await store.refresh();

  assert.equal(store.getSnapshot().items.length, 1);
});

test('an access refusal clears everything instead of keeping old numbers', async () => {
  let refuse = false;
  const { api } = fakeApi(async () => {
    if (refuse) throw apiError(403, 'Turn on coach tools first.');
    return page([sharing('a')]);
  });
  const store = createAthleteOverviewStore(api, 2);
  store.bind('coach1');
  await store.refresh();

  refuse = true;
  await store.refresh();

  const state = store.getSnapshot();
  assert.equal(state.denied, true);
  assert.equal(state.items.length, 0);
  assert.equal(state.window, null);
  assert.equal(state.loaded, false);
});

test('a malformed response is an error that keeps what was shown', async () => {
  let broken = false;
  const { api } = fakeApi(async () => (broken ? { items: 'nope' } : page([sharing('a')])));
  const store = createAthleteOverviewStore(api, 2);
  store.bind('coach1');
  await store.refresh();

  broken = true;
  await store.refresh();

  assert.equal(store.getSnapshot().items.length, 1);
  assert.ok(store.getSnapshot().error);
});

test('another account never sees the previous account data, and its late answer is ignored', async () => {
  const gate = deferred();
  const { api } = fakeApi(() => gate.promise);
  const store = createAthleteOverviewStore(api, 2);
  store.bind('coach1');
  const running = store.refresh();

  store.bind('coach2');
  gate.resolve(page([sharing('a')]));
  await running;

  const state = store.getSnapshot();
  assert.equal(state.userId, 'coach2');
  assert.equal(state.items.length, 0);
  assert.equal(state.loaded, false);
});

test('sign-out drops the cards and voids a request still in flight', async () => {
  let release;
  const first = fakeApi(async () => page([sharing('a')]));
  const store = createAthleteOverviewStore(first.api, 2);
  store.bind('coach1');
  await store.refresh();
  assert.equal(store.getSnapshot().items.length, 1);

  const gate = deferred();
  const late = fakeApi(() => gate.promise);
  const second = createAthleteOverviewStore(late.api, 2);
  second.bind('coach1');
  const running = second.refresh();
  second.reset();
  gate.resolve(page([sharing('b')]));
  await running;
  release = second.getSnapshot();

  store.reset();
  assert.equal(store.getSnapshot().userId, null);
  assert.equal(store.getSnapshot().items.length, 0);
  assert.equal(release.items.length, 0);
  assert.equal(release.userId, null);
});

test('a refresh makes a next-page request that started before it void', async () => {
  const gate = deferred();
  let calls = 0;
  const { api } = fakeApi(async (_limit, offset) => {
    calls += 1;
    if (offset === 0) return page([sharing('a'), sharing('b')], 4);
    return gate.promise;
  });
  const store = createAthleteOverviewStore(api, 2);
  store.bind('coach1');
  await store.refresh();
  const more = store.loadMore();

  await store.refresh();
  gate.resolve(page([sharing('c'), sharing('d')], 4, 2));
  await more;

  same(store.getSnapshot().items.map((item) => item.id), ['a', 'b']);
  assert.ok(calls >= 3);
});

test('turning sharing off drops that card numbers at once and keeps the card', async () => {
  const { api } = fakeApi(async () => page([sharing('a'), sharing('b')]));
  const store = createAthleteOverviewStore(api, 2);
  store.bind('coach1');
  await store.refresh();
  let notified = 0;
  store.subscribe(() => { notified += 1; });

  store.revokeLink('a');

  const [a, b] = store.getSnapshot().items;
  assert.equal(a.shares_workouts, false);
  assert.equal(a.activity, null);
  assert.equal(b.activity.workouts_in_window, 3);
  assert.equal(notified, 1);
  store.revokeLink('a'); // already closed: nothing to publish
  store.revokeLink('zzz');
  assert.equal(notified, 1);
});

test('an ended connection removes the card, and the total follows', async () => {
  const { api } = fakeApi(async () => page([sharing('a'), sharing('b')], 5));
  const store = createAthleteOverviewStore(api, 2);
  store.bind('coach1');
  await store.refresh();

  store.removeLink('a');
  store.removeLink('zzz');

  same(store.getSnapshot().items.map((item) => item.id), ['b']);
  assert.equal(store.getSnapshot().total, 4);
});

test('denials seen on the athlete workouts screen reach the roster once', () => {
  let snapshot = { scope: null, denied: null };
  const listeners = new Set();
  const source = {
    getSnapshot: () => snapshot,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
  const set = (next) => { snapshot = next; listeners.forEach((fn) => fn()); };
  const events = [];
  const stop = followDenials(source, {
    revokeLink: (id) => events.push(['revoke', id]),
    removeLink: (id) => events.push(['remove', id]),
  });

  set({ scope: { linkId: 'a' }, denied: null });
  set({ scope: { linkId: 'a' }, denied: 'not_shared' });
  set({ scope: { linkId: 'a' }, denied: 'not_shared' });
  set({ scope: { linkId: 'b' }, denied: 'ended' });
  stop();
  set({ scope: { linkId: 'c' }, denied: 'ended' });

  same(events, [['revoke', 'a'], ['remove', 'b']]);
});

test('the initial state belongs to nobody and shows nothing', () => {
  const state = initialOverviewState();
  assert.equal(state.userId, null);
  assert.equal(state.loaded, false);
  assert.equal(state.denied, false);
  assert.equal(state.items.length, 0);
});

// ── Words on the card ────────────────────────────────────────────────────

test('sharing off says it is off and shows no numbers', () => {
  const text = describeActivity(null, 28);
  same(text, { kind: 'off', text: 'Workout sharing is off' });
  assert.equal(activityLabel(text), 'Workout sharing is off');
});

test('sharing on with nothing recorded does not claim the athlete has not trained', () => {
  const text = describeActivity(
    { latest_workout: null, workouts_in_window: 0, working_sets_in_window: 0 }, 28,
  );
  same(text, { kind: 'none', text: 'No completed workouts recorded' });
  assert.doesNotMatch(JSON.stringify(text), /not train|inactive|missed/i);
});

test('recorded activity names the latest workout apart from the 28-day counts', () => {
  const text = describeActivity(
    {
      latest_workout: { title: 'Push', performed_at: '2026-10-03T10:00:00Z' },
      workouts_in_window: 3, working_sets_in_window: 31,
    }, 28,
  );
  assert.equal(text.kind, 'recorded');
  assert.match(text.latest, /^Latest: Push · .*2026/);
  assert.equal(text.period, 'Recorded in the last 28 days');
  assert.equal(text.counts, '3 workouts · 31 working sets');
  assert.match(activityLabel(text), /Latest: Push.*Recorded in the last 28 days: 3 workouts/);
});

test('a latest workout outside the window shows with zero counts, singulars and untitled sessions', () => {
  const old = describeActivity(
    {
      latest_workout: { title: null, performed_at: '2026-06-01T10:00:00Z' },
      workouts_in_window: 0, working_sets_in_window: 0,
    }, 28,
  );
  assert.match(old.latest, /^Latest: Untitled workout · /);
  assert.equal(old.counts, '0 workouts · 0 working sets');

  const one = describeActivity(
    {
      latest_workout: { title: '  ', performed_at: '2026-10-03T10:00:00Z' },
      workouts_in_window: 1, working_sets_in_window: 1,
    }, 1,
  );
  assert.equal(one.counts, '1 workout · 1 working set');
  assert.equal(one.period, 'Recorded in the last 1 day');
  assert.match(one.latest, /Untitled workout/);
});
