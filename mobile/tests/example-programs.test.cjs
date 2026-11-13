/* global __dirname */
// The example-program library on Start Workout: the card list (level and weekly frequency,
// unavailable state), the preview, and "Add to my programs" with its retry safety. The real
// screen files, the real copier and the real stores run against stand-ins for the router, the
// API, secure storage and the native components (tests/support/screen-harness.cjs). What the
// server does (atomic copy, receipts, inactive copy) is proven by backend/tests/test_example_programs.py;
// what a phone does with these screens is on the physical-device checklist.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTs } = require('./support/load-ts.cjs');
const h = require('./support/screen-harness.cjs');

const display = loadTs('src/programs/exampleDisplay.ts');
const libraryModule = loadTs('src/programs/exampleLibrary.ts');
const copierModule = loadTs('src/programs/exampleCopy.ts');
const { createProgramsHub } = loadTs('src/programs/programsHub.ts');
const { createWorkoutStarter } = loadTs('src/workout/workoutStarter.ts');
const { light } = loadTs('src/lightTheme.ts');

const { createExampleLibrary, UNAVAILABLE_MESSAGE } = libraryModule;
const { createExampleCopier } = copierModule;

class ApiError extends Error {
  constructor(status, message = `Failure ${status}`, code) { super(message); this.status = status; this.code = code; }
}

const summary = (over = {}) => ({
  id: 'beginner-full-body-ab', version: 1, level: 'Beginner', name: 'Full Body A/B',
  summary: 'Two whole-body days that alternate, three sessions a week.', sessions_per_week: 3,
  schedule: '3 sessions per week, alternating A and B.', day_count: 2, exercise_count: 14,
  weekly_working_sets: 42, ...over,
});
const SUMMARIES = [
  summary(),
  summary({ id: 'intermediate-upper-lower', level: 'Intermediate', name: 'Upper/Lower', sessions_per_week: 4, weekly_working_sets: 78 }),
  summary({ id: 'advanced-push-pull-legs', level: 'Advanced', name: 'Push/Pull/Legs', sessions_per_week: 6, weekly_working_sets: 108 }),
];
const detail = (over = {}) => ({
  ...summary(),
  sequence: ['Full Body A', 'Full Body B'],
  days: [
    { name: 'Full Body A', day_order: 0, notes: null, exercises: [
      { exercise_name: 'Goblet Squat', exercise_order: 0, target_sets: 2, target_reps_min: 8, target_reps_max: 12, target_rir: 3, notes: null },
      { exercise_name: 'Machine Chest Press', exercise_order: 1, target_sets: 2, target_reps_min: 8, target_reps_max: 12, target_rir: 3, notes: 'Start light.' },
    ] },
    { name: 'Full Body B', day_order: 1, notes: null, exercises: [
      { exercise_name: 'Leg Press', exercise_order: 0, target_sets: 2, target_reps_min: 10, target_reps_max: 15, target_rir: 3, notes: null },
    ] },
  ],
  sources: [
    { title: 'Efficacy of Split Versus Full-Body Resistance Training', citation: 'Ramos-Campo et al., JSCR, 2024', url: 'https://pubmed.ncbi.nlm.nih.gov/38595233/', finding: 'Similar results when volume is equal.' },
    { title: 'Somewhere else', citation: 'Not PubMed', url: 'https://example.com/paper', finding: 'Something.' },
  ],
  authored: ['The exercises and targets are Aures choices.'],
  ...over,
});

// ------------------------------------------------------------------ wording

test('every card and preview line states level and weekly frequency in plain words', () => {
  assert.equal(display.frequencyLabel({ sessions_per_week: 3 }), '3 sessions per week');
  assert.equal(display.frequencyLabel({ sessions_per_week: 1 }), '1 session per week');
  assert.equal(display.cardMeta(SUMMARIES[1]), 'Intermediate · 4 sessions per week');
  assert.equal(display.cardAccessibilityLabel(SUMMARIES[2]), 'Push/Pull/Legs, Advanced, 6 sessions per week');
  assert.equal(display.weeklySetsLabel(SUMMARIES[0]), 'About 42 working sets per week');
});

