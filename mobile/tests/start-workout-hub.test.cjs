/* global __dirname */
// Start Workout: the workout and program hub. Starting a workout (and the optional readiness
// check-in), the programs list, creating a program, and the routes that used to point at the
// Programs tab. The real screen files are driven with stand-ins for the router, the API and the
// native components (see tests/support/screen-harness.cjs): state, effects and handlers as written,
// not native layout, the keyboard or the navigation stack.
const assert = require('node:assert/strict');
const { readdirSync, statSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadTs } = require('./support/load-ts.cjs');
const h = require('./support/screen-harness.cjs');

const root = path.resolve(__dirname, '..');
const { createWorkoutStarter } = loadTs('src/workout/workoutStarter.ts');
const { createProgramsHub } = loadTs('src/programs/programsHub.ts');
const { createProgramCreator } = loadTs('src/programs/programActions.ts');
const exampleDisplay = loadTs('src/programs/exampleDisplay.ts');
const exampleLibraryModule = loadTs('src/programs/exampleLibrary.ts');
const { light } = loadTs('src/lightTheme.ts');

// ------------------------------------------------------------- starting a workout

function starterWorld(overrides = {}) {
  const calls = { empty: 0, template: [], active: [], checkinLookups: 0 };
  const deps = {
    isCheckinEnabled: async () => false,
    getTodayReadiness: async () => { calls.checkinLookups++; return { id: 'today' }; },
    startEmptyWorkout: async () => { calls.empty++; return { id: 'empty-1' }; },
    startFromTemplate: async (templateId) => { calls.template.push(templateId); return { workout_id: `from-${templateId}`, template_id: templateId, targets: [] }; },
    setActiveWorkout: async (id) => { calls.active.push(id); },
    ...overrides,
  };
  return { calls, start: createWorkoutStarter(deps) };
}

test('an empty workout starts, becomes the active one, and is reported as started', async () => {
  const { calls, start } = starterWorld();
  assert.deepEqual(h.plain(await start()), { kind: 'started', workoutId: 'empty-1' });
  assert.equal(calls.empty, 1);
  assert.deepEqual(calls.active, ['empty-1']);
  assert.deepEqual(calls.template, []);
});

test('a template start goes through the template endpoint (which captures the starting plan), not an empty start', async () => {
  const { calls, start } = starterWorld();
  assert.deepEqual(h.plain(await start('t-push')), { kind: 'started', workoutId: 'from-t-push' });
  assert.deepEqual(calls.template, ['t-push']);
  assert.equal(calls.empty, 0);
  assert.deepEqual(calls.active, ['from-t-push']);
});

test('with the readiness check-in on and nothing logged today, nothing is started: the check-in opens, carrying the template', async () => {
  const world = starterWorld({ isCheckinEnabled: async () => true, getTodayReadiness: async () => ({ id: null }) });
  assert.deepEqual(h.plain(await world.start()), { kind: 'checkin' });
  assert.deepEqual(h.plain(await world.start('t-push')), { kind: 'checkin', templateId: 't-push' });
  assert.equal(world.calls.empty, 0);
  assert.deepEqual(world.calls.template, []);
  assert.deepEqual(world.calls.active, []);
});

test('with a check-in already logged today, or the check-in off, the workout starts straight away', async () => {
  const logged = starterWorld({ isCheckinEnabled: async () => true, getTodayReadiness: async () => ({ id: 42 }) });
  assert.equal((await logged.start('t')).kind, 'started');
  const off = starterWorld({ isCheckinEnabled: async () => false });
  assert.equal((await off.start()).kind, 'started');
  assert.equal(off.calls.checkinLookups, 0, 'the lookup is not even made when the check-in is off');
});

test('a failing check-in lookup fails open: it is never the reason a workout cannot start', async () => {
  const lookup = starterWorld({ isCheckinEnabled: async () => true, getTodayReadiness: async () => { throw new Error('offline'); } });
  assert.equal((await lookup.start()).kind, 'started');
  const preference = starterWorld({ isCheckinEnabled: async () => { throw new Error('keychain'); } });
  assert.equal((await preference.start('t')).kind, 'started');
});

