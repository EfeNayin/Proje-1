/* global __dirname */
// The Exercises tab: browsing the real catalogue and its details, independent of the workout
// picker. The paging store, the API's offset, the detail wording and both real screens are
// tested; choosing an exercise for a workout stays in the picker and is checked not to leak here.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTs } = require('./support/load-ts.cjs');
const h = require('./support/screen-harness.cjs');

const { createExerciseBrowser, browserView, BROWSER_PAGE_SIZE } = loadTs('src/exercises/exerciseBrowser.ts');
const { describeExercise } = loadTs('src/exercises/exerciseDetail.ts');
const { CATEGORIES } = loadTs('src/exercises/categories.ts');
const { light } = loadTs('src/lightTheme.ts');

/** A catalogue of `count` exercises; every 5th is a chest exercise. Pages like the real endpoint (limit <= 100). */
function catalogue(count) {
  const all = Array.from({ length: count }, (_, n) => ({
    id: `e${n}`, name: `Exercise ${n}`, name_tr: null, equipment: n % 2 ? 'barbell' : 'dumbbell', is_compound: n % 3 === 0,
    category: n % 5 === 0 ? 'chest' : 'legs',
  }));
  const requests = [];
  const fetchPage = async (query, category, limit, offset) => {
    requests.push({ query, category, limit, offset });
    const matches = all.filter((row) => (!category || row.category === category) && row.name.toLowerCase().includes(query.toLowerCase()));
    return { items: matches.slice(offset, offset + limit).map(({ category: _ignored, ...row }) => row), total: matches.length, limit, offset };
  };
  return { all, requests, fetchPage };
}
const ids = (rows) => Array.from(rows, (row) => row.id);

// ------------------------------------------------------------------ the paging store

test('every matching exercise is reachable: 130 entries come in pages of 50 and none are dropped', async () => {
  const { all, requests, fetchPage } = catalogue(130);
  const browser = createExerciseBrowser(fetchPage);
  assert.equal(browserView(browser.getSnapshot()), 'loading');
  await browser.search('', null);
  assert.equal(browser.getSnapshot().items.length, 50);
  assert.equal(browser.getSnapshot().total, 130);
  assert.equal(browser.getSnapshot().hasMore, true);
  await browser.loadMore();
  await browser.loadMore();
  await browser.loadMore(); // nothing left: no request
  assert.deepEqual(requests.map((request) => request.offset), [0, 50, 100]);
  assert.equal(BROWSER_PAGE_SIZE, 50);
  assert.deepEqual(ids(browser.getSnapshot().items), ids(all));
  assert.equal(browser.getSnapshot().hasMore, false);
  assert.equal(browserView(browser.getSnapshot()), 'results');
});

test('the query and the category go to the server, and a new search starts again from the first page', async () => {
  const { requests, fetchPage } = catalogue(130);
  const browser = createExerciseBrowser(fetchPage);
  await browser.search('', null);
  await browser.loadMore();
  await browser.search('exercise 1', 'chest');
  assert.deepEqual(requests.at(-1), { query: 'exercise 1', category: 'chest', limit: 50, offset: 0 });
  const names = Array.from(browser.getSnapshot().items, (row) => row.name);
  assert.ok(names.length > 0 && names.every((name) => name.startsWith('Exercise 1')));
  assert.equal(browser.getSnapshot().total, names.length);
  await browser.loadMore(); // everything fit on one page
  assert.equal(requests.length, 3);
});

test('repeated scroll events share one page request', async () => {
  const slow = h.deferred();
  let page = 0;
  const { fetchPage } = catalogue(130);
  const browser = createExerciseBrowser(async (...args) => (++page === 2 ? slow.promise : fetchPage(...args)));
  await browser.search('', null);
  const first = browser.loadMore();
  await browser.loadMore();
  await browser.loadMore();
  assert.equal(page, 2);
  slow.resolve(await fetchPage('', null, 50, 50));
  await first;
  assert.equal(browser.getSnapshot().items.length, 100);
});

