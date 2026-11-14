/* global __dirname */
// The shared rest timer: store rules, the hook that reads it, the pill's
// navigation, and how the pieces are wired into the app. Native layout and the
// real navigator are not simulated here; see the physical-device checklist.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = file => readFileSync(path.join(root, file), 'utf8');

function load(file, globals = {}, modules = {}) {
  const loaded = { exports: {} };
  const code = ts.transpileModule(read(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
  } }).outputText;
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, Math, Number, Object, Array, Set, Map, ...globals,
    require: name => { if (!(name in modules)) throw new Error(`Unexpected dependency: ${name}`); return modules[name]; },
  });
  return loaded.exports;
}

const storeModule = load('src/workout/restTimerStore.ts');
function makeStore() {
  const clock = { t: 1_000_000 };
  return { clock, store: storeModule.createRestTimerStore(() => clock.t) };
}
const owner = { userId: 'user', workoutId: 'workout' };
const seconds = n => n * 1000;

// ---------------------------------------------------------------- the store

test('remaining time comes from the clock, so time spent elsewhere or in the background is counted', () => {
  const { clock, store } = makeStore();
  assert.equal(store.start(owner, 120), true);
  const timer = store.getSnapshot().timer;
  assert.equal(storeModule.remainingSeconds(timer, clock.t), 120);
  assert.equal(storeModule.remainingSeconds(timer, clock.t + seconds(30) + 900), 90);
  // The app sat in the background for five minutes: nothing was counted down by hand.
  assert.equal(storeModule.remainingSeconds(timer, clock.t + seconds(300)), 0);
  // A clock that moves backwards never lengthens the rest.
  assert.equal(storeModule.remainingSeconds(timer, clock.t - seconds(60)), 120);
});

test('an expired timer is not live and nothing but an explicit start can bring it back', () => {
  const { clock, store } = makeStore();
  store.start(owner, 60);
  const before = store.getSnapshot();
  const timer = before.timer;
  clock.t += seconds(61);
  assert.equal(storeModule.isLive(timer, clock.t), false);
  // Reading, waiting and "returning to the foreground" write nothing.
  assert.equal(store.getSnapshot(), before);
  assert.equal(store.timerFor('user').startedAt, timer.startedAt);
  assert.equal(storeModule.isLive(store.timerFor('user'), clock.t), false);
  // A user start is a new countdown from the current time.
  store.start(owner, 60);
  assert.equal(storeModule.isLive(store.timerFor('user'), clock.t), true);
});

test('the timer belongs to one account and one workout', () => {
  const { store } = makeStore();
  store.start(owner, 90);
  assert.equal(store.timerFor('other-user'), null);
  assert.equal(store.timerFor(undefined), null);
  assert.equal(store.timerFor('user').workoutId, 'workout');

  store.clearForWorkout('another-workout');
  assert.equal(store.getSnapshot().timer.workoutId, 'workout');
  store.clearForWorkout('workout'); // finished, discarded or replaced
  assert.equal(store.getSnapshot().timer, null);
});

test('sign-out, expired session and account deletion end the timer for everyone', () => {
  const { store } = makeStore();
  store.start(owner, 90);
  store.reset();
  assert.equal(store.getSnapshot().timer, null);
  assert.equal(store.timerFor('user'), null);
  // A different account signing in next never sees the previous account's countdown.
  store.start({ userId: 'first', workoutId: 'w1' }, 90);
  assert.equal(store.timerFor('second'), null);
});

test('starting for another workout replaces the timer; unusable requests change nothing', () => {
  const { store } = makeStore();
  store.start(owner, 90);
  for (const [who, length] of [[owner, 0], [owner, -5], [owner, NaN], [owner, Infinity],
    [{ userId: '', workoutId: 'w' }, 90], [{ userId: 'u', workoutId: '' }, 90]]) {
    assert.equal(store.start(who, length), false);
  }
  assert.equal(store.getSnapshot().timer.workoutId, 'workout');
  assert.equal(store.getSnapshot().timer.durationSeconds, 90);
  store.start({ userId: 'user', workoutId: 'next' }, 60);
  assert.equal(store.getSnapshot().timer.workoutId, 'next');
});