test('a second tap while a start is running is ignored; afterwards a new start is allowed', async () => {
  const slow = h.deferred();
  const { calls, start } = starterWorld({ startEmptyWorkout: async () => { calls.empty++; await slow.promise; return { id: 'empty-1' }; } });
  let busy = 0;
  const first = start(undefined, () => busy++);
  assert.deepEqual(h.plain(await start()), { kind: 'ignored' });
  assert.deepEqual(h.plain(await start('t')), { kind: 'ignored' });
  assert.equal(calls.empty, 1);
  assert.equal(busy, 1, 'only the start that runs owns the busy state');
  slow.resolve();
  assert.equal((await first).kind, 'started');
  assert.equal((await start('t')).kind, 'started');
});

test('a failed start says so, starts nothing locally, and releases the lock for a retry', async () => {
  let fail = true;
  const { calls, start } = starterWorld({ startEmptyWorkout: async () => { if (fail) throw new Error('Server unavailable'); return { id: 'empty-2' }; } });
  assert.deepEqual(h.plain(await start()), { kind: 'failed', message: 'Server unavailable' });
  assert.deepEqual(calls.active, []);
  fail = false;
  assert.equal((await start()).kind, 'started');
});

test('the workout started on the server is opened even if the device pointer could not be written', async () => {
  const { start } = starterWorld({ setActiveWorkout: async () => { throw new Error('Keychain unavailable'); } });
  // The server session exists and is recovered as "active" on the next visit; the screen must not pretend it failed.
  assert.deepEqual(h.plain(await start()), { kind: 'started', workoutId: 'empty-1' });
});

// ------------------------------------------------------------------- the programs

const program = (id, active = false) => ({ id, name: `Program ${id}`, is_active: active });

test('every program the server lists stays reachable, in the server order, and the active one is flagged', async () => {
  const programs = Array.from({ length: 37 }, (_, n) => program(`p${n}`, n === 5));
  const detailCalls = [];
  const hub = createProgramsHub({
    listPrograms: async () => programs,
    getProgram: async (id) => { detailCalls.push(id); return { ...program(id, true), notes: null, templates: [{ id: 't1', name: 'Push' }] }; },
  });
  assert.equal(hub.getSnapshot().programs, null, 'not loaded yet is not the same as no programs');
  await hub.refresh();
  const state = hub.getSnapshot();
  assert.equal(state.programs.length, 37);
  assert.deepEqual(Array.from(state.programs, (p) => p.id), programs.map((p) => p.id));
  assert.deepEqual(detailCalls, ['p5']); // only the active program's templates are fetched
  assert.equal(state.activeProgram.id, 'p5');
  assert.equal(state.error, null);
  assert.equal(state.loading, false);
});

test('a failed first load reports the error (programs stay null); a failed refresh keeps the list on screen', async () => {
  let failing = true;
  const hub = createProgramsHub({
    listPrograms: async () => { if (failing) throw new Error('Offline'); return [program('a'), program('b')]; },
    getProgram: async (id) => ({ ...program(id), notes: null, templates: [] }),
  });
  await hub.refresh();
  assert.equal(hub.getSnapshot().programs, null);
  assert.equal(hub.getSnapshot().error, 'Offline');
  failing = false;
  await hub.refresh();
  assert.equal(hub.getSnapshot().programs.length, 2);
  assert.equal(hub.getSnapshot().error, null);
  failing = true;
  await hub.refresh();
  assert.equal(hub.getSnapshot().programs.length, 2, 'the list already on screen is kept');
  assert.equal(hub.getSnapshot().error, 'Offline');
});

