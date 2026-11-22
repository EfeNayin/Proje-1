/* global __dirname */
// The History tab: finished workouts, newest first, grouped by local day, paged beyond 20.
// The display rules (src/workout/historyDisplay.ts) are tested directly; the real History
// screen is then driven through paging, retries and opening a row. Paging itself
// (createWorkoutHistory) keeps its own tests in history.test.cjs and is only used here.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTs } = require('./support/load-ts.cjs');
const h = require('./support/screen-harness.cjs');

const display = loadTs('src/workout/historyDisplay.ts');
const { createWorkoutHistory } = loadTs('src/workout/workoutHistory.ts');
const { light } = loadTs('src/lightTheme.ts');

const MINUTE = 60 * 1000;
const NOW = new Date(2026, 10, 13, 9, 0, 0); // 13 Nov 2026, 09:00 local

/** A finished workout (finished 45 minutes after it started) unless `extra` says otherwise. */
function workout(id, startedAt, extra = {}) {
  return {
    id: String(id), title: `Workout ${id}`, performed_at: startedAt.toISOString(),
    total_volume_kg: '0', total_sets: 5, is_private: true, template_id: null,
    finished_at: new Date(startedAt.getTime() + 45 * MINUTE).toISOString(), finished_automatically: false,
    ...extra,
  };
}
/** `count` workouts, one per hour going back from `NOW`: index 0 is the newest, as the server sends them. */
const history = (count, extra = () => ({})) =>
  Array.from({ length: count }, (_, n) => workout(n, new Date(NOW.getTime() - (n + 1) * 60 * MINUTE), extra(n)));
// Arrays built inside the module's vm have another realm's prototype: read them into host arrays.
const ids = (rows) => Array.from(rows, (row) => row.id);
const flat = (sections) => Array.from(sections).flatMap((section) => Array.from(section.data));

/** A server that pages: records every (limit, offset) it was asked for. */
function server(rows) {
  const requests = [];
  return {
    requests,
    fetchPage: async (limit, offset) => {
      requests.push([limit, offset]);
      return { items: rows.slice(offset, offset + limit), total: rows.length, limit, offset };
    },
  };
}

// ----------------------------------------------------------------- what is shown

test('only finished sessions are history, newest first; the one in progress is left to Resume workout', () => {
  const rows = history(6, (n) => (n === 0 ? { finished_at: null, finished_automatically: null } : {}));
  const shown = display.completedWorkouts(rows);
  assert.deepEqual(ids(shown), ['1', '2', '3', '4', '5']);
  assert.equal(display.isCompleted(rows[0]), false);
  assert.equal(display.isCompleted(rows[1]), true);
});

test('newest first is guaranteed even if rows arrive out of order, and equal start times keep the server order', () => {
  const t = (hours) => new Date(NOW.getTime() - hours * 60 * MINUTE);
  const rows = [workout('old', t(5)), workout('new', t(1)), workout('tieA', t(3)), workout('tieB', t(3)), workout('mid', t(2))];
  assert.deepEqual(ids(display.completedWorkouts(rows)), ['new', 'mid', 'tieA', 'tieB', 'old']);
});

test('empty finished sessions and automatically closed ones are kept, with honest wording', () => {
  const rows = [
    workout('empty', new Date(NOW.getTime() - 60 * MINUTE), { total_sets: 0 }),
    workout('auto', new Date(NOW.getTime() - 120 * MINUTE), { finished_automatically: true }),
    workout('legacy', new Date(NOW.getTime() - 180 * MINUTE), { finished_automatically: null }),
    workout('long', new Date(NOW.getTime() - 400 * MINUTE),
      { finished_at: new Date(NOW.getTime() - 400 * MINUTE + 65 * MINUTE).toISOString() }),
  ];
  const shown = display.completedWorkouts(rows);
  assert.deepEqual(ids(shown), ['empty', 'auto', 'legacy', 'long']);
  const meta = Object.fromEntries(shown.map((row) => [row.id, display.cardMetaFor(row).text]));
  assert.equal(meta.empty, '45m'); // an empty session is still a session with a duration
  assert.equal(meta.auto, 'Auto-closed · duration unknown');
  assert.equal(meta.legacy, 'Duration unavailable');
  assert.equal(meta.long, '1h 5m');
  assert.equal(display.cardMetaFor(shown[1]).icon, 'information-circle-outline');
  assert.equal(display.cardMetaFor(shown[0]).icon, 'timer-outline');
});