test('stopping and clearing are idempotent and only notify on a real change', () => {
  const { store } = makeStore();
  let notified = 0;
  const unsubscribe = store.subscribe(() => notified++);
  store.stop(); store.reset(); store.clearForWorkout('workout');
  assert.equal(notified, 0);
  store.start(owner, 90);
  assert.equal(notified, 1);
  store.stop(); store.stop();
  assert.equal(notified, 2);
  unsubscribe();
  store.start(owner, 90);
  assert.equal(notified, 2);
});

test('covers and pill suppressions are counted and each release counts once', () => {
  const { store } = makeStore();
  const first = store.coverInline();
  const second = store.coverInline();
  assert.equal(store.getSnapshot().covers, 2);
  first(); first();
  assert.equal(store.getSnapshot().covers, 1);
  second();
  assert.equal(store.getSnapshot().covers, 0);

  const hold = store.suppressPill();
  assert.equal(store.getSnapshot().pillSuppressions, 1);
  store.reset(); // sign-out ends the timer, not a screen's own hold
  assert.equal(store.getSnapshot().pillSuppressions, 1);
  hold();
  assert.equal(store.getSnapshot().pillSuppressions, 0);
});

test('workout screens in the stack are counted, so a duplicate stack entry still counts as open', () => {
  const { store } = makeStore();
  assert.equal(store.isWorkoutScreenOpen('workout'), false);
  const a = store.registerWorkoutScreen('workout');
  const b = store.registerWorkoutScreen('workout');
  a(); a();
  assert.equal(store.isWorkoutScreenOpen('workout'), true);
  b();
  assert.equal(store.isWorkoutScreenOpen('workout'), false);
});

test('spoken durations read as words, not as a time of day', () => {
  assert.equal(storeModule.spokenDuration(72), '1 minute 12 seconds');
  assert.equal(storeModule.spokenDuration(120), '2 minutes');
  assert.equal(storeModule.spokenDuration(61), '1 minute 1 second');
  assert.equal(storeModule.spokenDuration(0), '0 seconds');
  assert.equal(storeModule.spokenDuration(-4), '0 seconds');
});

test('the overlay belongs on another workout\'s page only, never on the timer\'s own or on other pushed screens', () => {
  const page = ['(app)', 'workout', '[id]'];
  assert.equal(storeModule.pillOverlayAllowed(page, 'past', 'active'), true);
  assert.equal(storeModule.pillOverlayAllowed(page, 'active', 'active'), false);
  assert.equal(storeModule.pillOverlayAllowed(page, undefined, 'active'), false);
  assert.equal(storeModule.pillOverlayAllowed(['(app)', 'workout', 'exercise-picker'], undefined, 'active'), false);
  assert.equal(storeModule.pillOverlayAllowed(['(app)', 'workout', 'checkin'], undefined, 'active'), false);
  assert.equal(storeModule.pillOverlayAllowed(['(app)', '(tabs)'], undefined, 'active'), false); // the tabs have their own strip
  assert.equal(storeModule.pillOverlayAllowed(['(app)', 'coaching', 'athlete', '[linkId]', 'workout', '[workoutId]'], 'x', 'active'), false);
  assert.equal(storeModule.pillOverlayAllowed(['(app)', 'research', '[id]'], 'x', 'active'), false);
});

// ------------------------------------------------------------------ the hook