test('a late answer for an older search is never shown for the newer one', async () => {
  const slow = h.deferred();
  const { fetchPage } = catalogue(130);
  let calls = 0;
  const browser = createExerciseBrowser((query, ...rest) => (++calls === 1 ? slow.promise : fetchPage(query, ...rest)));
  const old = browser.search('', null);
  await browser.search('exercise 7', null);
  slow.resolve({ items: [{ id: 'stale', name: 'Stale', name_tr: null, equipment: null, is_compound: false }], total: 1, limit: 50, offset: 0 });
  await old;
  assert.equal(browser.getSnapshot().items.some((row) => row.id === 'stale'), false);
  assert.equal(browser.getSnapshot().query, 'exercise 7');

  // The same for a next-page answer that lands after the search changed.
  const next = h.deferred();
  const second = catalogue(130);
  let page = 0;
  const paged = createExerciseBrowser((...args) => (++page === 2 ? next.promise : second.fetchPage(...args)));
  await paged.search('', null);
  const more = paged.loadMore();
  await paged.search('exercise 1', 'chest');
  next.resolve(await second.fetchPage('', null, 50, 50));
  await more;
  assert.equal(paged.getSnapshot().items.every((row) => /^Exercise 1/.test(row.name)), true);
});

test('loading, nothing found and a failed request are three different states', async () => {
  const { fetchPage } = catalogue(10);
  const browser = createExerciseBrowser(fetchPage);
  assert.equal(browserView(browser.getSnapshot()), 'loading');
  await browser.search('zzz-no-such-exercise', null);
  assert.equal(browserView(browser.getSnapshot()), 'empty');
  assert.equal(browser.getSnapshot().error, null);

  let offline = true;
  const flaky = createExerciseBrowser(async (...args) => { if (offline) throw new Error('offline'); return fetchPage(...args); });
  await flaky.search('', null);
  assert.equal(browserView(flaky.getSnapshot()), 'error');
  offline = false;
  await flaky.search('', null);
  assert.equal(browserView(flaky.getSnapshot()), 'results');
  assert.equal(flaky.getSnapshot().error, null);
});

test('a failed search clears the old rows (they answer a different question); a failed next page keeps them and retries in place', async () => {
  const { fetchPage } = catalogue(130);
  let failAt = null;
  const requested = [];
  const browser = createExerciseBrowser(async (query, category, limit, offset) => {
    requested.push(offset);
    if (failAt === offset) throw new Error('offline');
    return fetchPage(query, category, limit, offset);
  });
  await browser.search('', null);
  failAt = 50;
  await browser.loadMore();
  assert.equal(browser.getSnapshot().items.length, 50);
  assert.equal(browser.getSnapshot().error, 'more');
  assert.equal(browserView(browser.getSnapshot()), 'results'); // the rows stay, the retry sits under them
  await browser.loadMore(); // a scroll event alone does not hammer a failing server
  assert.deepEqual(requested, [0, 50]);
  failAt = null;
  await browser.loadMore(true);
  assert.deepEqual(requested, [0, 50, 50]); // the same offset, not skipped
  assert.equal(browser.getSnapshot().items.length, 100);

  failAt = 0;
  await browser.search('exercise 2', null);
  assert.equal(browser.getSnapshot().items.length, 0);
  assert.equal(browserView(browser.getSnapshot()), 'error');
});

test('the next page starts where the server stopped even when the catalogue shifted and a row repeats', async () => {
  const { all } = catalogue(120);
  const offsets = [];
  const browser = createExerciseBrowser(async (_q, _c, limit, offset) => {
    offsets.push(offset);
    const items = (offset === 50 ? all.slice(49, 99) : all.slice(offset, offset + limit)).map(({ category: _x, ...row }) => row);
    return { items, total: 120, limit, offset };
  });
  await browser.search('', null);
  await browser.loadMore();
  assert.equal(browser.getSnapshot().items.length, 99); // one repeated row is suppressed
  await browser.loadMore();
  assert.deepEqual(offsets, [0, 50, 100]); // advanced by the 50 rows received, not the 49 new ones
  assert.equal(new Set(ids(browser.getSnapshot().items)).size, browser.getSnapshot().items.length);
});

