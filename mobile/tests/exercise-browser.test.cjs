/* global __dirname */
// The shared exercise browser: one implementation behind both the Exercises tab (browse) and the
// workout/program exercise picker (select). The paging store, the API's parameters, the filter
// wording, the shared row and both real screens are tested. What only a device can show (layout,
// the keyboard, the native modal the picker is presented in) is not covered here.
const assert = require('node:assert/strict');
const path = require('node:path');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { loadTs } = require('./support/load-ts.cjs');
const h = require('./support/screen-harness.cjs');

const { createExerciseBrowser, browserView, BROWSER_PAGE_SIZE } = loadTs('src/exercises/exerciseBrowserStore.ts');
const { describeExercise } = loadTs('src/exercises/exerciseDetail.ts');
const filtersModule = loadTs('src/exercises/exerciseFilters.ts');
const { NO_FILTERS, EQUIPMENT_OPTIONS, muscleOptions, primaryMuscleLabel, hasFilters } = filtersModule;
const { light } = loadTs('src/lightTheme.ts');

const NONE = { muscle: null, equipment: null };
const MUSCLE_GROUPS = [
  { id: 1, name: 'abs', name_tr: 'Karın', region: 'core', mev: 0, mav: 16, mrv: 25 },
  { id: 2, name: 'glutes', name_tr: 'Kalça', region: 'lower', mev: 0, mav: 8, mrv: 16 },
  { id: 3, name: 'quads', name_tr: 'Ön bacak', region: 'lower', mev: 8, mav: 14, mrv: 20 },
  { id: 4, name: 'chest', name_tr: 'Göğüs', region: 'upper', mev: 8, mav: 14, mrv: 22 },
  { id: 5, name: 'front_delts', name_tr: 'Ön omuz', region: 'upper', mev: 0, mav: 7, mrv: 12 },
  { id: 6, name: 'triceps', name_tr: 'Triseps', region: 'upper', mev: 6, mav: 12, mrv: 18 },
  { id: 7, name: 'biceps', name_tr: 'Pazu', region: 'upper', mev: 8, mav: 14, mrv: 20 },
];

/**
 * A catalogue of `count` exercises that pages and filters like the real endpoint (limit <= 100,
 * muscle = PRIMARY involvement only). Every 5th is a chest exercise, the rest train quads and
 * glutes; odd rows are barbell, even rows dumbbell.
 */
function catalogue(count) {
  const all = Array.from({ length: count }, (_, n) => ({
    id: `e${n}`, name: `Exercise ${n}`, name_tr: null, equipment: n % 2 ? 'barbell' : 'dumbbell', is_compound: n % 3 === 0,
    primary_muscles: n % 5 === 0
      ? [{ name: 'chest', name_tr: 'Göğüs' }]
      : [{ name: 'quads', name_tr: 'Ön bacak' }, { name: 'glutes', name_tr: 'Kalça' }],
  }));
  const requests = [];
  // A one-row request is the open filter sheet asking the server how many exercises its pending
  // choice would show. Those are kept apart from the searches that fill the list.
  const counts = [];
  const fetchPage = async (query, filters, limit, offset) => {
    (limit === 1 ? counts : requests).push(h.plain({ query, filters, limit, offset }));
    const matches = all.filter((row) =>
      (!filters.muscle || row.primary_muscles.some((muscle) => muscle.name === filters.muscle)) &&
      (!filters.equipment || row.equipment === filters.equipment) &&
      row.name.toLowerCase().includes(query.toLowerCase()));
    return { items: matches.slice(offset, offset + limit), total: matches.length, limit, offset };
  };
  return { all, requests, counts, fetchPage };
}
const ids = (rows) => Array.from(rows, (row) => row.id);

// ------------------------------------------------------------------ the paging store