function hookHarness(store, userId, clock) {
  const state = [];
  const effects = [];
  const intervals = new Map();
  const appListeners = [];
  let cursor = 0, effectCursor = 0, pending = [], nextInterval = 1, cleared = 0;
  const fakeReact = {
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
    useEffect(fn, deps) {
      const index = effectCursor++;
      if (effects[index] && effects[index].deps.length === deps.length &&
        effects[index].deps.every((value, i) => Object.is(value, deps[i]))) return;
      pending.push(() => { effects[index]?.cleanup?.(); effects[index] = { deps, cleanup: fn() }; });
    },
  };
  const hook = load('src/workout/useRestTimer.ts', {
    Date: { now: () => clock.t },
    setInterval: fn => { const id = nextInterval++; intervals.set(id, fn); return id; },
    clearInterval: id => { cleared++; intervals.delete(id); },
  }, {
    react: fakeReact,
    'react-native': { AppState: { addEventListener: (_event, listener) => {
      appListeners.push(listener);
      return { remove: () => { appListeners.splice(appListeners.indexOf(listener), 1); } };
    } } },
    './restTimerStore': {
      remainingSeconds: storeModule.remainingSeconds,
      restTimerStore: store,
    },
  });
  return {
    render(id = userId) {
      cursor = 0; effectCursor = 0; pending = [];
      const view = hook.useRestTimer(id);
      pending.forEach(run => run());
      return view;
    },
    intervals, appListeners,
    tickAll() { [...intervals.values()].forEach(fn => fn()); },
    get cleared() { return cleared; },
  };
}

test('the hook ticks while a countdown runs, counts down from the clock and stops ticking at zero', () => {
  const { clock, store } = makeStore();
  const harness = hookHarness(store, 'user', clock);
  assert.equal(harness.render().live, false);
  assert.equal(harness.intervals.size, 0); // nothing to repaint

  store.start(owner, 3);
  let view = harness.render();
  assert.equal(view.live, true);
  assert.equal(view.remaining, 3);
  assert.equal(harness.intervals.size, 1);

  clock.t += seconds(1); harness.tickAll(); view = harness.render();
  assert.equal(view.remaining, 2);
  clock.t += seconds(2); harness.tickAll(); view = harness.render();
  assert.equal(view.remaining, 0);
  assert.equal(view.live, false);
  assert.ok(view.timer, 'the record stays, so the workout screen can still say "Rest over"');
  harness.render();
  assert.equal(harness.intervals.size, 0, 'no interval is left running after expiry');
  assert.equal(harness.appListeners.length, 0);
});

test('returning to the foreground after expiry shows it expired and starts nothing', () => {
  const { clock, store } = makeStore();
  const harness = hookHarness(store, 'user', clock);
  store.start(owner, 60);
  harness.render();
  const before = store.getSnapshot();
  // JS timers were frozen for ten minutes; the foreground event is the first thing to run.
  clock.t += seconds(600);
  harness.appListeners.forEach(listener => listener('active'));
  const view = harness.render();
  assert.equal(view.live, false);
  assert.equal(view.remaining, 0);
  assert.equal(store.getSnapshot(), before); // the hook wrote nothing
  assert.equal(harness.intervals.size, 0);
  clock.t += seconds(5);
  harness.render();
  assert.equal(harness.render().live, false); // and it stays over
});

test('a tick that arrives after sign-out or a new account cannot bring the timer back', () => {
  const { clock, store } = makeStore();
  const harness = hookHarness(store, 'user', clock);
  store.start(owner, 90);
  harness.render();
  const staleTick = [...harness.intervals.values()][0];

  store.reset();
  const afterReset = store.getSnapshot();
  clock.t += seconds(1);
  staleTick(); // a delayed callback from the old session
  const view = harness.render();
  assert.equal(view.timer, null);
  assert.equal(view.live, false);
  assert.equal(store.getSnapshot(), afterReset);

  // The next account sees nothing of the previous account's countdown.
  store.start({ userId: 'first', workoutId: 'w1' }, 90);
  assert.equal(harness.render('second').timer, null);
  assert.equal(harness.render('first').live, true);
});

// ------------------------------------------------------- the pill and its taps