test('targets read as sets, a rep range and an RIR; a fixed count has no dash', () => {
  const squat = detail().days[0].exercises[0];
  assert.equal(display.targetLabel(squat), '2 sets × 8–12 reps · RIR 3');
  assert.equal(display.targetLabel({ ...squat, target_sets: 1, target_reps_min: 5, target_reps_max: 5 }), '1 set × 5 reps · RIR 3');
  assert.equal(display.targetAccessibilityLabel(squat), 'Goblet Squat, 2 sets, 8–12 reps, reps in reserve 3');
  assert.equal(display.dayTotals(detail().days[0]), '2 exercises · 4 sets');
});

test('only PubMed record links are ever opened', () => {
  assert.equal(display.isSourceUrl('https://pubmed.ncbi.nlm.nih.gov/41843416/'), true);
  for (const url of ['http://pubmed.ncbi.nlm.nih.gov/41843416/', 'https://example.com/x', 'https://pubmed.ncbi.nlm.nih.gov.evil.com/1/', 'javascript:alert(1)', '']) {
    assert.equal(display.isSourceUrl(url), false, url);
  }
});

// -------------------------------------------------------------- the list store

test('the list is not-loaded, then loaded; a failure is "unavailable", a retry recovers, and a failed refresh keeps the list', async () => {
  let fail = true;
  const library = createExampleLibrary({ listExamples: async () => { if (fail) throw new ApiError(404); return SUMMARIES; } });
  assert.equal(library.getSnapshot().examples, null);
  await library.refresh();
  assert.equal(library.getSnapshot().unavailable, true);
  assert.equal(library.getSnapshot().examples, null);
  fail = false;
  await library.refresh();
  assert.equal(library.getSnapshot().examples.length, 3);
  assert.equal(library.getSnapshot().unavailable, false);
  fail = true;
  await library.refresh();
  assert.equal(library.getSnapshot().examples.length, 3, 'the cards already on screen are kept');
  assert.equal(library.getSnapshot().unavailable, true);
});

test('only the newest list request applies, and leaving the screen drops one still on its way', async () => {
  const slow = h.deferred();
  let calls = 0;
  const library = createExampleLibrary({ listExamples: () => (++calls === 1 ? slow.promise : Promise.resolve([SUMMARIES[2]])) });
  const stale = library.refresh();
  await library.refresh();
  slow.resolve([SUMMARIES[0]]);
  await stale;
  assert.deepEqual(Array.from(library.getSnapshot().examples, (e) => e.id), ['advanced-push-pull-legs']);

  const late = h.deferred();
  const leaving = createExampleLibrary({ listExamples: () => late.promise });
  const pending = leaving.refresh();
  leaving.cancel();
  late.resolve(SUMMARIES);
  await pending;
  assert.equal(leaving.getSnapshot().examples, null);
  assert.equal(leaving.getSnapshot().loading, false);
});

// ------------------------------------------------------------ the copy request