test('every matching exercise is reachable: 130 entries come in pages of 50 and none are dropped', async () => {
  const { all, requests, fetchPage } = catalogue(130);
  const browser = createExerciseBrowser(fetchPage);
  assert.equal(browserView(browser.getSnapshot()), 'loading');
  await browser.search('', NONE);
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

test('the query, the muscle and the equipment go to the server together, and a new search starts from the first page', async () => {
  const { all, requests, fetchPage } = catalogue(130);
  const browser = createExerciseBrowser(fetchPage);
  await browser.search('', NONE);
  await browser.loadMore();
  await browser.search('exercise 1', { muscle: 'chest', equipment: 'barbell' });
  assert.deepEqual(requests.at(-1), { query: 'exercise 1', filters: { muscle: 'chest', equipment: 'barbell' }, limit: 50, offset: 0 });
  const expected = all.filter((row) => row.name.startsWith('Exercise 1') && row.primary_muscles[0].name === 'chest' && row.equipment === 'barbell');
  assert.ok(expected.length > 0);
  assert.deepEqual(ids(browser.getSnapshot().items), ids(expected));
  // The count is the server's count of the filtered matches, not of the catalogue.
  assert.equal(browser.getSnapshot().total, expected.length);
  assert.deepEqual(h.plain(browser.getSnapshot().filters), { muscle: 'chest', equipment: 'barbell' });
  await browser.loadMore(); // everything fit on one page
  assert.equal(requests.length, 3);
});

test('a filtered list pages with its own filters: 104 matches arrive as 50, 50 and 4', async () => {
  const { requests, fetchPage } = catalogue(130);
  const browser = createExerciseBrowser(fetchPage);
  await browser.search('', { muscle: 'quads', equipment: null });
  assert.equal(browser.getSnapshot().total, 104);
  await browser.loadMore();
  await browser.loadMore();
  assert.equal(browser.getSnapshot().items.length, 104);
  assert.ok(requests.every((request) => request.filters.muscle === 'quads'));
  assert.deepEqual(requests.map((request) => request.offset), [0, 50, 100]);
});

test('repeated scroll events share one page request', async () => {
  const slow = h.deferred();
  let page = 0;
  const { fetchPage } = catalogue(130);
  const browser = createExerciseBrowser(async (...args) => (++page === 2 ? slow.promise : fetchPage(...args)));
  await browser.search('', NONE);
  const first = browser.loadMore();
  await browser.loadMore();
  await browser.loadMore();
  assert.equal(page, 2);
  slow.resolve(await fetchPage('', NONE, 50, 50));
  await first;
  assert.equal(browser.getSnapshot().items.length, 100);
});

test('a late answer for an older search or an older filter is never shown for the newer one', async () => {
  const slow = h.deferred();
  const { fetchPage } = catalogue(130);
  let calls = 0;
  const browser = createExerciseBrowser((query, ...rest) => (++calls === 1 ? slow.promise : fetchPage(query, ...rest)));
  const old = browser.search('', NONE);
  await browser.search('', { muscle: 'chest', equipment: null });
  slow.resolve({ items: [{ id: 'stale', name: 'Stale', name_tr: null, equipment: null, is_compound: false, primary_muscles: [] }], total: 1, limit: 50, offset: 0 });
  await old;
  assert.equal(browser.getSnapshot().items.some((row) => row.id === 'stale'), false);
  assert.equal(browser.getSnapshot().filters.muscle, 'chest');
  assert.equal(browser.getSnapshot().total, 26);

  // The same for a next-page answer that lands after the filters changed.
  const next = h.deferred();
  const second = catalogue(130);
  let page = 0;
  const paged = createExerciseBrowser((...args) => (++page === 2 ? next.promise : second.fetchPage(...args)));
  await paged.search('', NONE);
  const more = paged.loadMore();
  await paged.search('exercise 1', { muscle: 'chest', equipment: null });
  next.resolve(await second.fetchPage('', NONE, 50, 50));
  await more;
  assert.equal(paged.getSnapshot().items.every((row) => /^Exercise 1/.test(row.name) && row.primary_muscles[0].name === 'chest'), true);
});

test('loading, nothing found and a failed request are three different states', async () => {
  const { fetchPage } = catalogue(10);
  const browser = createExerciseBrowser(fetchPage);
  assert.equal(browserView(browser.getSnapshot()), 'loading');
  await browser.search('zzz-no-such-exercise', NONE);
  assert.equal(browserView(browser.getSnapshot()), 'empty');
  assert.equal(browser.getSnapshot().error, null);

  let offline = true;
  const flaky = createExerciseBrowser(async (...args) => { if (offline) throw new Error('offline'); return fetchPage(...args); });
  await flaky.search('', NONE);
  assert.equal(browserView(flaky.getSnapshot()), 'error');
  offline = false;
  await flaky.search('', NONE);
  assert.equal(browserView(flaky.getSnapshot()), 'results');
  assert.equal(flaky.getSnapshot().error, null);
});

test('a failed search clears the old rows (they answer a different question); a failed next page keeps them and retries in place', async () => {
  const { fetchPage } = catalogue(130);
  let failAt = null;
  const requested = [];
  const browser = createExerciseBrowser(async (query, filters, limit, offset) => {
    requested.push(offset);
    if (failAt === offset) throw new Error('offline');
    return fetchPage(query, filters, limit, offset);
  });
  await browser.search('', NONE);
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
  await browser.search('exercise 2', NONE);
  assert.equal(browser.getSnapshot().items.length, 0);
  assert.equal(browserView(browser.getSnapshot()), 'error');
});

test('the next page starts where the server stopped even when the catalogue shifted and a row repeats', async () => {
  const { all } = catalogue(120);
  const offsets = [];
  const browser = createExerciseBrowser(async (_q, _f, limit, offset) => {
    offsets.push(offset);
    const items = offset === 50 ? all.slice(49, 99) : all.slice(offset, offset + limit);
    return { items, total: 120, limit, offset };
  });
  await browser.search('', NONE);
  await browser.loadMore();
  assert.equal(browser.getSnapshot().items.length, 99); // one repeated row is suppressed
  await browser.loadMore();
  assert.deepEqual(offsets, [0, 50, 100]); // advanced by the 50 rows received, not the 49 new ones
  assert.equal(new Set(ids(browser.getSnapshot().items)).size, browser.getSnapshot().items.length);
});

// ------------------------------------------------------------------ the search API

test('the search API sends muscle, equipment, query and offset only when they are set', async () => {
  const urls = [];
  const api = h.loadFile('src/api/exercises.ts', {
    globals: { URLSearchParams },
    modules: { './client': { apiRequest: async (url) => { urls.push(url); return {}; } } },
  });
  await api.searchExercises('');
  await api.searchExercises(' bench ', { muscle: 'chest', equipment: null });
  await api.searchExercises('', { muscle: null, equipment: 'bodyweight' });
  await api.searchExercises('bench', { muscle: 'triceps', equipment: 'barbell' }, 50, 100);
  assert.deepEqual(urls, [
    '/exercises?limit=50',
    '/exercises?limit=50&q=bench&muscle=chest',
    '/exercises?limit=50&equipment=bodyweight',
    '/exercises?limit=50&offset=100&q=bench&muscle=triceps&equipment=barbell',
  ]);
  // The broad categories are gone from the client: a category matched "any of several muscles"
  // and could not be the selection a muscle model submits.
  assert.ok(urls.every((url) => !url.includes('category')));
});

// ------------------------------------------------------------------ filters and labels

test('the equipment choices are exactly the values the API accepts, with nothing invented', () => {
  const backend = readFileSync(path.resolve(__dirname, '..', '..', 'backend', 'app', 'domains', 'exercises', 'schemas.py'), 'utf8');
  const accepted = /Equipment = Literal\[([^\]]+)\]/.exec(backend)[1].match(/"(\w+)"/g).map((value) => value.replace(/"/g, ''));
  assert.deepEqual(Array.from(EQUIPMENT_OPTIONS, (option) => option.value), accepted);
  const declared = /export type Equipment = ([^;]+);/.exec(h.read('src/api/exercises.ts'))[1].match(/"(\w+)"/g).map((value) => value.replace(/"/g, ''));
  assert.deepEqual(declared, accepted);
  assert.deepEqual(Array.from(EQUIPMENT_OPTIONS, (option) => option.label), ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Bodyweight']);
  // No "none"/"other" choice: the API has no way to ask for exercises with unrecorded equipment,
  // and "Bodyweight" must not be offered as if it meant that.
  assert.ok(Array.from(EQUIPMENT_OPTIONS).every((option) => !/none|other|unknown/i.test(option.value)));
});

test('the muscle choices come from the muscle-group catalogue, by stable code, grouped by region', () => {
  const options = h.plain(muscleOptions(MUSCLE_GROUPS));
  assert.deepEqual(options.map((option) => option.value), ['biceps', 'chest', 'front_delts', 'triceps', 'glutes', 'quads', 'abs']);
  assert.deepEqual(options.map((option) => option.label), ['Biceps', 'Chest', 'Front Delts', 'Triceps', 'Glutes', 'Quads', 'Abs']);
  assert.deepEqual(options.map((option) => option.group), ['Upper body', 'Upper body', 'Upper body', 'Upper body', 'Lower body', 'Lower body', 'Core']);
  assert.deepEqual(h.plain(muscleOptions([])), []);
});

test('a row names its primary muscles only, all of them, in the order the server sent', () => {
  assert.equal(primaryMuscleLabel({ primary_muscles: [{ name: 'chest', name_tr: 'Göğüs' }] }), 'Chest');
  assert.equal(primaryMuscleLabel({ primary_muscles: [{ name: 'quads', name_tr: 'x' }, { name: 'glutes', name_tr: 'y' }] }), 'Quads, Glutes');
  assert.equal(primaryMuscleLabel({ primary_muscles: [{ name: 'front_delts', name_tr: 'x' }] }), 'Front Delts');
  // An older server that does not send the field yet, or an exercise with no primary muscle:
  // nothing is shown rather than a guess.
  assert.equal(primaryMuscleLabel({}), '');
  assert.equal(primaryMuscleLabel({ primary_muscles: [] }), '');
  assert.equal(hasFilters(NO_FILTERS), false);
  assert.equal(hasFilters({ muscle: 'chest', equipment: null }), true);
  assert.equal(hasFilters({ muscle: null, equipment: 'cable' }), true);
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

// ------------------------------------------------------------------ the shared browser component

function timersWorld() {
  const timers = [];
  return {
    timers,
    setTimeout: (fn, delay) => { timers.push({ fn, delay, cleared: false }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; },
    fire() { timers.filter((timer) => !timer.cleared).forEach((timer) => { timer.cleared = true; timer.fire = true; timer.fn(); }); },
  };
}

const reactGlobal = { createElement: h.createElement, Fragment: 'Fragment' };
const native = () => h.reactNative({ Keyboard: { dismiss() {} } });

/** The real row, panel and browser files, wired to each other, with only the network replaced. */
function browserModules({ hooks, clock, api }) {
  const common = { react: hooks.hooks, 'react-native': native(), '../lightTheme': { light } };
  const globals = { React: reactGlobal, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout };
  const row = h.loadFile('src/exercises/ExerciseRow.tsx', {
    globals, modules: { ...common, 'expo-image': { Image: 'ExpoImage' }, './exerciseFilters': filtersModule },
  });
  const panel = h.loadFile('src/exercises/FilterPanel.tsx', {
    globals,
    modules: { ...common, 'react-native-safe-area-context': { SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView' } },
  });
  const browser = h.loadFile('src/exercises/ExerciseBrowser.tsx', {
    globals,
    modules: {
      ...common,
      '../api/exercises': api,
      './ExerciseRow': row,
      './FilterPanel': panel,
      './exerciseBrowserStore': { browserView, createExerciseBrowser },
      './exerciseFilters': filtersModule,
    },
  });
  return { row, panel, browser };
}

function browserWorld({ mode = 'browse', total = 130, fail = false, musclesFail = false } = {}) {
  const hooks = h.createHooks();
  const clock = timersWorld();
  const { all, requests, counts, fetchPage } = catalogue(total);
  const state = { failing: fail, musclesFailing: musclesFail, muscleRequests: 0 };
  const rowPresses = [];
  const infoPresses = [];
  const api = {
    searchExercises: async (...args) => { if (state.failing) throw new Error('offline'); return fetchPage(...args); },
    listMuscleGroups: async () => { state.muscleRequests += 1; if (state.musclesFailing) throw new Error('offline'); return MUSCLE_GROUPS; },
  };
  const { browser } = browserModules({ hooks, clock, api });
  const props = { mode, onRowPress: (exercise) => rowPresses.push(exercise.id), onInfo: (exercise) => infoPresses.push(exercise.id) };
  const world = {
    all, state, clock, requests, counts, rowPresses, infoPresses,
    // Function components (rows, panels, filter buttons) are expanded so their nodes can be read.
    // Child components are expanded INSIDE the render so their effects run with it.
    render: () => hooks.render(() => h.expand(h.createElement(browser.ExerciseBrowser, props))),
    list: (tree) => h.nodes(tree).find((node) => node.type === 'FlatList'),
    search: (tree) => h.byLabel(tree, 'Search exercises'),
    row: (tree, index) => { const list = world.list(tree); return h.expand(list.props.renderItem({ item: list.props.data[index], index })); },
    press: (label) => { h.byLabel(world.render(), label).props.onPress(); return world.render(); },
    radios: (tree) => h.nodes(tree).filter((node) => node.props?.accessibilityRole === 'radio'),
    sheetOpen: (tree) => h.nodes(tree).some((node) => node.type === 'Modal'),
    showButton: (tree) => h.nodes(tree).find((node) => /^Show( \d+)? results?$/.test(node.props?.accessibilityLabel ?? '')),
    /** Press "Show results" in the open sheet and let the search it starts finish. */
    async show() { world.showButton(world.render()).props.onPress(); return world.apply(); },
    async apply() { world.render(); clock.fire(); await h.settle(); return world.render(); },
    async open() { world.render(); clock.fire(); await h.settle(); return world.render(); },
  };
  return world;
}

for (const mode of ['browse', 'select']) {
  test(`${mode}: the first search does not wait, typing is debounced to one request, and muscle, equipment and query apply together`, async () => {
    const world = browserWorld({ mode });
    assert.ok(h.byLabel(world.render(), 'Loading exercises'), 'a spinner until the first page lands');
    let tree = await world.open();
    assert.deepEqual(world.requests.map((request) => request.query), ['']);
    assert.equal(world.list(tree).props.data.length, 50);
    assert.ok(h.texts(world.list(tree).props.ListHeaderComponent).includes('130 exercises'));

    for (const text of ['e', 'ex', 'exe']) { world.search(world.render()).props.onChangeText(text); world.render(); }
    assert.deepEqual(world.requests.map((request) => request.query), [''], 'nothing is sent while the user is still typing');
    assert.equal(world.clock.timers.filter((timer) => !timer.cleared).at(-1).delay, 250);
    await world.apply();
    assert.deepEqual(world.requests.map((request) => request.query), ['', 'exe']);

    world.press('Muscles filter, All Muscles');
    await h.settle();
    world.press('Chest');
    await world.show();
    world.press('Equipment filter, All Equipment');
    world.press('Barbell');
    tree = await world.show();
    assert.deepEqual(world.requests.at(-1), { query: 'exe', filters: { muscle: 'chest', equipment: 'barbell' }, limit: 50, offset: 0 });
    const expected = world.all.filter((row) => row.primary_muscles[0].name === 'chest' && row.equipment === 'barbell');
    assert.deepEqual(ids(world.list(tree).props.data), ids(expected));
    assert.ok(h.texts(world.list(tree).props.ListHeaderComponent).includes(`${expected.length} exercises`));
    // The buttons say what is selected.
    assert.ok(h.byLabel(tree, 'Muscles filter, Chest selected'));
    assert.ok(h.byLabel(tree, 'Equipment filter, Barbell selected'));
  });

  test(`${mode}: scrolling reaches every entry, and the footer offers the button as well`, async () => {
    const world = browserWorld({ mode });
    let tree = await world.open();
    assert.ok(h.byLabel(world.list(tree).props.ListFooterComponent, 'Load more exercises'));
    world.list(tree).props.onEndReached(); await h.settle(); tree = world.render();
    h.byLabel(world.list(tree).props.ListFooterComponent, 'Load more exercises').props.onPress(); await h.settle();
    tree = world.render();
    assert.equal(world.list(tree).props.data.length, 130);
    assert.deepEqual(world.requests.map((request) => request.offset), [0, 50, 100]);
    assert.equal(h.byLabel(world.list(tree).props.ListFooterComponent, 'Load more exercises'), undefined);
  });
}

test('search is on top; under it are two equal buttons, All Equipment on the left and All Muscles on the right, and no third one', async () => {
  const world = browserWorld();
  const tree = await world.open();
  const controls = h.nodes(tree).filter((node) => node.type === 'TextInput' || /filter, /.test(node.props?.accessibilityLabel ?? ''));
  assert.deepEqual(controls.map((node) => node.props.accessibilityLabel), ['Search exercises', 'Equipment filter, All Equipment', 'Muscles filter, All Muscles']);
  const [equipment, musclesButton] = controls.slice(1);
  assert.deepEqual(h.texts(equipment), ['All Equipment']);
  assert.deepEqual(h.texts(musclesButton), ['All Muscles']);
  for (const button of [equipment, musclesButton]) assert.equal(Object.assign({}, ...[button.props.style].flat(Infinity).filter(Boolean)).flex, 1);
  assert.equal(h.byLabel(tree, 'Clear filters'), undefined, 'resetting lives inside the sheets');
  assert.equal(world.sheetOpen(tree), false);
});

test('the Muscles sheet opens over the list, lists the real muscle groups once, and nothing changes until Show results', async () => {
  const world = browserWorld();
  await world.open();
  assert.equal(world.state.muscleRequests, 0, 'the muscle groups are not requested until the sheet is opened');
  let tree = world.press('Muscles filter, All Muscles');
  assert.ok(h.byLabel(tree, 'Loading muscles'));
  await h.settle();
  tree = world.render();
  assert.ok(world.sheetOpen(tree));
  assert.equal(world.list(tree).props.data.length, 50, 'the results stay on screen under the sheet');
  assert.deepEqual(world.radios(tree).map((node) => node.props.accessibilityLabel), ['All Muscles', 'Biceps', 'Chest', 'Front Delts', 'Triceps', 'Glutes', 'Quads', 'Abs']);
  assert.equal(h.byLabel(tree, 'All Muscles').props.accessibilityState.checked, true);
  assert.ok(h.texts(tree).includes('Upper body') && h.texts(tree).includes('Core'));
  assert.ok(h.byLabel(tree, 'Clear Filters') && world.showButton(tree));

  tree = world.press('Quads');
  assert.equal(h.byLabel(tree, 'Quads').props.accessibilityState.checked, true);
  await world.apply();
  assert.equal(world.requests.length, 1, 'a tapped card is only pending: the list is not searched again');
  assert.ok(h.byLabel(world.render(), 'Muscles filter, All Muscles'), 'and the button still shows the applied filter');

  tree = await world.show();
  assert.deepEqual(world.requests.at(-1).filters, { muscle: 'quads', equipment: null });
  assert.equal(world.sheetOpen(tree), false, 'Show results closes the sheet');
  assert.ok(h.texts(world.list(tree).props.ListHeaderComponent).includes('104 exercises'));
  assert.deepEqual(h.texts(h.byLabel(tree, 'Muscles filter, Quads selected')), ['Quads']);

  tree = world.press('Muscles filter, Quads selected');
  assert.equal(h.byLabel(tree, 'Quads').props.accessibilityState.checked, true);
  assert.equal(h.byLabel(tree, 'All Muscles').props.accessibilityState.checked, false);
  world.press('All Muscles');
  tree = await world.show();
  assert.deepEqual(world.requests.at(-1).filters, { muscle: null, equipment: null });
  assert.ok(h.texts(world.list(tree).props.ListHeaderComponent).includes('130 exercises'));
  assert.equal(world.state.muscleRequests, 1);
});

test('choosing Biceps asks the server for the biceps code and nothing else: the list is whatever the server says trains it directly', async () => {
  const world = browserWorld();
  await world.open();
  world.press('Muscles filter, All Muscles');
  await h.settle();
  world.press('Biceps');
  const tree = await world.show();
  assert.deepEqual(world.requests.at(-1), { query: '', filters: { muscle: 'biceps', equipment: null }, limit: 50, offset: 0 });
  // No row in this catalogue has biceps as a primary muscle, so nothing is listed. The client adds
  // nothing of its own and filters nothing afterwards.
  assert.ok(h.texts(tree).includes('No exercises found'));
  const source = h.read('src/exercises/ExerciseBrowser.tsx') + h.read('src/exercises/exerciseBrowserStore.ts');
  assert.doesNotMatch(source, /Barbell Row|Bench Press|secondary/);
});

test('the Muscles sheet says when the muscle groups could not be loaded and can retry; closing it changes nothing', async () => {
  const world = browserWorld({ musclesFail: true });
  await world.open();
  world.press('Muscles filter, All Muscles');
  await h.settle();
  let tree = world.render();
  assert.ok(h.texts(tree).includes('Could not load the muscle list.'));
  world.state.musclesFailing = false;
  world.press('Try loading muscles again');
  await h.settle();
  tree = world.render();
  assert.ok(h.byLabel(tree, 'Triceps'));
  world.press('Triceps');
  world.press('Close Muscles');
  tree = await world.apply();
  assert.equal(world.sheetOpen(tree), false);
  assert.equal(world.requests.length, 1, 'no new search: the pending choice was never applied');
  assert.ok(h.byLabel(tree, 'Muscles filter, All Muscles'));
});

test('the Equipment sheet offers the supported equipment as cards in two columns', async () => {
  const world = browserWorld();
  await world.open();
  const tree = world.press('Equipment filter, All Equipment');
  assert.deepEqual(world.radios(tree).map((node) => node.props.accessibilityLabel), ['All Equipment', 'Barbell', 'Dumbbell', 'Machine', 'Cable', 'Bodyweight']);
  const panelSource = h.read('src/exercises/FilterPanel.tsx');
  assert.match(panelSource, /flexWrap: "wrap"/);
  assert.match(panelSource, /width: "48\.5%"/, 'two cards per row');
});

test('dismissing a sheet by the backdrop, the close button or the system back keeps the previous filter', async () => {
  const world = browserWorld();
  await world.open();
  world.press('Equipment filter, All Equipment');
  world.press('Dumbbell');
  await world.show();
  assert.deepEqual(world.requests.at(-1).filters, { muscle: null, equipment: 'dumbbell' });
  const searches = world.requests.length;

  const dismissals = [
    (tree) => h.nodes(tree).find((node) => node.props?.testID === 'filter-backdrop').props.onPress(),
    (tree) => h.byLabel(tree, 'Close Equipment').props.onPress(),
    (tree) => h.nodes(tree).find((node) => node.type === 'Modal').props.onRequestClose(),
  ];
  for (const dismiss of dismissals) {
    world.press('Equipment filter, Dumbbell selected');
    let tree = world.press('Cable');
    assert.equal(h.byLabel(tree, 'Cable').props.accessibilityState.checked, true);
    dismiss(tree);
    tree = await world.apply();
    assert.equal(world.sheetOpen(tree), false);
    assert.ok(h.byLabel(tree, 'Equipment filter, Dumbbell selected'));
    assert.equal(world.requests.length, searches, 'the list was not searched again');
    // Reopening starts from the applied filter, not from the abandoned choice.
    tree = world.press('Equipment filter, Dumbbell selected');
    assert.equal(h.byLabel(tree, 'Dumbbell').props.accessibilityState.checked, true);
    assert.equal(h.byLabel(tree, 'Cable').props.accessibilityState.checked, false);
    h.byLabel(tree, 'Close Equipment').props.onPress();
    world.render();
  }
});

test('Clear Filters resets only that sheet\'s filter, is pending until Show results, and keeps the search and the other filter', async () => {
  const world = browserWorld();
  await world.open();
  world.press('Equipment filter, All Equipment');
  assert.equal(h.byLabel(world.render(), 'Clear Filters').props.disabled, true, 'nothing to clear yet');
  world.press('Dumbbell');
  await world.show();
  world.press('Muscles filter, All Muscles');
  await h.settle();
  world.press('Chest');
  await world.show();
  world.search(world.render()).props.onChangeText('exercise 1');
  await world.apply();
  assert.deepEqual(world.requests.at(-1), { query: 'exercise 1', filters: { muscle: 'chest', equipment: 'dumbbell' }, limit: 50, offset: 0 });
  const searches = world.requests.length;

  world.press('Equipment filter, Dumbbell selected');
  let tree = world.press('Clear Filters');
  assert.equal(h.byLabel(tree, 'All Equipment').props.accessibilityState.checked, true);
  await world.apply();
  assert.equal(world.requests.length, searches, 'clearing is pending too');
  tree = await world.show();
  assert.deepEqual(world.requests.at(-1), { query: 'exercise 1', filters: { muscle: 'chest', equipment: null }, limit: 50, offset: 0 });
  assert.ok(h.byLabel(tree, 'Muscles filter, Chest selected'));
  assert.ok(h.byLabel(tree, 'Equipment filter, All Equipment'));
  assert.equal(world.search(tree).props.value, 'exercise 1');
});

test('Show results carries a number only when the server has counted exactly that pending search', async () => {
  const world = browserWorld();
  await world.open();
  world.search(world.render()).props.onChangeText('exercise 1');
  await world.apply();
  let tree = world.press('Equipment filter, All Equipment');
  assert.equal(world.showButton(tree).props.accessibilityLabel, 'Show results', 'no number before the server answered');
  await h.settle();
  tree = world.render();
  const matching = (equipment) => world.all.filter((row) => row.name.toLowerCase().includes('exercise 1') && (!equipment || row.equipment === equipment)).length;
  assert.equal(world.showButton(tree).props.accessibilityLabel, `Show ${matching(null)} results`);
  assert.deepEqual(world.counts.at(-1), { query: 'exercise 1', filters: { muscle: null, equipment: null }, limit: 1, offset: 0 });

  tree = world.press('Barbell');
  assert.equal(world.showButton(tree).props.accessibilityLabel, 'Show results', 'the old number is not shown for a new choice');
  await h.settle();
  tree = world.render();
  assert.equal(world.showButton(tree).props.accessibilityLabel, `Show ${matching('barbell')} results`);
  // The number is the list's own total once applied.
  tree = await world.show();
  assert.ok(h.texts(world.list(tree).props.ListHeaderComponent).includes(`${matching('barbell')} exercises`));

  // If the count cannot be fetched the button simply has no number.
  world.press('Equipment filter, Barbell selected');
  world.state.failing = true;
  tree = world.press('Cable');
  await h.settle();
  assert.equal(world.showButton(world.render()).props.accessibilityLabel, 'Show results');
});

test('an empty result and a failed request look different, and the failure can be retried', async () => {
  const empty = browserWorld();
  await empty.open();
  empty.search(empty.render()).props.onChangeText('zzz-nothing');
  await empty.apply();
  const emptyTexts = h.texts(empty.render());
  assert.ok(emptyTexts.includes('No exercises found'));
  assert.ok(emptyTexts.includes('Try a different word or filter.'));
  assert.equal(emptyTexts.includes('Could not load exercises.'), false);

  const broken = browserWorld({ fail: true });
  const tree = await broken.open();
  assert.ok(h.texts(tree).includes('Could not load exercises.'));
  assert.equal(h.texts(tree).includes('No exercises found'), false);
  broken.state.failing = false;
  h.byLabel(tree, 'Try loading exercises again').props.onPress();
  await h.settle();
  assert.equal(broken.list(broken.render()).props.data.length, 50);
});

test('the shared row shows the name and its primary muscles, not the equipment or compound subtitle', async () => {
  const world = browserWorld();
  const tree = await world.open();
  const single = world.row(tree, 0); // chest
  const several = world.row(tree, 1); // quads + glutes
  // What the row itself shows (the information button beside it is a separate control).
  assert.deepEqual(h.texts(h.byLabel(single, 'Exercise 0, Chest')), ['Exercise 0', 'Chest']);
  assert.deepEqual(h.texts(h.byLabel(several, 'Exercise 1, Quads, Glutes')), ['Exercise 1', 'Quads, Glutes']);
  assert.doesNotMatch(h.texts(several).join(' '), /barbell|dumbbell|compound|isolation/i);
  // With no verified media the thumbnail area is a neutral box of the same size, hidden from
  // screen readers, and no image is requested.
  const thumbnail = h.nodes(single).find((node) => node.props?.testID === 'exercise-thumbnail');
  assert.equal(thumbnail.props.accessibilityElementsHidden, true);
  assert.equal(thumbnail.props.importantForAccessibility, 'no-hide-descendants');
  assert.equal(h.nodes(single).some((node) => node.type === 'ExpoImage'), false);
});

for (const mode of ['browse', 'select']) {
  test(`${mode}: the information button is its own control and never counts as a tap on the row`, async () => {
    const world = browserWorld({ mode });
    const tree = await world.open();
    const row = world.row(tree, 2);
    const main = h.byLabel(row, 'Exercise 2, Quads, Glutes');
    const info = h.byLabel(row, 'How to perform Exercise 2');
    assert.equal(info.props.accessibilityRole, 'button');
    assert.equal(main.props.accessibilityHint, mode === 'select' ? 'Adds this exercise' : 'Opens the exercise details');
    // Siblings, not nested: the information button is not inside the row's pressable.
    assert.equal(h.nodes(main).includes(info), false);
    assert.ok(info.props.style.minWidth >= 44 && info.props.style.minHeight >= 44);

    info.props.onPress();
    assert.deepEqual(world.infoPresses, ['e2']);
    assert.deepEqual(world.rowPresses, []);
    main.props.onPress();
    assert.deepEqual(world.rowPresses, ['e2']);
    assert.deepEqual(world.infoPresses, ['e2']);
  });
}

// ------------------------------------------------------------------ the two real screens

/** Both screens with the real shared browser inside them. */
function screenWorld(file, { total = 130 } = {}) {
  const hooks = h.createHooks();
  const clock = timersWorld();
  const { requests, fetchPage } = catalogue(total);
  const router = { pushes: [], backs: 0 };
  const mailbox = h.loadFile('src/workout/usePickedExercise.ts', {
    modules: { 'expo-router': { useFocusEffect() {}, useRouter: () => ({}) }, react: hooks.hooks },
  });
  const api = { searchExercises: fetchPage, listMuscleGroups: async () => MUSCLE_GROUPS, getExercise: async () => detail };
  const { browser } = browserModules({ hooks, clock, api });
  const globals = { React: reactGlobal, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout };
  const detailBody = h.loadFile('src/exercises/ExerciseDetailBody.tsx', {
    globals,
    modules: { react: hooks.hooks, 'react-native': native(), '../api/exercises': api, './exerciseDetail': { describeExercise }, '../lightTheme': { light } },
  });
  const expoRouter = {
    Stack: { Screen: 'Screen' },
    useFocusEffect: hooks.hooks.useFocusEffect,
    useRouter: () => ({ push: (href) => router.pushes.push(h.plain(href)), back: () => { router.backs += 1; } }),
  };
  const screen = h.loadFile(file, {
    globals,
    modules: {
      'expo-router': expoRouter,
      react: hooks.hooks,
      'react-native': native(),
      '../../../src/exercises/ExerciseBrowser': browser,
      '../../../src/exercises/ExerciseDetailBody': detailBody,
      '../../../src/lightTheme': { light },
      '../../../src/navigation/TabTopBar': { TabTopBar: 'TabTopBar' },
      // Only the picker may import this; the Exercises tab importing it throws "Unexpected dependency".
      ...(file.includes('exercise-picker') ? { '../../../src/workout/usePickedExercise': mailbox } : {}),
    },
  }).default;
  const world = {
    hooks, clock, requests, router, mailbox,
    render: () => hooks.render(() => h.expand(h.createElement(screen, {}))),
    list: (tree) => h.nodes(tree).find((node) => node.type === 'FlatList'),
    row: (tree, index) => { const list = world.list(tree); return h.expand(list.props.renderItem({ item: list.props.data[index], index })); },
    async open() { world.render(); hooks.focus(); clock.fire(); await h.settle(); return world.render(); },
  };
  return world;
}

test('Exercises tab: the row and the information button both open the details, once, and nothing is ever picked', async () => {
  const world = screenWorld('app/(app)/(tabs)/exercises.tsx');
  const tree = await world.open();
  const row = world.row(tree, 2);
  h.byLabel(row, 'Exercise 2, Quads, Glutes').props.onPress();
  h.byLabel(row, 'Exercise 2, Quads, Glutes').props.onPress(); // double tap
  h.byLabel(row, 'How to perform Exercise 2').props.onPress(); // and a stray tap on the button
  assert.deepEqual(world.router.pushes, [{ pathname: '/exercise/[id]', params: { id: 'e2' } }]);
  assert.equal(world.router.backs, 0);

  // Coming back allows the next tap; the information button opens the same details.
  world.hooks.blur(); world.hooks.focus();
  h.byLabel(world.row(world.render(), 3), 'How to perform Exercise 3').props.onPress();
  assert.deepEqual(world.router.pushes.at(-1), { pathname: '/exercise/[id]', params: { id: 'e3' } });

  // The tab, the detail screen and the shared pieces are not wired to the picker's mailbox at all.
  const code = (file) => h.read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const file of [
    'app/(app)/(tabs)/exercises.tsx', 'app/(app)/exercise/[id].tsx', 'src/exercises/exerciseBrowserStore.ts',
    'src/exercises/ExerciseBrowser.tsx', 'src/exercises/ExerciseRow.tsx', 'src/exercises/FilterPanel.tsx', 'src/exercises/ExerciseDetailBody.tsx',
  ]) {
    assert.doesNotMatch(code(file), /usePickedExercise|depositPickedExercise|takePickedExercise|exercise-picker/, file);
  }
});

test('picker: tapping a row chooses that exercise exactly once and goes back to the screen that opened it', async () => {
  const world = screenWorld('app/(app)/workout/exercise-picker.tsx');
  const tree = await world.open();
  const main = h.byLabel(world.row(tree, 4), 'Exercise 4, Quads, Glutes');
  main.props.onPress();
  main.props.onPress(); // double tap
  h.byLabel(world.row(tree, 5), 'Exercise 5, Chest').props.onPress(); // a second row before the screen has gone
  assert.equal(world.router.backs, 1);
  assert.deepEqual(world.router.pushes, [], 'back(), never a push or replace: the caller\'s unsaved draft is the same screen instance');
  assert.deepEqual(h.plain(world.mailbox.takePickedExercise()), { id: 'e4', name: 'Exercise 4' });
  assert.equal(world.mailbox.takePickedExercise(), null, 'delivered once');
});

test('picker: every matching exercise is reachable, not only the first 50', async () => {
  const world = screenWorld('app/(app)/workout/exercise-picker.tsx');
  let tree = await world.open();
  world.list(tree).props.onEndReached(); await h.settle(); tree = world.render();
  world.list(tree).props.onEndReached(); await h.settle(); tree = world.render();
  assert.equal(world.list(tree).props.data.length, 130);
  h.byLabel(world.row(tree, 129), 'Exercise 129, Quads, Glutes').props.onPress();
  assert.deepEqual(h.plain(world.mailbox.takePickedExercise()), { id: 'e129', name: 'Exercise 129' });
});

test('picker: the information button shows the details in place without choosing, and coming back keeps the search, the filter and the list', async () => {
  const world = screenWorld('app/(app)/workout/exercise-picker.tsx');
  let tree = await world.open();
  h.byLabel(tree, 'Search exercises').props.onChangeText('exercise 1');
  h.byLabel(world.render(), 'Muscles filter, All Muscles').props.onPress();
  world.render(); await h.settle();
  h.byLabel(world.render(), 'Quads').props.onPress();
  world.render(); await h.settle();
  h.nodes(world.render()).find((node) => /^Show( \d+)? results?$/.test(node.props?.accessibilityLabel ?? '')).props.onPress();
  world.render(); world.clock.fire(); await h.settle();
  tree = world.render();
  const requestsBefore = world.requests.length;
  const listed = ids(world.list(tree).props.data);
  assert.ok(listed.length > 0);

  h.byLabel(world.row(tree, 0), `How to perform ${world.list(tree).props.data[0].name}`).props.onPress();
  world.render(); await h.settle();
  tree = world.render();
  // The details are on screen...
  for (const expected of ['Incline Dumbbell Press', 'Primary muscles', 'Secondary muscles', 'Effectiveness 3 of 5']) {
    assert.ok(h.texts(tree).includes(expected), expected);
  }
  // ...nothing was chosen and the picker did not navigate anywhere (no second native modal)...
  assert.equal(world.mailbox.takePickedExercise(), null);
  assert.equal(world.router.backs, 0);
  assert.deepEqual(world.router.pushes, []);
  // ...and the list underneath is still mounted, only hidden, so its scroll position survives.
  const hiddenList = world.list(tree);
  assert.deepEqual(ids(hiddenList.props.data), listed);
  assert.equal(h.byLabel(tree, 'Search exercises').props.value, 'exercise 1');

  h.byLabel(tree, 'Back to exercises').props.onPress();
  world.render(); world.clock.fire(); await h.settle();
  tree = world.render();
  assert.equal(h.texts(tree).includes('Primary muscles'), false);
  assert.equal(h.byLabel(tree, 'Search exercises').props.value, 'exercise 1');
  assert.ok(h.byLabel(tree, 'Muscles filter, Quads selected'));
  assert.deepEqual(ids(world.list(tree).props.data), listed);
  assert.equal(world.requests.length, requestsBefore, 'coming back does not search again');

  // The row still chooses, once.
  h.byLabel(world.row(tree, 0), `${world.list(tree).props.data[0].name}, Quads, Glutes`).props.onPress();
  assert.equal(world.router.backs, 1);
  assert.equal(h.plain(world.mailbox.takePickedExercise()).id, listed[0]);
});

test('both screens use the one shared browser and keep no list, filter or row of their own', () => {
  for (const file of ['app/(app)/(tabs)/exercises.tsx', 'app/(app)/workout/exercise-picker.tsx']) {
    const source = h.read(file);
    assert.match(source, /import \{ ExerciseBrowser \} from "..\/..\/..\/src\/exercises\/ExerciseBrowser"/, file);
    assert.doesNotMatch(source, /FlatList|TextInput|searchExercises|createExerciseBrowser|CategoryChips|is_compound/, file);
  }
  assert.match(h.read('app/(app)/(tabs)/exercises.tsx'), /mode="browse"/);
  assert.match(h.read('app/(app)/workout/exercise-picker.tsx'), /mode="select"/);
});

// ------------------------------------------------------------------ the detail screen

function detailWorld({ fail = false } = {}) {
  const hooks = h.createHooks();
  let failing = fail;
  const requested = [];
  const globals = { React: reactGlobal };
  const body = h.loadFile('src/exercises/ExerciseDetailBody.tsx', {
    globals,
    modules: {
      react: hooks.hooks,
      'react-native': native(),
      '../api/exercises': { getExercise: async (id) => { requested.push(id); if (failing) throw new Error('offline'); return detail; } },
      './exerciseDetail': { describeExercise },
      '../lightTheme': { light },
    },
  });
  const screen = h.loadFile('app/(app)/exercise/[id].tsx', {
    globals,
    modules: {
      'expo-router': { Stack: { Screen: 'Screen' }, useLocalSearchParams: () => ({ id: 'e1' }) },
      react: hooks.hooks,
      'react-native': native(),
      '../../../src/exercises/ExerciseDetailBody': body,
      '../../../src/lightTheme': { light },
    },
  }).default;
  const render = () => hooks.render(() => h.expand(h.createElement(screen, {})));
  return { render, requested, setFailing: (value) => { failing = value; } };
}

test('exercise detail: loads once, shows the muscles with their ratings and says it is a judgement', async () => {
  const world = detailWorld();
  assert.ok(h.byLabel(world.render(), 'Loading exercise'));
  await h.settle();
  world.render();
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