test('sessions are grouped by the LOCAL calendar day, with Today and Yesterday named', () => {
  const rows = [
    workout('a', new Date(2026, 10, 13, 0, 30)), // 30 minutes past local midnight: today, whatever the UTC date is
    workout('b', new Date(2026, 10, 12, 23, 50)), // ten minutes before: yesterday
    workout('c', new Date(2026, 10, 12, 7, 0)),
    workout('d', new Date(2026, 10, 10, 18, 0)),
  ];
  const sections = display.groupByDay(rows, NOW);
  assert.deepEqual(Array.from(sections, (section) => section.title), [
    'Today', 'Yesterday',
    new Date(2026, 10, 10, 18, 0).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
  ]);
  assert.deepEqual(Array.from(sections, (section) => ids(section.data)), [['a'], ['b', 'c'], ['d']]);
});

test('hiding a row never changes where the next page starts', async () => {
  // 47 rows, newest (in progress) first: the first page holds 19 visible rows and one hidden one.
  const rows = history(47, (n) => (n === 0 ? { finished_at: null, finished_automatically: null } : {}));
  const { requests, fetchPage } = server(rows);
  const store = createWorkoutHistory(fetchPage);
  await store.refresh();
  assert.equal(display.completedWorkouts(store.getSnapshot().items).length, 19);
  await store.loadMore();
  await store.loadMore();
  assert.deepEqual(requests, [[20, 0], [20, 20], [20, 40]]); // 20 and 40, not 19 and 38
  assert.equal(store.getSnapshot().items.length, 47); // the store keeps every row the server sent
  const visible = display.historySections(store.getSnapshot().items, NOW);
  assert.equal(flat(visible).length, 46);
  assert.equal(flat(visible).some((row) => row.id === '0'), false);
  assert.equal(new Set(ids(flat(visible))).size, 46);
  assert.equal(store.getSnapshot().hasMore, false);
});

test('a whole page of hidden rows is not the end of the history', async () => {
  const rows = history(45, (n) => (n < 20 ? { finished_at: null, finished_automatically: null } : {}));
  const store = createWorkoutHistory(server(rows).fetchPage);
  await store.refresh();
  assert.equal(display.historySections(store.getSnapshot().items, NOW).length, 0);
  assert.equal(store.getSnapshot().hasMore, true); // so the screen does not say "No completed workouts yet"
  await store.loadMore();
  assert.equal(flat(display.historySections(store.getSnapshot().items, NOW)).length, 20);
});

// ------------------------------------------------------------ the real screen

function historyScreen(rows, { failing = () => false } = {}) {
  const hooks = h.createHooks();
  const pushes = [];
  const requests = [];
  const listWorkouts = async (limit, offset) => {
    requests.push([limit, offset]);
    if (failing(offset)) throw new Error('offline');
    return { items: rows.slice(offset, offset + limit), total: rows.length, limit, offset };
  };
  const screen = h.loadFile('app/(app)/(tabs)/history.tsx', {
    globals: { React: { createElement: h.createElement } },
    modules: {
      '@expo/vector-icons': { Ionicons: 'Ionicons' },
      'expo-router': { useFocusEffect: hooks.hooks.useFocusEffect, useRouter: () => ({ push: (href) => pushes.push(href) }) },
      react: hooks.hooks,
      'react-native': h.reactNative(),
      '../../../src/api/workouts': { listWorkouts },
      '../../../src/lightTheme': { light },
      '../../../src/navigation/TabTopBar': { TabTopBar: 'TabTopBar' },
      '../../../src/workout/historyDisplay': display,
      '../../../src/workout/workoutHistory': { createWorkoutHistory },
    },
  }).default;
  return {
    hooks, pushes, requests,
    render: () => hooks.render(screen),
    list: (tree) => h.nodes(tree).find((node) => node.type === 'SectionList'),
    // Mount (the first render registers the focus effect), gain focus, let the answers land, render again.
    async show() { this.render(); hooks.focus(); await h.settle(); return this.render(); },
  };
}

test('History screen: 47 records load in three pages as the list is scrolled, newest first, none repeated', async () => {
  const rows = history(47, (n) => (n === 0 ? { finished_at: null, finished_automatically: null } : {}));
  const screen = historyScreen(rows);
  assert.ok(h.byLabel(screen.render(), 'Loading workouts'), 'a spinner while the first page loads');

  let tree = await screen.show();
  let list = screen.list(tree);
  assert.equal(flat(list.props.sections).length, 19); // 20 rows, the one in progress not shown
  assert.equal(h.byLabel(list.props.ListFooterComponent, 'Load older workouts') !== undefined, true);

  list.props.onEndReached(); await h.settle(); tree = screen.render();
  list = screen.list(tree);
  assert.equal(flat(list.props.sections).length, 39);
  list.props.onEndReached(); await h.settle(); tree = screen.render();
  list = screen.list(tree);

  assert.deepEqual(screen.requests, [[20, 0], [20, 20], [20, 40]]);
  const shown = flat(list.props.sections);
  assert.equal(shown.length, 46);
  assert.deepEqual(ids(shown), ids(history(47).slice(1)));
  assert.equal(h.texts(list.props.ListFooterComponent).includes('All workouts loaded'), true);
  assert.equal(h.byLabel(list.props.ListFooterComponent, 'Load older workouts'), undefined);
});

