/* global __dirname */
// The rest timer and an unsaved set draft across the five tabs. A workout is open with a
// half-typed set (weight and reps) and a running countdown; the user leaves the workout, visits
// each tab, taps the timer and comes back. The real workout screen, the real timer and draft
// stores and the real pill are used; the router, the API and the native layout are stand-ins.
// Whether the strip really sits above the bar on a small iPhone is for the physical-device
// checklist, not for this test.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const h = require('./support/screen-harness.cjs');

const TABS = ['profile', 'history', 'index', 'exercises', 'volume'];
// The router's segments for the focused tab: the index tab has no segment of its own.
const segmentsFor = (tab) => (tab === 'index' ? ['(app)', '(tabs)'] : ['(app)', '(tabs)', tab]);

const { createRestTimerStore, pillOverlayAllowed, spokenDuration } = h.loadFile('src/workout/restTimerStore.ts');
const { createSetDraftStore } = h.loadFile('src/workout/setDraftStore.ts');
const units = h.loadFile('src/units/weight.ts');
const rir = h.loadFile('src/workout/rir.ts');

class ApiError extends Error { constructor(status) { super(`Failure ${status}`); this.status = status; } }
const memory = () => {
  const values = new Map();
  return { getItemAsync: async (key) => values.get(key) ?? null, setItemAsync: async (key, value) => { values.set(key, value); }, deleteItemAsync: async (key) => { values.delete(key); } };
};
const setSaveHelpers = () => h.loadFile('src/workout/setSaveRequest.ts', {
  modules: {
    'expo-crypto': { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    'expo-secure-store': memory(), '../api/client': { ApiError }, '../api/workouts': { saveSetRequest: async () => ({}) },
  },
});

const benchSet = { id: 1, exercise_id: 'bench', exercise_name: 'Bench', set_number: 1, weight_kg: '80', reps: 8, rir: 2, rpe: null, is_warmup: false };
const openWorkout = { id: 'workout', title: 'Push day', performed_at: '2026-11-13T08:00:00Z', finished_at: null, sets: [benchSet], total_sets: 1 };

/** The real ActiveWorkoutScreen, rendered with the given shared stores. */
function workoutScreen({ timers, drafts }) {
  const hooks = h.createHooks();
  const globals = {
    ...setSaveHelpers(),
    ...hooks.hooks,
    useRouter: () => ({}), useLocalSearchParams: () => ({ id: 'workout' }),
    restTimerStore: timers, setDraftStore: drafts,
    useEntryReveal: () => ({ scrollRef: { current: null }, scrollProps: {}, revealEntry() {}, releaseEntry() {} }),
    useAuth: () => ({ user: { id: 'user', weight_unit: 'kg' } }),
    usePickedExercise: () => ({ openPicker() {} }), getStartingPlan: () => ({ targets: [], description: null }),
    compareWorkoutToPlan: () => null, compareExerciseTargets: () => null, describeTargetComparison: () => [],
    workoutsApi: { getWorkout: async () => openWorkout },
    DEFAULT_REST_SECONDS: 90, getRestSeconds: async () => 90,
    ...units, ...rir,
    React: { createElement: h.createElement }, Platform: { OS: 'ios' }, Stack: { Screen: 'Screen' },
    styles: new Proxy({}, { get: (_, key) => key }), light: {},
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
  for (const name of ['View', 'Text', 'Pressable', 'ActivityIndicator', 'KeyboardAvoidingView', 'ScrollView', 'TitleField',
    'SessionDuration', 'FinishedDuration', 'RestTimer', 'PreviousExercise', 'SetRow', 'ReadOnlySetRow', 'SetForm', 'Ionicons',
    'SaveAsTemplateModal', 'ReceivedFeedbackSection', 'SummaryCell']) globals[name] = name;
  const { ActiveWorkoutScreen } = h.loadSource(h.extractFunctions('app/(app)/workout/[id].tsx', ['ActiveWorkoutScreen', 'groupByExercise']), { globals });
  return {
    render: () => hooks.render(ActiveWorkoutScreen),
    form: (tree) => h.nodes(tree).find((node) => node.type === 'SetForm'),
    unmount: () => hooks.unmount(),
  };
}

/** The real pill, strip and overlay, reading the real timer store and recording navigation. */
function pillWorld({ timers, segments }) {
  const hooks = h.createHooks();
  const calls = [];
  const exports_ = h.loadFile('src/workout/RestTimerPill.tsx', {
    globals: { React: { createElement: h.createElement }, setTimeout: () => 1, clearTimeout() {} },
    modules: {
      react: hooks.hooks,
      'expo-router': {
        useRouter: () => ({ push: (href) => calls.push(['push', href]), dismissTo: (href) => calls.push(['dismissTo', href]) }),
        useSegments: () => segments,
        useGlobalSearchParams: () => ({}),
      },
      '@expo/vector-icons': { Ionicons: 'Ionicons' },
      'react-native': h.reactNative(),
      'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 34 }) },
      '../auth/AuthContext': { useAuth: () => ({ user: { id: 'user' } }) },
      '../lightTheme': { light: {} },
      './restPreference': { formatRest: (value) => `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}` },
      './restTimerStore': { restTimerStore: timers, pillOverlayAllowed, spokenDuration },
      './useRestTimer': {
        useRestTimer: () => {
          const timer = timers.timerFor('user');
          return { timer, remaining: 72, live: timer !== null, state: timers.getSnapshot() };
        },
      },
    },
  });
  // The pill is a component inside the strip: expand it in place, like a render would.
  return {
    calls,
    strip: () => h.expand(hooks.render(exports_.RestTimerStrip)),
    overlay: () => h.expand(hooks.render(exports_.RestTimerOverlay)),
  };
}

test('a half-typed set and a running timer survive leaving the workout, visiting each tab, and tapping the timer', async () => {
  const timers = createRestTimerStore();
  const drafts = createSetDraftStore();

  // 1. The workout is open. The user types a weight and reps (the form reports every change) ...
  const first = workoutScreen({ timers, drafts });
  first.render(); await h.settle();
  let form = first.form(first.render());
  assert.equal(form.props.draft.weight, '');
  form.props.onDraftChange({ weight: '82.5', reps: '8', rir: '', isWarmup: false });
  // ... and starts the rest countdown after the previous set.
  assert.equal(timers.start({ userId: 'user', workoutId: 'workout' }, 90), true);

  // 2. They leave the workout (its screen unmounts). Nothing was saved, yet nothing is lost either.
  first.unmount();
  assert.equal(timers.isWorkoutScreenOpen('workout'), false);
  assert.deepEqual(h.plain(drafts.getDraft('user', 'workout', 'bench')), { weight: '82.5', reps: '8', rir: '', isWarmup: false });

  // 3. On every tab the countdown is in the tab bar's strip (not a second floating pill), and one tap goes back to the workout.
  for (const tab of TABS) {
    const world = pillWorld({ timers, segments: segmentsFor(tab) });
    assert.equal(world.overlay(), null, `${tab}: the overlay is for pushed screens, the tabs have the strip`);
    const strip = world.strip();
    const button = h.nodes(strip).find((node) => node.type === 'Pressable');
    assert.ok(button, `${tab}: the strip shows the countdown`);
    assert.equal(button.props.accessibilityLabel, 'Rest timer, 1 minute 12 seconds remaining. Return to workout');
    button.props.onPress();
    button.props.onPress(); // a double tap must not push the workout twice
    assert.deepEqual(world.calls, [['push', '/workout/workout']], tab);
  }

  // 4. The workout screen is rebuilt from scratch: the draft is back in the form, the timer is still running.
  const second = workoutScreen({ timers, drafts });
  second.render(); await h.settle();
  form = second.form(second.render());
  assert.deepEqual(h.plain(form.props.draft), { weight: '82.5', reps: '8', rir: '', isWarmup: false });
  assert.equal(timers.timerFor('user').workoutId, 'workout');
  assert.equal(timers.isWorkoutScreenOpen('workout'), true);
  second.unmount();
});

test('with no timer running there is no strip on any tab, and the draft is still kept', async () => {
  const timers = createRestTimerStore();
  const drafts = createSetDraftStore();
  const screen = workoutScreen({ timers, drafts });
  screen.render(); await h.settle();
  screen.form(screen.render()).props.onDraftChange({ weight: '60', reps: '', rir: '', isWarmup: true });
  screen.unmount();
  for (const tab of TABS) assert.equal(pillWorld({ timers, segments: segmentsFor(tab) }).strip(), null, tab);
  assert.equal(drafts.getDraft('user', 'workout', 'bench').weight, '60');
  assert.equal(drafts.getDraft('user', 'workout', 'bench').isWarmup, true);
});

test('returning from the timer while the workout is still in the stack pops back to it instead of stacking a copy', () => {
  const timers = createRestTimerStore();
  timers.start({ userId: 'user', workoutId: 'workout' }, 90);
  timers.registerWorkoutScreen('workout'); // a past workout was opened on top of it
  const world = pillWorld({ timers, segments: ['(app)', 'workout', '[id]'] });
  h.nodes(world.strip()).find((node) => node.type === 'Pressable').props.onPress();
  assert.deepEqual(world.calls, [['dismissTo', '/workout/workout']]);
});

test('the strip is the first thing in the tab bar on every tab, the bar itself is passed through untouched', () => {
  const bar = h.loadFile('src/workout/TabBarWithRestTimer.tsx', {
    globals: { React: { createElement: h.createElement } },
    modules: {
      'expo-router/js-tabs': { BottomTabBar: 'BottomTabBar' },
      'react-native': h.reactNative(),
      './RestTimerPill': { RestTimerStrip: 'RestTimerStrip' },
    },
  }).TabBarWithRestTimer;
  for (const [index, tab] of TABS.entries()) {
    const props = { state: { index, routes: TABS.map((name) => ({ name })) }, tab };
    const tree = bar(props);
    const kinds = h.nodes(tree).map((node) => node.type);
    assert.ok(kinds.indexOf('RestTimerStrip') !== -1 && kinds.indexOf('RestTimerStrip') < kinds.indexOf('BottomTabBar'), tab);
    assert.deepEqual(h.nodes(tree).find((node) => node.type === 'BottomTabBar').props.tab, tab);
  }
  // Pushed screens have no tab bar, so only there may the floating overlay appear (and only for another workout's page).
  for (const tab of TABS) assert.equal(pillOverlayAllowed(segmentsFor(tab), undefined, 'workout'), false, tab);
  assert.equal(pillOverlayAllowed(['(app)', 'workout', '[id]'], 'past', 'workout'), true);
});

test('the tab bar that carries the strip is the one all five tabs use', () => {
  const layout = h.read('app/(app)/(tabs)/_layout.tsx');
  assert.match(layout, /tabBar=\{\(props\) => <TabBarWithRestTimer \{\.\.\.props\} \/>\}/);
  assert.equal(layout.split('<Tabs.Screen').length - 1, 6); // five tabs and the hidden route share this one navigator
});