test("a failing active-program lookup never takes the list down with it", async () => {
  const hub = createProgramsHub({
    listPrograms: async () => [program('a', true), program('b')],
    getProgram: async () => { throw new Error('detail failed'); },
  });
  await hub.refresh();
  assert.equal(hub.getSnapshot().programs.length, 2);
  assert.equal(hub.getSnapshot().activeProgram, null);
  assert.equal(hub.getSnapshot().error, null);
});

test('only the newest refresh may apply; leaving the screen drops an answer still on its way', async () => {
  const slow = h.deferred();
  let calls = 0;
  const hub = createProgramsHub({
    listPrograms: () => (++calls === 1 ? slow.promise : Promise.resolve([program('new')])),
    getProgram: async (id) => ({ ...program(id), notes: null, templates: [] }),
  });
  const stale = hub.refresh();
  await hub.refresh();
  slow.resolve([program('old-1'), program('old-2')]);
  await stale;
  assert.deepEqual(Array.from(hub.getSnapshot().programs, (p) => p.id), ['new']);

  const late = h.deferred();
  const leaving = createProgramsHub({ listPrograms: () => late.promise, getProgram: async () => ({}) });
  const pending = leaving.refresh();
  leaving.cancel();
  late.resolve([program('x')]);
  await pending;
  assert.equal(leaving.getSnapshot().programs, null);
  assert.equal(leaving.getSnapshot().loading, false);
});

// ------------------------------------------------------------ the real hub screen

function hubWorld({
  programs = [], details = {}, activeId = null, checkinEnabled = false, today = { id: 1 },
  listFails = false, startEmpty = async () => ({ id: 'empty-1' }),
  examples = [], examplesFail = false,
} = {}) {
  const hooks = h.createHooks();
  const pushes = [];
  const spies = { active: [], template: [], empty: 0, activate: 0, listCalls: 0, exampleList: 0, exampleCopy: 0 };
  const router = { push: (href) => pushes.push(h.plain(href)) };
  const screen = h.loadFile('app/(app)/(tabs)/index.tsx', {
    globals: { React: { createElement: h.createElement } },
    modules: {
      '@expo/vector-icons': { Ionicons: 'Ionicons' },
      'expo-router': { useFocusEffect: hooks.hooks.useFocusEffect, useRouter: () => router },
      react: hooks.hooks,
      'react-native': h.reactNative(),
      'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
      '../../../src/api/programs': {
        listPrograms: async () => { spies.listCalls++; if (listFails) throw new Error('Offline'); return programs; },
        getProgram: async (id) => details[id],
        startWorkoutFromTemplate: async (templateId) => { spies.template.push(templateId); return { workout_id: `from-${templateId}` }; },
        activateProgram: () => { spies.activate++; },
      },
      '../../../src/api/examplePrograms': {
        listExamplePrograms: async () => { spies.exampleList++; if (examplesFail) throw new Error('404'); return examples; },
        copyExampleProgram: async () => { spies.exampleCopy++; return { id: 'copy' }; },
      },
      '../../../src/api/readiness': { getTodayReadiness: async () => today },
      '../../../src/api/workouts': {
        startWorkout: async () => { spies.empty++; return startEmpty(); },
        getWorkout: async () => ({}), getActiveWorkout: async () => null,
      },
      '../../../src/lightTheme': { light },
      '../../../src/navigation/TabTopBar': { TabTopBar: 'TabTopBar' },
      '../../../src/programs/exampleDisplay': exampleDisplay,
      '../../../src/programs/exampleLibrary': exampleLibraryModule,
      '../../../src/programs/programsHub': { createProgramsHub },
      '../../../src/workout/activeWorkout': { clearActiveWorkout: async () => {}, getActiveWorkout: async () => null, setActiveWorkout: async (id) => { spies.active.push(id); } },
      '../../../src/workout/readinessPreference': { isReadinessCheckinEnabled: async () => checkinEnabled },
      '../../../src/workout/resolveActiveWorkout': { resolveActiveWorkoutId: async () => activeId },
      '../../../src/workout/workoutStarter': { createWorkoutStarter },
    },
  }).default;
  const world = {
    hooks, pushes, spies,
    render: () => hooks.render(screen),
    async show() { world.render(); hooks.focus(); await h.settle(); return world.render(); },
    list: (tree) => h.nodes(tree).find((node) => node.type === 'FlatList'),
    header: (tree) => world.list(tree).props.ListHeaderComponent,
    topBar: (tree) => h.nodes(tree).find((node) => node.type === 'TabTopBar'),
    footer: (tree) => world.list(tree).props.ListFooterComponent,
    sheet: (tree) => h.nodes(tree).find((node) => node.type === 'Modal'),
  };
  return world;
}