test('History screen: the Load older workouts button pages too, and a failed page keeps the list and retries in place', async () => {
  const rows = history(45);
  let broken = true;
  const screen = historyScreen(rows, { failing: (offset) => offset === 20 && broken });
  let tree = await screen.show();
  const list = () => screen.list(screen.render());

  h.byLabel(list().props.ListFooterComponent, 'Load older workouts').props.onPress();
  await h.settle(); tree = screen.render();
  assert.equal(flat(list().props.sections).length, 20); // what was there stays
  assert.ok(h.texts(list().props.ListFooterComponent).includes('Could not load older workouts.'));

  broken = false;
  h.byLabel(list().props.ListFooterComponent, 'Try loading older workouts again').props.onPress();
  await h.settle();
  assert.equal(flat(list().props.sections).length, 40);
  assert.deepEqual(screen.requests, [[20, 0], [20, 20], [20, 20]]); // the same offset, not skipped
  assert.ok(tree);
});

test('History screen: a failed first load offers a retry instead of looking like an empty history', async () => {
  const screen = historyScreen(history(3), { failing: () => true });
  const tree = await screen.show();
  const list = screen.list(tree);
  assert.ok(h.texts(list.props.ListHeaderComponent).includes('Could not refresh your history.'));
  assert.equal(list.props.ListEmptyComponent, null, 'no "No completed workouts yet" while the load failed');
  assert.ok(h.byLabel(list.props.ListHeaderComponent, 'Try refreshing history again'));
});

test('History screen: with nothing finished it says so, and opening a row uses the existing workout screen once', async () => {
  const empty = historyScreen([]);
  const emptyList = empty.list(await empty.show());
  assert.ok(h.texts(emptyList.props.ListEmptyComponent).includes('No completed workouts yet'));

  const screen = historyScreen(history(2));
  const list = screen.list(await screen.show());
  const section = list.props.sections[0];
  const row = h.expand(list.props.renderItem({ item: section.data[0], index: 0, section }));
  assert.equal(row.props.accessibilityLabel, 'Workout 0, 45m, 5 sets');
  row.props.onPress();
  row.props.onPress(); // a double tap must not stack two copies of the workout screen
  assert.deepEqual(screen.pushes, ['/workout/0']);
});

test('History screen: refreshing on focus drops what is no longer valid, and leaving cancels what is still on its way', async () => {
  const late = h.deferred();
  let calls = 0;
  const hooks = h.createHooks();
  const screen = h.loadFile('app/(app)/(tabs)/history.tsx', {
    globals: { React: { createElement: h.createElement } },
    modules: {
      '@expo/vector-icons': { Ionicons: 'Ionicons' },
      'expo-router': { useFocusEffect: hooks.hooks.useFocusEffect, useRouter: () => ({ push() {} }) },
      react: hooks.hooks, 'react-native': h.reactNative(),
      '../../../src/api/workouts': { listWorkouts: () => (++calls === 1 ? late.promise : Promise.resolve({ items: history(1), total: 1, limit: 20, offset: 0 })) },
      '../../../src/lightTheme': { light }, '../../../src/navigation/TabTopBar': { TabTopBar: 'TabTopBar' },
      '../../../src/workout/historyDisplay': display, '../../../src/workout/workoutHistory': { createWorkoutHistory },
    },
  }).default;
  hooks.render(screen);
  hooks.focus(); // first visit starts a request that is slow
  hooks.blur(); // the tab is left before it answers
  late.resolve({ items: history(20), total: 20, limit: 20, offset: 0 });
  await h.settle();
  hooks.focus(); // back again: a fresh request, the late answer must not have been applied
  await h.settle();
  const list = h.nodes(hooks.render(screen)).find((node) => node.type === 'SectionList');
  assert.equal(flat(list.props.sections).length, 1);
});

// ------------------------------------------------------------------- the wiring

test('the old Training list is gone from Start Workout and History reads the same stored workouts', () => {
  const start = h.read('app/(app)/(tabs)/index.tsx');
  assert.doesNotMatch(start, /createWorkoutHistory|Recent workouts|SectionList/);
  const tab = h.read('app/(app)/(tabs)/history.tsx');
  assert.match(tab, /createWorkoutHistory\(workoutsApi\.listWorkouts\)/);
  assert.match(tab, /historySections\(items\)/);
  assert.match(tab, /router\.push\(`\/workout\/\$\{id\}`\)/);
  // The filter belongs to display, after paging: the store is not told what to hide.
  assert.doesNotMatch(h.read('src/workout/workoutHistory.ts'), /finished_at/);
});