function memoryStore({ failSet = false } = {}) {
  const values = new Map();
  return {
    values,
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => { if (failSet) throw new Error('keychain unavailable'); values.set(key, value); },
    remove: async (key) => { values.delete(key); },
  };
}
let serial = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`;
const BODY = { example_id: 'beginner-full-body-ab', version: 1 };

function copierWorld({ store = memoryStore(), copy, current = () => true } = {}) {
  const sent = [];
  const copier = createExampleCopier({
    store, newRequestId: nextId, isCurrent: current,
    copy: async (requestId, body) => { sent.push({ requestId, body: h.plain(body) }); return copy ? copy(requestId, body, sent.length) : { id: 'program-1' }; },
  });
  return { store, sent, copier };
}

test('the request id is saved before anything is sent, and removed once the copy is confirmed', async () => {
  let savedBeforeSend = null;
  const world = copierWorld({ copy: async () => { savedBeforeSend = world.store.values.size; return { id: 'p' }; } });
  const outcome = await world.copier('user-a', BODY);
  assert.deepEqual(h.plain(outcome), { kind: 'copied', programId: 'p' });
  assert.equal(savedBeforeSend, 1, 'the id was already on the device when the request went out');
  assert.equal(world.store.values.size, 0);
});

test('a storage failure sends nothing at all', async () => {
  const world = copierWorld({ store: memoryStore({ failSet: true }) });
  const outcome = await world.copier('user-a', BODY);
  assert.equal(outcome.kind, 'failed');
  assert.equal(outcome.retryable, true);
  assert.equal(world.sent.length, 0);
});

test('a double tap sends one request; the second is ignored and does not touch the busy state', async () => {
  const slow = h.deferred();
  const world = copierWorld({ copy: () => slow.promise });
  let busy = 0;
  const first = world.copier('user-a', BODY, () => busy++);
  assert.deepEqual(h.plain(await world.copier('user-a', BODY, () => busy++)), { kind: 'ignored' });
  assert.equal(busy, 1);
  slow.resolve({ id: 'program-9' });
  assert.equal((await first).kind, 'copied');
  assert.equal(world.sent.length, 1);
});

test('a lost response keeps the id, and the retry (even after an app restart) sends the SAME id', async () => {
  const store = memoryStore();
  let failing = true;
  const run = () => copierWorld({ store, copy: async () => { if (failing) throw new ApiError(0, 'Network request failed'); return { id: 'program-1' }; } });
  const first = run();
  const lost = await first.copier('user-a', BODY);
  assert.equal(lost.kind, 'failed');
  assert.equal(lost.retryable, true);
  assert.match(lost.message, /will not create a second copy/);
  assert.equal(store.values.size, 1, 'the unresolved attempt is remembered');

  failing = false;
  const afterRestart = run(); // a fresh copier over the same device storage
  const retry = await afterRestart.copier('user-a', BODY);
  assert.deepEqual(h.plain(retry), { kind: 'copied', programId: 'program-1' });
  assert.equal(afterRestart.sent[0].requestId, first.sent[0].requestId);
  assert.equal(store.values.size, 0);
});

test('server errors and sign-in problems also keep the id: whether the server committed is unknown', async () => {
  for (const status of [500, 502, 503, 401, 429]) {
    const world = copierWorld({ copy: async () => { throw new ApiError(status); } });
    const outcome = await world.copier('user-a', BODY);
    assert.equal(outcome.retryable, true, String(status));
    assert.equal(world.store.values.size, 1, String(status));
  }
});

test('when the server refused and created nothing, the id is spent and the next tap starts fresh', async () => {
  for (const [status, code] of [[409, 'example_unavailable'], [503, 'example_unavailable'], [404, undefined], [422, undefined], [409, 'example_request_mismatch']]) {
    const world = copierWorld({ copy: async () => { throw new ApiError(status, 'No.', code); } });
    const outcome = await world.copier('user-a', BODY);
    assert.equal(outcome.kind, 'failed', `${status} ${code}`);
    assert.equal(outcome.retryable, false);
    assert.equal(world.store.values.size, 0);
  }
});

test('a changed example is reported as stale (reopen the preview) and spends the id', async () => {
  const world = copierWorld({ copy: async () => { throw new ApiError(409, 'This example program was updated.', 'example_version_changed'); } });
  const outcome = await world.copier('user-a', BODY);
  assert.deepEqual(h.plain(outcome), { kind: 'stale', message: 'This example program was updated.' });
  assert.equal(world.store.values.size, 0);
});

test('a copy that was made and then deleted is not resurrected: the tap becomes a brand new request', async () => {
  const world = copierWorld({
    copy: async (requestId, body, n) => { if (n === 1) throw new ApiError(409, 'Deleted.', 'example_copy_deleted'); return { id: 'program-2' }; },
  });
  const outcome = await world.copier('user-a', BODY);
  assert.deepEqual(h.plain(outcome), { kind: 'copied', programId: 'program-2' });
  assert.equal(world.sent.length, 2);
  assert.notEqual(world.sent[0].requestId, world.sent[1].requestId);
});

test('pending state is per account and per example version', async () => {
  const store = memoryStore();
  const lose = () => copierWorld({ store, copy: async () => { throw new ApiError(0); } });
  await lose().copier('user-a', BODY);
  await lose().copier('user-b', BODY);
  await lose().copier('user-a', { ...BODY, version: 2 });
  await lose().copier('user-a', { example_id: 'advanced-push-pull-legs', version: 1 });
  assert.equal(store.values.size, 4);
  const sentIds = new Set(store.values.values());
  assert.equal(sentIds.size, 4, 'four different attempts, four different ids');
  // Account B resumes its own attempt and never reuses account A's id.
  const idOf = (who) => [...store.values.entries()].find(([key]) => key.includes(`.${who}.beginner-full-body-ab.1`))[1];
  const bPending = idOf('user-b');
  const aPending = idOf('user-a');
  assert.notEqual(bPending, aPending);
  const b = copierWorld({ store });
  await b.copier('user-b', BODY);
  assert.equal(b.sent[0].requestId, bPending);
});

test('an answer that arrives after the signed-in account changed is dropped, and stays with the old account', async () => {
  let signedIn = 'user-a';
  const slow = h.deferred();
  const world = copierWorld({ copy: () => slow.promise, current: (userId) => userId === signedIn });
  const running = world.copier('user-a', BODY);
  await h.settle();
  signedIn = 'user-b';
  slow.reject(new ApiError(0));
  assert.deepEqual(h.plain(await running), { kind: 'abandoned' });
  const [key] = [...world.store.values.keys()];
  assert.match(key, /\.user-a\./, 'the unresolved attempt belongs to account A only');
  const b = copierWorld({ store: world.store, current: (userId) => userId === signedIn });
  assert.equal((await b.copier('user-b', BODY)).kind, 'copied');
  assert.notEqual(b.sent[0].requestId, [...world.store.values.values()][0]);
});

// ----------------------------------------------------- the Start Workout cards

function hubWorld({ examples = SUMMARIES, examplesFail = false, programs = [{ id: 'mine', name: 'My own', is_active: true }] } = {}) {
  const hooks = h.createHooks();
  const pushes = [];
  const spies = { exampleList: 0, exampleCopy: 0 };
  const failing = { value: examplesFail };
  const screen = h.loadFile('app/(app)/(tabs)/index.tsx', {
    globals: { React: { createElement: h.createElement } },
    modules: {
      '@expo/vector-icons': { Ionicons: 'Ionicons' },
      'expo-router': { useFocusEffect: hooks.hooks.useFocusEffect, useRouter: () => ({ push: (href) => pushes.push(h.plain(href)) }) },
      react: hooks.hooks,
      'react-native': h.reactNative(),
      'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
      '../../../src/api/examplePrograms': {
        listExamplePrograms: async () => { spies.exampleList++; if (failing.value) throw new ApiError(404); return examples; },
        copyExampleProgram: async () => { spies.exampleCopy++; return { id: 'x' }; },
      },
      '../../../src/api/programs': {
        listPrograms: async () => programs,
        getProgram: async (id) => ({ ...programs.find((p) => p.id === id), notes: null, templates: [] }),
        startWorkoutFromTemplate: async () => ({}), activateProgram: () => {},
      },
      '../../../src/api/readiness': { getTodayReadiness: async () => ({ id: 1 }) },
      '../../../src/api/workouts': { startWorkout: async () => ({ id: 'w' }), getWorkout: async () => ({}), getActiveWorkout: async () => null },
      '../../../src/lightTheme': { light },
      '../../../src/navigation/TabTopBar': { TabTopBar: 'TabTopBar' },
      '../../../src/programs/exampleDisplay': display,
      '../../../src/programs/exampleLibrary': libraryModule,
      '../../../src/programs/programsHub': { createProgramsHub },
      '../../../src/workout/activeWorkout': { clearActiveWorkout: async () => {}, getActiveWorkout: async () => null, setActiveWorkout: async () => {} },
      '../../../src/workout/readinessPreference': { isReadinessCheckinEnabled: async () => false },
      '../../../src/workout/resolveActiveWorkout': { resolveActiveWorkoutId: async () => null },
      '../../../src/workout/workoutStarter': { createWorkoutStarter },
    },
  }).default;
  const world = {
    pushes, spies, failing,
    render: () => hooks.render(screen),
    async show() { world.render(); hooks.focus(); await h.settle(); return world.render(); },
    list: (tree) => h.nodes(tree).find((node) => node.type === 'FlatList'),
    header: (tree) => world.list(tree).props.ListHeaderComponent,
    footer: (tree) => h.expand(world.list(tree).props.ListFooterComponent),
  };
  return world;
}
const labelsOf = (tree) => h.nodes(tree).filter((n) => n.type === 'Pressable' && n.props.accessibilityLabel).map((n) => n.props.accessibilityLabel);

test('Example programs come after My programs, as a footer; the primary action and Create program stay where they were', async () => {
  const world = hubWorld();
  const tree = await world.show();
  const header = world.header(tree);
  assert.deepEqual(labelsOf(header).slice(0, 2), ['Start an Empty Workout', 'Create program']);
  assert.ok(h.texts(header).includes('My programs'));
  assert.ok(!h.texts(header).includes('Example programs'), 'the examples are not in the header, above the programs');
  assert.equal(world.list(tree).props.data.length, 1, 'the programs list is the list; the examples follow it');
  assert.ok(h.texts(world.footer(tree)).includes('Example programs'));
});

test('three cards, each with its level and weekly frequency, in the catalogue order', async () => {
  const world = hubWorld();
  const footer = world.footer(await world.show());
  assert.deepEqual(labelsOf(footer), [
    'Full Body A/B, Beginner, 3 sessions per week',
    'Upper/Lower, Intermediate, 4 sessions per week',
    'Push/Pull/Legs, Advanced, 6 sessions per week',
  ]);
  const shown = h.texts(footer);
  for (const meta of ['Beginner · 3 sessions per week', 'Intermediate · 4 sessions per week', 'Advanced · 6 sessions per week']) {
    assert.ok(shown.includes(meta), meta);
  }
});

test('tapping a card opens its preview once and copies nothing: browsing creates no records', async () => {
  const world = hubWorld();
  const footer = world.footer(await world.show());
  const card = h.byLabel(footer, 'Upper/Lower, Intermediate, 4 sessions per week');
  card.props.onPress();
  card.props.onPress(); // a double tap
  assert.deepEqual(world.pushes, [{ pathname: '/example-program/[id]', params: { id: 'intermediate-upper-lower' } }]);
  assert.equal(world.spies.exampleCopy, 0);
});

test('an unavailable example service shows a message and a retry inside its section; My programs and the actions keep working', async () => {
  const world = hubWorld({ examplesFail: true });
  const tree = await world.show();
  const footer = world.footer(tree);
  assert.ok(h.texts(footer).includes(UNAVAILABLE_MESSAGE));
  assert.deepEqual(labelsOf(footer), ['Try loading example programs again']);
  // Nothing above it noticed.
  assert.deepEqual(labelsOf(world.header(tree)).slice(0, 2), ['Start an Empty Workout', 'Create program']);
  assert.equal(world.list(tree).props.data.length, 1);
  assert.equal(h.texts(world.header(tree)).some((t) => /Could not/.test(t)), false);

  world.failing.value = false;
  h.byLabel(footer, 'Try loading example programs again').props.onPress();
  await h.settle();
  assert.equal(labelsOf(world.footer(world.render())).length, 3);
});

// ----------------------------------------------------------------- the preview

function previewWorld({ example = detail(), getExample, copy, user = { id: 'user-a' }, store = memoryStore() } = {}) {
  const hooks = h.createHooks();
  const replaced = [];
  const opened = [];
  const calls = { get: 0, copy: [] };
  const auth = { user };
  const screen = h.loadFile('app/(app)/example-program/[id].tsx', {
    globals: { React: { createElement: h.createElement, Fragment: 'Fragment' } },
    modules: {
      '@expo/vector-icons': { Ionicons: 'Ionicons' },
      'expo-crypto': { randomUUID: nextId },
      'expo-router': {
        Stack: { Screen: 'StackScreen' }, useLocalSearchParams: () => ({ id: 'beginner-full-body-ab' }),
        useRouter: () => ({ replace: (href) => replaced.push(href), push: () => {} }),
      },
      'expo-secure-store': { getItemAsync: store.get, setItemAsync: store.set, deleteItemAsync: store.remove },
      'expo-web-browser': { openBrowserAsync: async (url) => { opened.push(url); } },
      react: hooks.hooks,
      'react-native': h.reactNative(),
      'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
      '../../../src/api/examplePrograms': {
        getExampleProgram: async () => { calls.get++; return getExample ? getExample(calls.get) : example; },
        copyExampleProgram: async (requestId, body) => { calls.copy.push({ requestId, body: h.plain(body) }); return copy ? copy(requestId, body, calls.copy.length) : { id: 'new-program' }; },
      },
      '../../../src/auth/AuthContext': { useAuth: () => ({ user: auth.user }) },
      '../../../src/lightTheme': { light },
      '../../../src/programs/exampleCopy': copierModule,
      '../../../src/programs/exampleDisplay': display,
    },
  }).default;
  const world = {
    hooks, replaced, opened, calls, auth, store,
    render: () => h.expand(hooks.render(screen)),
    async show() { world.render(); await h.settle(); return world.render(); },
    add: (tree) => h.byLabel(tree, 'Add to my programs'),
  };
  return world;
}

test('the preview shows level, frequency, the schedule, ordered days with targets, and the sources', async () => {
  const world = previewWorld();
  const tree = await world.show();
  const shown = h.texts(tree);
  assert.ok(shown.includes('Full Body A/B'));
  assert.ok(shown.includes('Beginner · 3 sessions per week'));
  assert.ok(shown.includes('3 sessions per week, alternating A and B.'));
  assert.ok(shown.some((t) => t.startsWith('About 42 working sets per week')));
  assert.ok(shown.indexOf('Full Body A') < shown.indexOf('Full Body B'));
  assert.deepEqual(h.nodes(tree).filter((n) => /^Goblet Squat, /.test(n.props?.accessibilityLabel ?? '')).map((n) => n.props.accessibilityLabel),
    ['Goblet Squat, 2 sets, 8–12 reps, reps in reserve 3']);
  assert.ok(shown.includes('2 sets × 8–12 reps · RIR 3'));
  assert.ok(shown.includes('Start light.'));
  assert.ok(shown.indexOf('What the sources found') > shown.indexOf('Full Body B'));
  assert.ok(shown.indexOf('What Aures chose') > shown.indexOf('What the sources found'), 'findings and Aures\'s own choices are separate sections');
  assert.ok(shown.includes('The exercises and targets are Aures choices.'));
  assert.equal(world.calls.copy.length, 0, 'looking creates nothing');
});

test('a source opens on PubMed; a link that is not a PubMed record is not offered', async () => {
  const world = previewWorld();
  const tree = await world.show();
  const links = h.nodes(tree).filter((n) => n.props?.accessibilityRole === 'link');
  assert.deepEqual(links.map((n) => n.props.accessibilityLabel), ['Open on PubMed: Ramos-Campo et al., JSCR, 2024']);
  links[0].props.onPress();
  await h.settle();
  assert.deepEqual(world.opened, ['https://pubmed.ncbi.nlm.nih.gov/38595233/']);
});

test('Add to my programs asks for the previewed version, then opens the existing program screen in place of the preview', async () => {
  const world = previewWorld();
  const tree = await world.show();
  world.add(tree).props.onPress();
  await h.settle();
  assert.deepEqual(world.calls.copy.map((c) => c.body), [{ example_id: 'beginner-full-body-ab', version: 1 }]);
  assert.deepEqual(world.replaced, ['/program/new-program']);
  assert.equal(world.store.values.size, 0);
});

test('a double tap on Add makes one request, and the button says it is busy meanwhile', async () => {
  const slow = h.deferred();
  const world = previewWorld({ copy: () => slow.promise });
  const tree = await world.show();
  world.add(tree).props.onPress();
  world.add(tree).props.onPress();
  await h.settle();
  assert.equal(world.calls.copy.length, 1);
  assert.equal(world.add(world.render()).props.accessibilityState.busy, true);
  slow.resolve({ id: 'p1' });
  await h.settle();
  assert.deepEqual(world.replaced, ['/program/p1']);
});

test('after a lost response the next tap resends the same request id and still ends with one program', async () => {
  const world = previewWorld({ copy: async (id, body, n) => { if (n === 1) throw new ApiError(0, 'Network request failed'); return { id: 'same-program' }; } });
  let tree = await world.show();
  world.add(tree).props.onPress();
  await h.settle();
  tree = world.render();
  assert.ok(h.texts(tree).some((t) => /will not create a second copy/.test(t)), 'the user is told a retry is safe');
  assert.equal(world.add(tree).props.accessibilityState.busy, false, 'the button is usable again');
  assert.deepEqual(world.replaced, []);
  world.add(tree).props.onPress();
  await h.settle();
  assert.equal(world.calls.copy.length, 2);
  assert.equal(world.calls.copy[0].requestId, world.calls.copy[1].requestId);
  assert.deepEqual(world.replaced, ['/program/same-program']);
});

test('a refused example (changed since it was previewed) reloads the preview and says why', async () => {
  const world = previewWorld({
    getExample: (n) => detail({ version: n }),
    copy: async () => { throw new ApiError(409, 'This example program was updated since you opened it.', 'example_version_changed'); },
  });
  let tree = await world.show();
  world.add(tree).props.onPress();
  await h.settle();
  tree = await world.show();
  assert.equal(world.calls.get, 2, 'the preview was fetched again');
  assert.ok(h.texts(tree).includes('This example program was updated since you opened it.'));
  assert.deepEqual(world.replaced, []);
});

test('an answer for an account that is no longer signed in neither opens a program nor shows an error', async () => {
  const slow = h.deferred();
  const world = previewWorld({ copy: () => slow.promise });
  let tree = await world.show();
  world.add(tree).props.onPress();
  await h.settle();
  world.auth.user = { id: 'user-b' };
  world.render(); // the new session is what the screen now knows
  slow.resolve({ id: 'a-private-program' });
  await h.settle();
  tree = world.render();
  assert.deepEqual(world.replaced, [], 'the old account\'s program must not open in the new session');
  assert.ok(![...world.store.values.keys()].some((key) => key.includes('user-b')));
});

test('the preview says when it cannot be loaded, offers a retry, and tells a removed example apart', async () => {
  let attempt = 0;
  const world = previewWorld({ getExample: async () => { if (++attempt === 1) throw new ApiError(404); return detail(); } });
  world.render();
  await h.settle();
  let tree = world.render();
  assert.ok(h.texts(tree).includes('This example program is not available any more.'));
  h.byLabel(tree, 'Try loading the example again').props.onPress();
  world.render();
  await h.settle();
  tree = world.render();
  assert.ok(world.add(tree));
});