/** The labelled buttons of a header, in reading order. */
const labels = (tree) => h.nodes(tree).filter((node) => node.type === 'Pressable' && node.props.accessibilityLabel)
  .map((node) => node.props.accessibilityLabel);

test('Start Workout: the primary action is first, Create program is immediately below it, then My programs', async () => {
  const world = hubWorld({ programs: [program('a')] });
  const tree = await world.show();
  assert.equal(world.topBar(tree).props.title, 'Start Workout');
  const header = world.header(tree);
  assert.deepEqual(labels(header).slice(0, 2), ['Start an Empty Workout', 'Create program']);
  const order = h.nodes(header).map((node) => node.props?.accessibilityLabel ?? (node.type === 'Text' ? h.texts(node)[0] : undefined));
  assert.ok(order.indexOf('Create program') > order.indexOf('Start an Empty Workout'));
  assert.ok(order.indexOf('My programs') > order.indexOf('Create program'));
  // Nothing sits between the two actions: the only thing that may appear there is a start error.
  assert.equal(h.nodes(header).filter((node) => node.type === 'Pressable').indexOf(h.byLabel(header, 'Create program')) -
    h.nodes(header).filter((node) => node.type === 'Pressable').indexOf(h.byLabel(header, 'Start an Empty Workout')), 1);
});

test('Start Workout: while a session is active the primary action is Resume workout, and a second session is not offered', async () => {
  const world = hubWorld({
    programs: [program('a', true)], activeId: 'live-1',
    details: { a: { ...program('a', true), notes: null, templates: [{ id: 't1', name: 'Push' }] } },
  });
  const tree = await world.show();
  const header = world.header(tree);
  assert.deepEqual(labels(header).slice(0, 2), ['Resume workout', 'Create program']);
  assert.equal(h.byLabel(header, 'Start an Empty Workout'), undefined);
  assert.equal(labels(header).some((label) => label.startsWith('Start from a template')), false);
  h.byLabel(header, 'Resume workout').props.onPress();
  h.byLabel(header, 'Resume workout').props.onPress(); // double tap
  assert.deepEqual(world.pushes, ['/workout/live-1']);
  assert.ok(h.texts(header).includes('Workout in progress'));
});

test('Start an Empty Workout starts one session, makes it the active one and opens it; a double tap makes only one', async () => {
  const slow = h.deferred();
  const world = hubWorld({ startEmpty: () => slow.promise });
  let tree = await world.show();
  const press = () => h.byLabel(world.header(world.render()), 'Start an Empty Workout').props.onPress();
  press(); press(); press();
  await h.settle();
  assert.equal(world.spies.empty, 1);
  assert.equal(h.byLabel(world.header(world.render()), 'Start an Empty Workout').props.accessibilityState.busy, true);
  slow.resolve({ id: 'empty-9' });
  await h.settle();
  tree = world.render();
  assert.deepEqual(world.spies.active, ['empty-9']);
  assert.deepEqual(world.pushes, ['/workout/empty-9']);
  assert.equal(h.byLabel(world.header(tree), 'Start an Empty Workout').props.accessibilityState.busy, false);
});