function pillHarness({ registered, live = true, suppressions = 0 }) {
  const { clock, store } = makeStore();
  const calls = [];
  const timeouts = [];
  const state = [];
  const effects = [];
  let cursor = 0, effectCursor = 0, pending = [], segments = ['(app)', '(tabs)'], params = {};
  if (registered) store.registerWorkoutScreen('workout');
  const react = {
    useRef(initial) { const index = cursor++; state[index] ??= { current: initial }; return state[index]; },
    useCallback: fn => fn,
    useEffect(fn, deps) {
      const index = effectCursor++;
      if (effects[index] && effects[index].deps.length === deps.length &&
        effects[index].deps.every((value, i) => Object.is(value, deps[i]))) return;
      pending.push(() => { effects[index]?.cleanup?.(); effects[index] = { deps, cleanup: fn() }; });
    },
  };
  const exports_ = load('src/workout/RestTimerPill.tsx', {
    // Function components are expanded in place, like a render would, so the tree holds host elements only.
    React: { createElement: (type, props, ...children) => typeof type === 'function'
      ? type({ ...props, children })
      : { type, props: { ...props, children } } },
    setTimeout: fn => { timeouts.push(fn); return timeouts.length; },
    clearTimeout() {},
  }, {
    react,
    'expo-router': {
      useRouter: () => ({ push: href => calls.push(['push', href]), dismissTo: href => calls.push(['dismissTo', href]) }),
      useSegments: () => segments,
      useGlobalSearchParams: () => params,
    },
    '@expo/vector-icons': { Ionicons: 'Ionicons' },
    'react-native': { Pressable: 'Pressable', StyleSheet: { create: value => value, hairlineWidth: 1 }, Text: 'Text', View: 'View' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
    '../auth/AuthContext': { useAuth: () => ({ user: { id: 'user' } }) },
    '../lightTheme': { light: {} },
    './restPreference': { formatRest: value => `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}` },
    './restTimerStore': { restTimerStore: store, pillOverlayAllowed: storeModule.pillOverlayAllowed, spokenDuration: storeModule.spokenDuration },
    './useRestTimer': { useRestTimer: () => live
      ? { timer: { workoutId: 'workout' }, remaining: 72, live: true, state: { pillSuppressions: suppressions } }
      : { timer: null, remaining: 0, live: false, state: { pillSuppressions: suppressions } } },
  });
  const nodes = tree => !tree || typeof tree !== 'object' ? []
    : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  return {
    calls,
    render(component = exports_.RestTimerStrip) {
      cursor = 0; effectCursor = 0; pending = [];
      const tree = component();
      pending.forEach(run => run());
      return tree;
    },
    nodes,
    navigateTo(next, nextParams = {}) { segments = next; params = nextParams; },
    elapse() { timeouts.splice(0).forEach(fn => fn()); },
    exports: exports_,
  };
}

test('tapping the pill goes to the same workout once, pushing it only when its screen is gone', () => {
  const gone = pillHarness({ registered: false });
  const button = gone.nodes(gone.render()).find(node => node.type === 'Pressable');
  button.props.onPress(); button.props.onPress(); button.props.onPress();
  assert.deepEqual(gone.calls, [['push', '/workout/workout']]); // repeated taps never stack copies
  gone.navigateTo(['(app)', 'workout', '[id]']);
  gone.render();
  const again = gone.nodes(gone.render()).find(node => node.type === 'Pressable');
  again.props.onPress();
  assert.equal(gone.calls.length, 2); // the route moved on, so a later tap is a new request

  const open = pillHarness({ registered: true });
  open.nodes(open.render()).find(node => node.type === 'Pressable').props.onPress();
  assert.deepEqual(open.calls, [['dismissTo', '/workout/workout']]); // popped back, not stacked again
});

test('a tap that never changes the route does not leave the pill dead', () => {
  const harness = pillHarness({ registered: false });
  const press = () => harness.nodes(harness.render()).find(node => node.type === 'Pressable').props.onPress();
  press(); press();
  assert.equal(harness.calls.length, 1);
  harness.elapse();
  press();
  assert.equal(harness.calls.length, 2);
});

test('the pill is a labelled 44pt button, announces nothing each second, and is absent without a running timer', () => {
  const harness = pillHarness({ registered: false });
  const button = harness.nodes(harness.render()).find(node => node.type === 'Pressable');
  assert.equal(button.props.accessibilityRole, 'button');
  assert.equal(button.props.accessibilityLabel, 'Rest timer, 1 minute 12 seconds remaining. Return to workout');
  assert.equal(button.props.accessibilityLiveRegion, undefined);
  assert.match(JSON.stringify(harness.nodes(harness.render())), /"1:12"|1:12/);

  const idle = pillHarness({ registered: false, live: false });
  assert.equal(idle.render(), null);
  assert.equal(idle.render(idle.exports.RestTimerOverlay), null);
  assert.equal(idle.render(idle.exports.RestCountdownChip), null);
});

test('the overlay floats over a different workout page only, never over the timer own page or an editable one', () => {
  const page = ['(app)', 'workout', '[id]'];
  const harness = pillHarness({ registered: true });
  assert.equal(harness.render(harness.exports.RestTimerOverlay), null); // on the tabs: the strip's job

  harness.navigateTo(page, { id: 'past' });
  const overlay = harness.render(harness.exports.RestTimerOverlay);
  assert.equal(overlay.props.pointerEvents, 'box-none');
  const button = harness.nodes(overlay).find(node => node.type === 'Pressable');
  button.props.onPress();
  assert.deepEqual(harness.calls, [['dismissTo', '/workout/workout']]);

  harness.navigateTo(page, { id: 'workout' }); // the timer's own workout draws its own countdown
  assert.equal(harness.render(harness.exports.RestTimerOverlay), null);
  harness.navigateTo(['(app)', 'workout', 'exercise-picker']);
  assert.equal(harness.render(harness.exports.RestTimerOverlay), null);

  const editing = pillHarness({ registered: true, suppressions: 1 }); // a past workout open for editing
  editing.navigateTo(page, { id: 'past' });
  assert.equal(editing.render(editing.exports.RestTimerOverlay), null);
});

// ----------------------------------------------------------------- the wiring

test('the pill sits in the tab bar and the overlay beside the stack, so each is clear of the other\'s chrome', () => {
  const tabs = read('app/(app)/(tabs)/_layout.tsx');
  assert.match(tabs, /tabBar=\{\(props\) => <TabBarWithRestTimer \{\.\.\.props\} \/>\}/);
  const bar = read('src/workout/TabBarWithRestTimer.tsx');
  assert.match(bar, /<RestTimerStrip \/>\s*<BottomTabBar \{\.\.\.props\} \/>/);

  const layout = read('app/(app)/_layout.tsx');
  assert.ok(layout.indexOf('<RestTimerOverlay />') > layout.indexOf('</Stack>'));
  assert.match(layout, /<View style=\{styles\.root\}>/);

  const pill = read('src/workout/RestTimerPill.tsx');
  const strip = /strip: \{[^}]*\}/.exec(pill)[0];
  assert.doesNotMatch(strip, /position/); // in the layout flow: it cannot cover list rows or the tab bar
  assert.match(pill, /minHeight: 44/);
  assert.match(pill, /pointerEvents="box-none"/);
  assert.match(pill, /insets\.bottom/);
  assert.doesNotMatch(pill, /accessibilityLiveRegion|AccessibilityInfo\.announce/);
});

