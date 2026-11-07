/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => readFileSync(path.join(root, file), 'utf8');
function load(source, globals = {}, modules = {}) {
  const loaded = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
  } }).outputText;
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, Error, ...globals,
    require: name => { if (!(name in modules)) throw new Error(name); return modules[name]; },
  });
  return loaded.exports;
}
class ApiError extends Error { constructor(status) { super(`Failure ${status}`); this.status = status; } }
function storage() {
  const values = new Map();
  return { values, getItemAsync: async key => values.get(key) ?? null,
    setItemAsync: async (key, value) => { values.set(key, value); },
    deleteItemAsync: async key => { values.delete(key); } };
}
let serial = 0;
function api(store, send) {
  return load(read('src/workout/setSaveRequest.ts'), {}, {
    'expo-crypto': { randomUUID: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}` },
    'expo-secure-store': store, '../api/client': { ApiError },
    '../api/workouts': { saveSetRequest: send },
  });
}
const input = { exercise_id: 'bench', weight_kg: 20, reps: 8, rir: 0, is_warmup: false };
const log = sets => ({ id: 'workout', title: 'Session', performed_at: '2026-09-24T12:00:00Z',
  finished_at: null, sets, total_sets: sets.length });

test('lost response and app restart retain the exact set and request ID until confirmation', async () => {
  const store = storage();
  const calls = [];
  const send = async (...args) => { calls.push(args); if (calls.length === 1) throw new ApiError(0); return log([]); };
  let helpers = api(store, send);
  const request = await helpers.prepareSetSaveRequest('user', 'workout', 'Bench', input);
  await assert.rejects(helpers.sendSetSaveRequest('user', 'workout', request));
  helpers = api(store, send);
  const restored = await helpers.getSetSaveRequest('user', 'workout');
  assert.equal(restored.requestId, request.requestId);
  assert.equal(restored.input.rir, 0);
  await helpers.sendSetSaveRequest('user', 'workout', restored);
  assert.equal(JSON.stringify(calls[0]), JSON.stringify(calls[1]));
  assert.equal(await helpers.getSetSaveRequest('user', 'workout'), null);
});

test('pending intent is never replaced by changed form details or exposed to another account', async () => {
  const helpers = api(storage(), async () => log([]));
  await helpers.prepareSetSaveRequest('user', 'workout', 'Bench', input);
  await assert.rejects(helpers.prepareSetSaveRequest('user', 'workout', 'Bench', { ...input, reps: 9 }), /Resolve/);
  assert.equal((await helpers.getSetSaveRequest('user', 'workout')).input.reps, 8);
  assert.equal(await helpers.getSetSaveRequest('other', 'workout'), null);
  assert.equal(await helpers.getSetSaveRequest('user', 'different'), null);
});

test('each acknowledged identical set gets a fresh ID and converted weights use API precision', async () => {
  const helpers = api(storage(), async () => log([]));
  const first = await helpers.prepareSetSaveRequest('user', 'workout', 'Bench', { ...input, weight_kg: 20.41165665 });
  assert.equal(first.input.weight_kg, 20.41);
  await helpers.sendSetSaveRequest('user', 'workout', first);
  const next = await helpers.prepareSetSaveRequest('user', 'workout', 'Bench', input);
  assert.notEqual(first.requestId, next.requestId);
});

test('storage failure prevents an untracked network write; cleanup failure keeps retries safe', async () => {
  const store = storage();
  let calls = 0;
  const helpers = api(store, async () => { calls++; return log([]); });
  const original = store.setItemAsync;
  store.setItemAsync = async () => { throw new Error('Storage full'); };
  await assert.rejects(helpers.prepareSetSaveRequest('user', 'workout', 'Bench', input), /Storage full/);
  assert.equal(calls, 0);
  store.setItemAsync = original;
  const request = await helpers.prepareSetSaveRequest('user', 'workout', 'Bench', input);
  store.deleteItemAsync = async () => { throw new Error('Cleanup failed'); };
  await assert.rejects(helpers.sendSetSaveRequest('user', 'workout', request), /Cleanup failed/);
  assert.equal((await helpers.getSetSaveRequest('user', 'workout')).requestId, request.requestId);
});

test('only validation rejection clears a request; network and uncertain server errors retain it', async () => {
  for (const status of [0, 401, 404, 409, 422, 429, 500]) {
    const helpers = api(storage(), async () => { throw new ApiError(status); });
    const request = await helpers.prepareSetSaveRequest('user', 'workout', 'Bench', input);
    await assert.rejects(helpers.sendSetSaveRequest('user', 'workout', request));
    assert.equal((await helpers.getSetSaveRequest('user', 'workout')) === null, status === 422);
  }
});

test('corrupt storage cannot silently become an empty queue', async () => {
  const store = storage();
  const helpers = api(store, async () => log([]));
  await helpers.prepareSetSaveRequest('user', 'workout', 'Bench', input);
  const key = [...store.values.keys()][0];
  for (const corrupt of ['broken json', '{}', 'null']) {
    store.values.set(key, corrupt);
    await assert.rejects(helpers.getSetSaveRequest('user', 'workout'));
  }
});

test('retryable API never falls back to a non-idempotent POST', async () => {
  const calls = [];
  const workouts = load(read('src/api/workouts.ts'), {}, { './client': {
    apiRequest: async (...args) => { calls.push(args); throw new ApiError(404); },
  } });
  await assert.rejects(workouts.saveSetRequest('workout', 'request', input));
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/workouts/workout/sets/requests/request');
  assert.equal(calls[0][1].method, 'PUT');
});

test('overlapping screens cannot prepare two pending intents or let a stale retry clear a new one', async () => {
  const helpers = api(storage(), async () => log([]));
  const results = await Promise.allSettled([
    helpers.prepareSetSaveRequest('user', 'workout', 'Bench', input),
    helpers.prepareSetSaveRequest('user', 'workout', 'Bench', input),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const old = await helpers.getSetSaveRequest('user', 'workout');
  await helpers.sendSetSaveRequest('user', 'workout', old);
  const next = await helpers.prepareSetSaveRequest('user', 'workout', 'Bench', input);
  await assert.rejects(helpers.sendSetSaveRequest('user', 'workout', old), /pending set changed/);
  assert.equal((await helpers.getSetSaveRequest('user', 'workout')).requestId, next.requestId);
});

// Exercise the actual screen callback and state wiring; native layout is not simulated.
function screen(helpers, initial = log([]), overrides = {}) {
  const parsed = ts.createSourceFile('screen.tsx', read('app/(app)/workout/[id].tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ['ActiveWorkoutScreen', 'groupByExercise'];
  const source = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
    .map(node => node.getText(parsed)).join('\n');
  const state = [], effects = [];
  let cursor = 0, effectCursor = 0, pending = [];
  const globals = {
    ...helpers,
    // Like React, a function initialiser is called once, on the first render.
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; },
    useRef(initial) { const index = cursor++; state[index] ??= { current: initial }; return state[index]; },
    useMemo: fn => fn(), useCallback: fn => fn,
    useEffect(fn, deps) { const index = effectCursor++;
      if (effects[index]?.deps.every((value, i) => value === deps[i])) return;
      pending.push(() => { effects[index]?.cleanup?.(); effects[index] = { deps, cleanup: fn() }; }); },
    useRouter: () => ({}), useLocalSearchParams: () => ({ id: 'workout' }),
    // Focus is not simulated: a focus effect runs on every commit and cleans up before the next one.
    useFocusEffect(fn) { const index = effectCursor++;
      pending.push(() => { effects[index]?.cleanup?.(); effects[index] = { deps: [], cleanup: fn() }; }); },
    restTimerStore: load(read('src/workout/restTimerStore.ts')).createRestTimerStore(),
    setDraftStore: load(read('src/workout/setDraftStore.ts')).createSetDraftStore(),
    useEntryReveal: () => ({ scrollRef: { current: null }, scrollProps: {}, revealEntry() {}, releaseEntry() {} }),
    useAuth: () => ({ user: { id: 'user', weight_unit: 'kg' } }),
    usePickedExercise: () => ({ openPicker() {} }), getStartingPlan: () => ({ targets: [], description: null }),
    compareWorkoutToPlan: () => null, compareExerciseTargets: () => null, describeTargetComparison: () => [],
    workoutsApi: { getWorkout: async () => initial },
    DEFAULT_REST_SECONDS: 90, getRestSeconds: async () => 90,
    ...load(read('src/units/weight.ts')), ...load(read('src/workout/rir.ts')),
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
    Platform: { OS: 'ios' }, Stack: { Screen: 'Screen' },
    styles: new Proxy({}, { get: (_, key) => key }), light: {},
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
  for (const name of ['View', 'Text', 'Pressable', 'ActivityIndicator', 'KeyboardAvoidingView',
    'ScrollView', 'TitleField', 'SessionDuration', 'FinishedDuration', 'RestTimer', 'PreviousExercise',
    'SetRow', 'ReadOnlySetRow', 'SetForm', 'Ionicons', 'SaveAsTemplateModal', 'ReceivedFeedbackSection',
    'SummaryCell']) globals[name] = name;
  Object.assign(globals, overrides);
  const component = load(source, globals).default;
  const render = () => { cursor = 0; effectCursor = 0; pending = []; const tree = component();
    pending.forEach(fn => fn()); return tree; };
  render.unmount = () => effects.forEach(effect => effect?.cleanup?.());
  render.state = state;
  render.timers = globals.restTimerStore;
  render.drafts = globals.setDraftStore;
  return render;
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const form = tree => nodes(tree).find(node => node.type === 'SetForm');
const retry = tree => nodes(tree).find(node => node.type === 'Pressable' && JSON.stringify(node).includes('Retry pending set'));

test('screen restores an unsaved exercise and blocks new logging until retry succeeds', async () => {
  const helpers = api(storage(), async () => log([]));
  await helpers.prepareSetSaveRequest('user', 'workout', 'Bench', input);
  const render = screen(helpers);
  render(); await settle();
  assert.match(JSON.stringify(render()), /Set awaiting confirmation/);
  assert.equal(form(render()).props.blocked, true);
  const version = form(render()).props.key;
  retry(render()).props.onPress(); await settle();
  assert.equal(form(render()), undefined); // No server sets or picked exercise after restart.
  assert.equal(await helpers.getSetSaveRequest('user', 'workout'), null);
  assert.equal(version, 0);
});

test('screen serializes rapid submissions and clears the original form after a banner retry', async () => {
  let sendCalls = 0;
  const helpers = api(storage(), async () => { sendCalls++; if (sendCalls === 1) throw new ApiError(0); return log([{
    ...input, id: 1, exercise_name: 'Bench', set_number: 1,
  }]); });
  const render = screen(helpers, log([{ ...input, id: 1, exercise_name: 'Bench', set_number: 1 }]));
  render(); await settle();
  const submit = form(render()).props.onSubmit;
  const first = submit(20, 8, false, 0);
  await assert.rejects(submit(20, 8, false, 0), /Please wait/);
  await assert.rejects(first);
  assert.equal(sendCalls, 1);
  assert.equal(form(render()).props.blocked, true);
  retry(render()).props.onPress(); await settle();
  assert.equal(form(render()).props.busy, false);
  assert.equal(form(render()).props.blocked, false);
  assert.equal(form(render()).props.key, 1);
  assert.equal(sendCalls, 2);
});

test('leaving a screen while preparation is in flight keeps a recoverable intent without sending', async () => {
  const store = storage();
  let release;
  const original = store.setItemAsync;
  store.setItemAsync = async (...args) => { await new Promise(resolve => { release = resolve; }); await original(...args); };
  let calls = 0;
  const helpers = api(store, async () => { calls++; return log([]); });
  const render = screen(helpers, log([{ ...input, id: 1, exercise_name: 'Bench', set_number: 1 }]));
  render(); await settle();
  const saving = form(render()).props.onSubmit(20, 8, false, 0);
  await settle();
  render.unmount();
  release(); await saving;
  assert.equal(calls, 0);
  assert.notEqual(await helpers.getSetSaveRequest('user', 'workout'), null);
});

test('retry resets only the saved exercise form, preserving other exercise drafts', async () => {
  const sets = [{ ...input, id: 1, exercise_name: 'Bench', set_number: 1 },
    { ...input, id: 2, exercise_id: 'squat', exercise_name: 'Squat', set_number: 1 }];
  let calls = 0;
  const helpers = api(storage(), async () => { if (++calls === 1) throw new ApiError(0); return log(sets); });
  const render = screen(helpers, log(sets));
  render(); await settle();
  await assert.rejects(form(render()).props.onSubmit(20, 8, false, 0));
  retry(render()).props.onPress(); await settle();
  const forms = nodes(render()).filter(node => node.type === 'SetForm');
  assert.deepEqual(forms.map(node => node.props.key), [1, 0]);
});

const titleField = tree => nodes(tree).find(node => node.type === 'TitleField');

test('name field stays mounted but locks while a set is unresolved, and is plain text once finished', async () => {
  const idle = screen(api(storage(), async () => log([])), log([]));
  idle(); await settle();
  assert.equal(titleField(idle()).props.editable, true);

  const helpers = api(storage(), async () => log([]));
  await helpers.prepareSetSaveRequest('user', 'workout', 'Bench', input);
  const blocked = screen(helpers);
  blocked(); await settle();
  assert.equal(titleField(blocked()).props.editable, false); // locked, not replaced: its draft survives

  const finishedLog = { ...log([]), finished_at: '2026-09-24T13:00:00Z' };
  const finished = screen(api(storage(), async () => log([])), finishedLog,
    { formatSessionDate: () => 'Thu, 24 Sep' });
  finished(); await settle();
  assert.equal(titleField(finished()), undefined);
  assert.match(JSON.stringify(finished()), /Edit workout/);
  assert.doesNotMatch(JSON.stringify(finished()), /Finish workout/);
});

function finishHarness(finish, cleanup = async () => {}) {
  let choices;
  const routes = [];
  const initial = log([{ ...input, id: 1, exercise_name: 'Bench', set_number: 1 }]);
  const render = screen(api(storage(), async () => initial), initial, {
    Alert: { alert: (_, __, buttons) => { choices = buttons; } },
    workoutsApi: { getWorkout: async () => initial, finishWorkout: finish },
    clearActiveWorkout: cleanup, clearTemplateSaveRequest: async () => {},
    useRouter: () => ({ dismissAll: () => routes.push('dismiss'), replace: route => routes.push(route) }),
  });
  return { render, routes, timers: render.timers, confirm() {
    const finish = nodes(render()).find(node => node.type === 'Pressable' &&
      node.props.accessibilityLabel === 'Finish workout');
    finish.props.onPress();
    return choices.find(choice => choice.text === 'Finish').onPress;
  } };
}

test('confirmed finish still leaves the screen when local pointer cleanup fails', async () => {
  const harness = finishHarness(async () => ({}), async () => { throw new Error('Storage unavailable'); });
  harness.render(); await settle();
  harness.confirm()(); await settle();
  assert.deepEqual(harness.routes, ['dismiss', '/']);
});

test('repeated finish confirmation sends once and synchronously blocks a stale add callback', async () => {
  let release;
  let calls = 0;
  const harness = finishHarness(() => { calls++; return new Promise(resolve => { release = resolve; }); });
  harness.render(); await settle();
  const add = form(harness.render()).props.onSubmit;
  const confirm = harness.confirm();
  confirm(); confirm();
  assert.equal(calls, 1);
  await assert.rejects(add(20, 8, false, 0), /Please wait/);
  release({}); await settle();
});

test('failed server finish retains the session and releases the lock for an explicit retry', async () => {
  let calls = 0, cleanups = 0;
  const harness = finishHarness(async () => { if (++calls === 1) throw new Error('Offline'); return {}; },
    async () => { cleanups++; });
  harness.render(); await settle();
  harness.confirm()(); await settle();
  assert.equal(cleanups, 0);
  assert.deepEqual(harness.routes, []);
  assert.match(JSON.stringify(harness.render()), /Offline/);
  harness.confirm()(); await settle();
  assert.equal(calls, 2);
  assert.equal(cleanups, 1);
  assert.deepEqual(harness.routes, ['dismiss', '/']);
});

// Rest timer lifecycle on the real screen callbacks (the countdown itself is covered by rest-timer.test.cjs).
const ownTimer = timers => timers.start({ userId: 'user', workoutId: 'workout' }, 90);

test('finishing a workout ends its rest timer, but a failed finish keeps it running', async () => {
  let calls = 0;
  const harness = finishHarness(async () => { if (++calls === 1) throw new Error('Offline'); return {}; });
  harness.render(); await settle();
  ownTimer(harness.timers);
  harness.confirm()(); await settle();
  assert.equal(harness.timers.getSnapshot().timer?.workoutId, 'workout'); // offline: still resting
  harness.confirm()(); await settle();
  assert.equal(harness.timers.getSnapshot().timer, null);
});

test('finishing does not touch a timer that belongs to another workout', async () => {
  const harness = finishHarness(async () => ({}));
  harness.render(); await settle();
  harness.timers.start({ userId: 'user', workoutId: 'other' }, 90);
  harness.confirm()(); await settle();
  assert.equal(harness.timers.getSnapshot().timer?.workoutId, 'other');
});

test('a finished workout shown read-only drops its timer; editing it keeps it until the edit ends', async () => {
  const finishedLog = { ...log([]), finished_at: '2026-09-24T13:00:00Z' };
  const render = screen(api(storage(), async () => log([])), finishedLog, { formatSessionDate: () => 'Thu, 24 Sep' });
  ownTimer(render.timers);
  render(); await settle(); render();
  assert.equal(render.timers.getSnapshot().timer, null);

  // Another workout's timer is not this screen's to end.
  render.timers.start({ userId: 'user', workoutId: 'other' }, 90);
  render();
  assert.equal(render.timers.getSnapshot().timer?.workoutId, 'other');
});

test('the screen registers while mounted and an editable view keeps the floating pill off the bottom of the display', async () => {
  const live = screen(api(storage(), async () => log([])), log([]));
  assert.equal(live.timers.isWorkoutScreenOpen('workout'), false);
  live(); await settle(); live();
  assert.equal(live.timers.isWorkoutScreenOpen('workout'), true);
  assert.equal(live.timers.getSnapshot().pillSuppressions, 1);
  live.unmount();
  assert.equal(live.timers.isWorkoutScreenOpen('workout'), false);
  assert.equal(live.timers.getSnapshot().pillSuppressions, 0);

  const finishedLog = { ...log([]), finished_at: '2026-09-24T13:00:00Z' };
  const past = screen(api(storage(), async () => log([])), finishedLog, { formatSessionDate: () => 'Thu, 24 Sep' });
  past(); await settle(); past();
  assert.equal(past.timers.getSnapshot().pillSuppressions, 0); // read-only: the pill may show
});

test('the screen starts and stops the shared timer through the store', () => {
  const source = read('app/(app)/workout/[id].tsx');
  const start = source.indexOf('function RestTimer(');
  const rest = source.slice(start, start + source.slice(start).search(/\r?\n\}\r?\n/));
  assert.ok(rest.length > 100 && rest.length < 5000, 'RestTimer component not isolated');
  assert.doesNotMatch(rest, /useState/); // no screen-local countdown to lose on navigation
  assert.match(rest, /restTimerStore\.start\(\{ userId, workoutId \}, seconds\)/);
  assert.match(rest, /restTimerStore\.clearForWorkout\(workoutId\)/);
  assert.match(source, /<RestTimer workoutId=\{id\} userId=\{userId\}/);
});

// Back pops the workout screen and the rest-timer pill pushes a fresh one: what was typed has to survive that.
const newDrafts = () => load(read('src/workout/setDraftStore.ts')).createSetDraftStore();
const sharedExercise = log([{ ...input, id: 1, exercise_name: 'Bench', set_number: 1 }]);
const benchForm = render => nodes(render()).filter(node => node.type === 'SetForm').find(node => JSON.stringify(node.props.lastSet).includes('Bench'));

test('a half-typed set is still there when the workout screen is closed and reopened', async () => {
  const drafts = newDrafts();
  const helpers = api(storage(), async () => sharedExercise);
  const first = screen(helpers, sharedExercise, { setDraftStore: drafts });
  first(); await settle();
  form(first()).props.onDraftChange({ weight: '82.5', reps: '6', rir: '2', isWarmup: true });
  first.unmount(); // Back

  const reopened = screen(helpers, sharedExercise, { setDraftStore: drafts }); // the pill pushes a fresh screen
  reopened(); await settle();
  const restored = form(reopened()).props.draft;
  assert.equal(restored.weight, '82.5');
  assert.equal(restored.reps, '6');
  assert.equal(restored.rir, '2');
  assert.equal(restored.isWarmup, true);
  assert.equal(benchForm(reopened) === undefined, false);
});

test('a draft never shows for another account or another workout', async () => {
  const drafts = newDrafts();
  drafts.saveDraft('someone-else', 'workout', 'bench', { weight: '99', reps: '9', rir: '', isWarmup: false });
  drafts.saveDraft('user', 'different-workout', 'bench', { weight: '98', reps: '8', rir: '', isWarmup: false });
  const render = screen(api(storage(), async () => sharedExercise), sharedExercise, { setDraftStore: drafts });
  render(); await settle();
  assert.equal(form(render()).props.draft.weight, '');
  assert.equal(form(render()).props.draft.reps, '');
});

test('an exercise picked but not yet logged is still on the workout after the screen is reopened', async () => {
  const drafts = newDrafts();
  let pick;
  const helpers = api(storage(), async () => sharedExercise);
  const options = { setDraftStore: drafts, usePickedExercise: onPick => { pick = onPick; return { openPicker() {} }; } };
  const first = screen(helpers, sharedExercise, options);
  first(); await settle();
  pick({ id: 'row', name: 'Row' });
  first(); // the pick lands in state, then the effect keeps it
  first.unmount();

  const reopened = screen(helpers, sharedExercise, options);
  reopened(); await settle();
  assert.match(JSON.stringify(reopened()), /Row/);
});

test('finishing the workout throws its drafts away; a failed finish keeps them', async () => {
  let calls = 0;
  const harness = finishHarness(async () => { if (++calls === 1) throw new Error('Offline'); return {}; });
  harness.render(); await settle();
  const drafts = harness.render.drafts;
  drafts.saveDraft('user', 'workout', 'bench', { weight: '80', reps: '8', rir: '', isWarmup: false });
  drafts.savePending('user', 'workout', [{ id: 'row', name: 'Row' }]);
  harness.confirm()(); await settle();
  assert.equal(drafts.getDraft('user', 'workout', 'bench').weight, '80'); // offline: the session goes on
  assert.equal(drafts.getPending('user', 'workout').length, 1);
  harness.confirm()(); await settle();
  assert.equal(drafts.getDraft('user', 'workout', 'bench').weight, '');
  assert.equal(drafts.getPending('user', 'workout').length, 0);
});

test('a confirmed retry of an unsent set clears that exercise draft so it does not come back with the rebuilt form', async () => {
  let calls = 0;
  const sets = [{ ...input, id: 1, exercise_name: 'Bench', set_number: 1 }];
  const helpers = api(storage(), async () => { if (++calls === 1) throw new ApiError(0); return log(sets); });
  const render = screen(helpers, log(sets));
  render(); await settle();
  form(render()).props.onDraftChange({ weight: '20', reps: '8', rir: '', isWarmup: false });
  await assert.rejects(form(render()).props.onSubmit(20, 8, false, 0));
  assert.equal(render.drafts.getDraft('user', 'workout', 'bench').weight, '20'); // the failure kept it
  retry(render()).props.onPress(); await settle();
  assert.equal(render.drafts.getDraft('user', 'workout', 'bench').weight, '');
  assert.equal(form(render()).props.draft.weight, '');
});