test('a failed start shows why and leaves the button usable', async () => {
  let fail = true;
  const world = hubWorld({ startEmpty: async () => { if (fail) throw new Error('Server unavailable'); return { id: 'empty-3' }; } });
  await world.show();
  h.byLabel(world.header(world.render()), 'Start an Empty Workout').props.onPress();
  await h.settle();
  const header = world.header(world.render());
  assert.ok(h.texts(header).includes('Server unavailable'));
  assert.deepEqual(world.pushes, []);
  fail = false;
  h.byLabel(header, 'Start an Empty Workout').props.onPress();
  await h.settle();
  assert.deepEqual(world.pushes, ['/workout/empty-3']);
});

test('Start from a template: the sheet lists the active program\'s templates and starts the chosen one from its snapshot', async () => {
  const world = hubWorld({
    programs: [program('a', true), program('b')],
    details: { a: { ...program('a', true), notes: null, templates: [{ id: 't-push', name: 'Push' }, { id: 't-pull', name: 'Pull' }] } },
  });
  let tree = await world.show();
  const open = h.byLabel(world.header(tree), 'Start from a template in Program a');
  assert.ok(open);
  open.props.onPress();
  tree = world.render();
  assert.equal(world.sheet(tree).props.visible, true);
  const choose = h.byLabel(world.sheet(tree), 'Pull');
  choose.props.onPress();
  await h.settle();
  assert.deepEqual(world.spies.template, ['t-pull']);
  assert.equal(world.spies.empty, 0);
  assert.deepEqual(world.spies.active, ['from-t-pull']);
  assert.deepEqual(world.pushes, ['/workout/from-t-pull']);
  assert.equal(world.sheet(world.render()).props.visible, false);
});

test('the optional readiness check-in still comes first, for an empty start and for a template start', async () => {
  const world = hubWorld({
    checkinEnabled: true, today: { id: null }, programs: [program('a', true)],
    details: { a: { ...program('a', true), notes: null, templates: [{ id: 't-push', name: 'Push' }] } },
  });
  let tree = await world.show();
  h.byLabel(world.header(tree), 'Start an Empty Workout').props.onPress();
  await h.settle();
  assert.deepEqual(world.pushes, [{ pathname: '/workout/checkin', params: {} }]);

  h.byLabel(world.header(world.render()), 'Start from a template in Program a').props.onPress();
  h.byLabel(world.sheet(world.render()), 'Push').props.onPress();
  await h.settle();
  assert.deepEqual(world.pushes[1], { pathname: '/workout/checkin', params: { templateId: 't-push' } });
  assert.equal(world.spies.empty, 0);
  assert.deepEqual(world.spies.template, []);
  assert.deepEqual(world.spies.active, []);
  assert.ok(tree);
});

test('My programs lists every program; a card only opens the program and never changes which is active', async () => {
  const programs = Array.from({ length: 37 }, (_, n) => program(`p${n}`, n === 3));
  const world = hubWorld({ programs, details: { p3: { ...program('p3', true), notes: null, templates: [] } } });
  const tree = await world.show();
  const list = world.list(tree);
  assert.equal(list.props.data.length, 37);
  const rows = Array.from(list.props.data, (item, index) => h.expand(list.props.renderItem({ item, index })));
  assert.equal(rows[3].props.accessibilityLabel, 'Program p3, active program');
  assert.equal(rows[4].props.accessibilityLabel, 'Program p4');
  assert.equal(rows[4].props.accessibilityHint, 'Opens the program');
  rows[36].props.onPress();
  assert.deepEqual(world.pushes, ['/program/p36']);
  assert.equal(world.spies.activate, 0);
});

test('Create program opens the creation screen once, and Research stays one tap away in the title bar', async () => {
  const world = hubWorld({ programs: [] });
  const tree = await world.show();
  const create = h.byLabel(world.header(tree), 'Create program');
  create.props.onPress();
  create.props.onPress();
  assert.deepEqual(world.pushes, ['/program/new']);

  const research = h.byLabel(world.topBar(tree).props.trailing, 'Research, explore training research');
  assert.ok(research);
  const second = hubWorld();
  const secondTree = await second.show();
  h.byLabel(second.topBar(secondTree).props.trailing, 'Research, explore training research').props.onPress();
  assert.deepEqual(second.pushes, ['/research']);
});