test('every account change resets the timer through the session reset', () => {
  const auth = read('src/auth/AuthContext.tsx');
  const reset = /resetAccountState: \(\) => \{[\s\S]*?\n {8}\},/.exec(auth)[0];
  assert.match(reset, /restTimerStore\.reset\(\)/);
});

test('the exercise-history panel shows the countdown itself and hides the screen\'s while open', () => {
  const history = read('src/workout/ExerciseHistory.tsx');
  assert.match(history, /restTimerStore\.coverInline\(\)/);
  const modal = history.slice(history.indexOf('<Modal'), history.indexOf('</Modal>'));
  assert.match(modal, /<RestCountdownChip \/>/);

  const screen = read('app/(app)/workout/[id].tsx');
  assert.match(screen, /const covered = state\.covers > 0/);
  assert.match(screen, /restCovered: \{ opacity: 0 \}/);
});

test('the change adds no dependency and no notification or background machinery', () => {
  const sources = ['src/workout/restTimerStore.ts', 'src/workout/useRestTimer.ts', 'src/workout/RestTimerPill.tsx',
    'src/workout/TabBarWithRestTimer.tsx'].map(read).join('\n');
  assert.doesNotMatch(sources, /expo-notifications|expo-task-manager|expo-background|LiveActivity|expo-av|expo-audio/);
  assert.doesNotMatch(sources, /fetch\(|apiRequest|workoutsApi/); // mobile-only; no backend call
});