// ------------------------------------------------------------------ the search API

test('the search API sends offset only when there is one, so the workout picker\'s request is unchanged', async () => {
  const urls = [];
  const api = h.loadFile('src/api/exercises.ts', {
    globals: { URLSearchParams },
    modules: { './client': { apiRequest: async (url) => { urls.push(url); return {}; } } },
  });
  await api.searchExercises('');
  await api.searchExercises(' bench ', 'chest');
  await api.searchExercises('bench', 'chest', 50, 100);
  assert.deepEqual(urls, ['/exercises?limit=50', '/exercises?limit=50&q=bench&category=chest', '/exercises?limit=50&offset=100&q=bench&category=chest']);
});

test('the category list is one shared definition that matches the API\'s Category type', () => {
  const declared = /export type Category = ([^;]+);/.exec(h.read('src/api/exercises.ts'))[1].match(/"(\w+)"/g).map((value) => value.replace(/"/g, ''));
  assert.deepEqual(Array.from(CATEGORIES, (category) => category.code), declared);
  assert.deepEqual(Array.from(CATEGORIES, (category) => category.label), ['Chest', 'Back', 'Biceps', 'Triceps', 'Legs', 'Abs', 'Shoulders']);
  for (const file of ['app/(app)/workout/exercise-picker.tsx', 'app/(app)/(tabs)/exercises.tsx']) {
    assert.match(h.read(file), /import \{ CategoryChips \} from "..\/..\/..\/src\/exercises\/CategoryChips"/, file);
    assert.doesNotMatch(h.read(file), /code: "chest"/, `${file} must not keep its own copy of the categories`);
  }
});

// -------------------------------------------------------------------- the detail view

const detail = {
  id: 'e1', name: 'Incline Dumbbell Press', name_tr: null, equipment: 'dumbbell', is_compound: true,
  muscles: [
    { name: 'front_delts', name_tr: 'Ön omuz', role: 'secondary', effectiveness: 3 },
    { name: 'chest', name_tr: 'Göğüs', role: 'primary', effectiveness: 5 },
    { name: 'triceps', name_tr: 'Triseps', role: 'secondary', effectiveness: 4 },
    { name: 'upper_chest', name_tr: 'Üst göğüs', role: 'primary', effectiveness: 5 },
  ],
};

test('the detail view separates primary from secondary muscles and words effectiveness as a rating', () => {
  const view = describeExercise(detail);
  assert.equal(view.title, 'Incline Dumbbell Press');
  assert.equal(view.summary, 'Dumbbell · Compound');
  assert.deepEqual(Array.from(view.primary, (muscle) => muscle.name), ['Chest', 'Upper Chest']);
  assert.deepEqual(Array.from(view.secondary, (muscle) => muscle.name), ['Triceps', 'Front Delts']); // best fit first
  assert.equal(view.secondary[1].effectivenessLabel, 'Effectiveness 3 of 5');
  assert.equal(view.secondary[1].accessibilityLabel, 'Front Delts, Effectiveness 3 of 5');
  assert.doesNotMatch(JSON.stringify(view), /%|percent|contribution/i);
  assert.equal(describeExercise({ ...detail, equipment: null, is_compound: false, muscles: [] }).summary, 'Isolation');
});

// ------------------------------------------------------------------ the real screens

function timersWorld() {
  const timers = [];
  return {
    timers,
    setTimeout: (fn, delay) => { timers.push({ fn, delay, cleared: false }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; },
    fire() { timers.filter((timer) => !timer.cleared).forEach((timer) => { timer.cleared = true; timer.fn(); }); },
  };
}

function exercisesWorld({ total = 130, fail = false } = {}) {
  const hooks = h.createHooks();
  const clock = timersWorld();
  const pushes = [];
  const { requests, fetchPage } = catalogue(total);
  let failing = fail;
  const screen = h.loadFile('app/(app)/(tabs)/exercises.tsx', {
    globals: { React: { createElement: h.createElement }, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
    modules: {
      'expo-router': { useFocusEffect: hooks.hooks.useFocusEffect, useRouter: () => ({ push: (href) => pushes.push(h.plain(href)) }) },
      react: hooks.hooks,
      'react-native': h.reactNative(),
      '../../../src/api/exercises': { searchExercises: async (...args) => { if (failing) throw new Error('offline'); return fetchPage(...args); } },
      '../../../src/exercises/CategoryChips': { CategoryChips: 'CategoryChips' },
      '../../../src/exercises/exerciseBrowser': { browserView, createExerciseBrowser },
      '../../../src/lightTheme': { light },
      '../../../src/navigation/TabTopBar': { TabTopBar: 'TabTopBar' },
      // No usePickedExercise and no picker module: importing either would throw "Unexpected dependency".
    },
  }).default;
  const world = {
    hooks, clock, pushes, requests, setFailing: (value) => { failing = value; },
    render: () => hooks.render(screen),
    list: (tree) => h.nodes(tree).find((node) => node.type === 'FlatList'),
    search: (tree) => h.byLabel(tree, 'Search exercises'),
    chips: (tree) => h.nodes(tree).find((node) => node.type === 'CategoryChips'),
    async open() { world.render(); hooks.focus(); clock.fire(); await h.settle(); return world.render(); },
  };
  return world;
}

test('Exercises tab: the first search does not wait, typing is debounced to one request, and a category narrows it', async () => {
  const world = exercisesWorld();
  assert.ok(h.byLabel(world.render(), 'Loading exercises'), 'a spinner until the first page lands');
  let tree = await world.open();
  assert.deepEqual(world.requests.map((request) => request.query), ['']);
  assert.equal(world.list(tree).props.data.length, 50);
  assert.ok(h.texts(world.list(tree).props.ListHeaderComponent).includes('130 exercises'));

  for (const text of ['e', 'ex', 'exe']) { world.search(world.render()).props.onChangeText(text); world.render(); }
  assert.deepEqual(world.requests.map((request) => request.query), [''], 'nothing is sent while the user is still typing');
  assert.equal(world.clock.timers.filter((timer) => !timer.cleared).at(-1).delay, 250);
  world.clock.fire(); await h.settle();
  assert.deepEqual(world.requests.map((request) => request.query), ['', 'exe']);

  world.chips(world.render()).props.onChange('chest');
  world.render(); world.clock.fire(); await h.settle();
  assert.deepEqual(world.requests.at(-1), { query: 'exe', category: 'chest', limit: 50, offset: 0 });
  tree = world.render();
  assert.ok(world.list(tree).props.data.length <= 50);
});

test('Exercises tab: scrolling reaches every entry, and the footer offers the button as well', async () => {
  const world = exercisesWorld();
  let tree = await world.open();
  assert.ok(h.byLabel(world.list(tree).props.ListFooterComponent, 'Load more exercises'));
  world.list(tree).props.onEndReached(); await h.settle(); tree = world.render();
  h.byLabel(world.list(tree).props.ListFooterComponent, 'Load more exercises').props.onPress(); await h.settle();
  tree = world.render();
  assert.equal(world.list(tree).props.data.length, 130);
  assert.deepEqual(world.requests.map((request) => request.offset), [0, 50, 100]);
  assert.equal(h.byLabel(world.list(tree).props.ListFooterComponent, 'Load more exercises'), undefined);
});

test('Exercises tab: an empty result and a failed request look different, and the failure can be retried', async () => {
  const empty = exercisesWorld();
  await empty.open();
  empty.search(empty.render()).props.onChangeText('zzz-nothing');
  empty.render(); empty.clock.fire(); await h.settle();
  const emptyTexts = h.texts(empty.render());
  assert.ok(emptyTexts.includes('No exercises found'));
  assert.ok(emptyTexts.includes('Try a different word or category.'));
  assert.equal(emptyTexts.includes('Could not load exercises.'), false);

  const broken = exercisesWorld({ fail: true });
  const tree = await broken.open();
  assert.ok(h.texts(tree).includes('Could not load exercises.'));
  assert.equal(h.texts(tree).includes('No exercises found'), false);
  broken.setFailing(false);
  h.byLabel(tree, 'Try loading exercises again').props.onPress();
  await h.settle();
  assert.equal(broken.list(broken.render()).props.data.length, 50);
});

test('Exercises tab: a row opens the detail screen and nothing else; choosing an exercise is not possible from here', async () => {
  const world = exercisesWorld();
  const tree = await world.open();
  const list = world.list(tree);
  const row = h.expand(list.props.renderItem({ item: list.props.data[2], index: 2 }));
  assert.equal(row.props.accessibilityHint, 'Opens the exercise details');
  row.props.onPress();
  row.props.onPress(); // double tap
  assert.deepEqual(world.pushes, [{ pathname: '/exercise/[id]', params: { id: 'e2' } }]);

  // The browser and the detail screen are not wired to the picker's mailbox at all. (Code only:
  // their doc comments name it to say exactly that.)
  const code = (file) => h.read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const file of ['app/(app)/(tabs)/exercises.tsx', 'app/(app)/exercise/[id].tsx', 'src/exercises/exerciseBrowser.ts']) {
    assert.doesNotMatch(code(file), /usePickedExercise|depositPickedExercise|takePickedExercise|exercise-picker/, file);
  }
  // ...while the picker still is, and still deposits only when the user picks a row.
  const picker = h.read('app/(app)/workout/exercise-picker.tsx');
  assert.match(picker, /depositPickedExercise\(\{ id: exercise\.id, name: exercise\.name \}\);\s*router\.back\(\);/);
});

function detailWorld({ fail = false } = {}) {
  const hooks = h.createHooks();
  let failing = fail;
  const requested = [];
  const screen = h.loadFile('app/(app)/exercise/[id].tsx', {
    globals: { React: { createElement: h.createElement } },
    modules: {
      'expo-router': { Stack: { Screen: 'Screen' }, useLocalSearchParams: () => ({ id: 'e1' }) },
      react: hooks.hooks,
      'react-native': h.reactNative(),
      '../../../src/api/exercises': { getExercise: async (id) => { requested.push(id); if (failing) throw new Error('offline'); return detail; } },
      '../../../src/exercises/exerciseDetail': { describeExercise },
      '../../../src/lightTheme': { light },
    },
  }).default;
  // Function components (the muscle sections) are expanded in place so their text can be read.
  const render = () => h.expand(hooks.render(screen));
  return { render, requested, setFailing: (value) => { failing = value; } };
}

test('exercise detail: loads once, shows the muscles with their ratings and says it is a judgement', async () => {
  const world = detailWorld();
  assert.ok(h.byLabel(world.render(), 'Loading exercise'));
  await h.settle();
  const tree = world.render();
  assert.deepEqual(world.requested, ['e1']);
  const shown = h.texts(tree);
  for (const expected of ['Incline Dumbbell Press', 'Dumbbell · Compound', 'Primary muscles', 'Secondary muscles', 'Chest', 'Front Delts', 'Effectiveness 3 of 5']) {
    assert.ok(shown.includes(expected), expected);
  }
  assert.ok(shown.some((text) => /judgement, not a\s+measurement/.test(text) && /Add exercise/.test(text)));
  assert.equal(h.nodes(tree).filter((node) => node.type === 'Screen')[0].props.options.title, 'Incline Dumbbell Press');
});

test('exercise detail: a failed load is an error with a retry, not an empty page', async () => {
  const world = detailWorld({ fail: true });
  world.render(); await h.settle();
  let tree = world.render();
  assert.ok(h.texts(tree).includes('Could not load this exercise.'));
  world.setFailing(false);
  h.byLabel(tree, 'Try loading the exercise again').props.onPress();
  world.render(); await h.settle();
  tree = world.render();
  assert.ok(h.texts(tree).includes('Primary muscles'));
  assert.deepEqual(world.requested, ['e1', 'e1']);
});