test('no programs yet is stated; a failed load is an error with a retry, never an empty list', async () => {
  const none = hubWorld({ programs: [] });
  const noneList = none.list(await none.show());
  assert.ok(h.texts(noneList.props.ListEmptyComponent).includes('No programs yet. Create one to plan your training days.'));

  const broken = hubWorld({ listFails: true });
  const tree = await broken.show();
  assert.equal(broken.list(tree).props.ListEmptyComponent, null);
  assert.ok(h.texts(broken.header(tree)).includes('Offline'));
  h.byLabel(broken.header(tree), 'Try loading programs again').props.onPress();
  await h.settle();
  assert.equal(broken.spies.listCalls, 2);
});

// --------------------------------------------------------- creating a program

function newProgramWorld({ create } = {}) {
  const hooks = h.createHooks();
  const replaced = [];
  const created = [];
  const screen = h.loadFile('app/(app)/program/new.tsx', {
    globals: { React: { createElement: h.createElement } },
    modules: {
      '@expo/vector-icons': { Ionicons: 'Ionicons' },
      'expo-router': { useRouter: () => ({ replace: (href) => replaced.push(href) }) },
      react: hooks.hooks,
      'react-native': h.reactNative(),
      '../../../src/api/programs': { createProgram: async (name) => { created.push(name); return create ? create(name) : { id: 'new-1' }; } },
      '../../../src/lightTheme': { light },
      '../../../src/programs/programActions': { createProgramCreator },
    },
  }).default;
  const render = () => hooks.render(screen);
  const input = () => h.byLabel(render(), 'New program name');
  const submit = () => h.byLabel(render(), 'Create this program');
  return { render, input, submit, replaced, created };
}

test('creating a program: an empty name is not sent, a typed one is trimmed and the new program opens in place of the form', async () => {
  const world = newProgramWorld();
  world.render();
  world.submit().props.onPress();
  await h.settle();
  assert.deepEqual(world.created, []);
  assert.ok(h.texts(world.render()).includes('Enter a program name.'));

  world.input().props.onChangeText('  Push Pull Legs ');
  world.submit().props.onPress();
  await h.settle();
  assert.deepEqual(world.created, ['Push Pull Legs']);
  assert.deepEqual(world.replaced, ['/program/new-1']);
});

test('creating a program: keyboard Done followed by the button sends one request; a failure keeps the name for a one-tap retry', async () => {
  const slow = h.deferred();
  let attempt = 0;
  const world = newProgramWorld({ create: () => (++attempt === 1 ? slow.promise : { id: 'new-2' }) });
  world.render();
  world.input().props.onChangeText('Upper Lower');
  world.input().props.onSubmitEditing(); // keyboard Done
  world.submit().props.onPress(); // then the button
  await h.settle();
  assert.deepEqual(world.created, ['Upper Lower']);
  assert.equal(world.submit().props.accessibilityState.busy, true);

  slow.reject(new Error('Could not create the program'));
  await h.settle();
  const tree = world.render();
  assert.ok(h.texts(tree).includes('Could not create the program'));
  assert.equal(world.input().props.value, 'Upper Lower');
  assert.deepEqual(world.replaced, []);

  world.submit().props.onPress();
  await h.settle();
  assert.deepEqual(world.created, ['Upper Lower', 'Upper Lower']);
  assert.deepEqual(world.replaced, ['/program/new-2']);
});

// ------------------------------------------- Save as template, and the old /programs

function saveSheetWorld({ summaries = [], details = {} } = {}) {
  const hooks = h.createHooks();
  const pushes = [];
  const closed = [];
  const component = h.loadSource(h.extractFunctions('app/(app)/workout/[id].tsx', ['SaveAsTemplateModal']), {
    globals: {
      ...hooks.hooks,
      React: { createElement: h.createElement },
      useRouter: () => ({ push: (href) => pushes.push(href) }),
      Modal: 'Modal', KeyboardAvoidingView: 'KeyboardAvoidingView', Pressable: 'Pressable', ScrollView: 'ScrollView',
      Text: 'Text', TextInput: 'TextInput', View: 'View', ActivityIndicator: 'ActivityIndicator', Ionicons: 'Ionicons',
      Platform: { OS: 'ios' }, light: {}, styles: new Proxy({}, { get: (_, key) => key }),
      ApiError: class extends Error {},
      getTemplateSaveRequest: async () => null,
      prepareTemplateSaveRequest: async () => { throw new Error('not saving in this test'); },
      sendTemplateSaveRequest: async () => {}, buildTemplateExercisesFromWorkout: () => [],
      programsApi: { listPrograms: async () => summaries, getProgram: async (id) => details[id] },
    },
  }).SaveAsTemplateModal;
  const props = { workout: { id: 'w1', title: 'Push day', sets: [] }, onClose: () => closed.push('closed'), onSaved: () => {} };
  return {
    pushes, closed,
    async show() { hooks.render(component, props); await h.settle(); return hooks.render(component, props); },
  };
}

test('Save as template with no program: "Create a program" closes the sheet and opens the creation screen over the workout', async () => {
  const world = saveSheetWorld();
  const tree = await world.show();
  // The backdrop and the sheet are Pressables that contain this text too; the button is the innermost one.
  const button = h.nodes(tree).filter((node) => node.type === 'Pressable' && h.texts(node).includes('Create a program')).at(-1);
  assert.ok(button, 'the way out of an empty program list is offered');
  assert.ok(h.texts(tree).includes("You don't have a program yet."));
  button.props.onPress();
  assert.deepEqual(world.closed, ['closed']);
  assert.deepEqual(world.pushes, ['/program/new']);
});

test('Save as template with programs picks from them, with no detour to the old Programs tab', async () => {
  const world = saveSheetWorld({
    summaries: [{ id: 'a' }], details: { a: { id: 'a', name: 'Program a', is_active: true, templates: [] } },
  });
  const tree = await world.show();
  assert.ok(h.texts(tree).includes('Program a'));
  assert.equal(h.nodes(tree).some((node) => h.texts(node).includes('Create a program')), false);
});

test('/programs still lands somewhere: the retired tab route redirects to Start Workout', () => {
  const screen = h.loadFile('app/(app)/(tabs)/programs.tsx', {
    globals: { React: { createElement: h.createElement } },
    modules: { 'expo-router': { Redirect: 'Redirect' } },
  }).default;
  const element = screen();
  assert.equal(element.type, 'Redirect');
  assert.equal(element.props.href, '/');
});

function walk(dir) {
  return readdirSync(path.join(root, dir)).flatMap((name) => {
    const relative = `${dir}/${name}`;
    return statSync(path.join(root, relative)).isDirectory() ? walk(relative) : [relative];
  });
}

test('nothing in the app navigates to the retired /programs tab any more, and the new routes are registered', () => {
  const sources = [...walk('app'), ...walk('src')].filter((file) => /\.tsx?$/.test(file));
  const offenders = sources.filter((file) => {
    const source = h.read(file);
    return /(push|replace|navigate|dismissTo)\(\s*["'`]\/programs["'`]/.test(source) ||
      /href=["'{`]+\/programs["'`]/.test(source) || /pathname:\s*["'`]\/programs["'`]/.test(source);
  });
  assert.deepEqual(offenders, []);

  const layout = h.read('app/(app)/_layout.tsx');
  assert.match(layout, /<Stack\.Screen name="program\/new" options=\{\{ title: "New program" \}\} \/>/);
  assert.match(layout, /<Stack\.Screen name="exercise\/\[id\]"/);
  // Programs keep their restrictions where they always lived: the detail screen reads prepared_for.
  assert.match(h.read('app/(app)/program/[id].tsx'), /prepared_for/);
});
