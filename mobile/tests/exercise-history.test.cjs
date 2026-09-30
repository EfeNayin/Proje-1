/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const ts = require('typescript');
const read = file => readFileSync(path.join(root, file), 'utf8');

function load(source, globals = {}, modules = {}) {
  const loaded = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
  } }).outputText;
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, ...globals,
    require: name => { if (!(name in modules)) throw new Error(name); return modules[name]; },
  });
  return loaded.exports;
}
const units = load(read('src/units/weight.ts'));
const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) };
function view(request, props = { workoutId: 'current', exerciseId: 'bench', unit: 'kg', currentSets: [] }) {
  const state = [];
  const effects = [];
  let cursor = 0;
  let effectCursor = 0;
  let pending = [];
  const hooks = {
    useRef(initial) {
      const index = cursor++;
      state[index] ??= { current: initial };
      return state[index];
    },
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
    useEffect(callback, deps) {
      const index = effectCursor++;
      if (effects[index]?.deps.every((value, i) => value === deps[i])) return;
      pending.push(() => {
        effects[index]?.cleanup?.();
        effects[index] = { deps, cleanup: callback() };
      });
    },
  };
  const { ExerciseHistory } = load(read('src/workout/ExerciseHistory.tsx'), { React: react }, {
    react: hooks,
    'react-native': { ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable',
      Text: 'Text', View: 'View', StyleSheet: { create: value => value } },
    '../api/workouts': { getExerciseHistory: request },
    '../theme': { colors: {}, spacing: {} }, '../units/weight': units,
  });
  return {
    render() {
      cursor = 0; effectCursor = 0; pending = [];
      const tree = ExerciseHistory(props);
      pending.forEach(effect => effect());
      return tree;
    },
    unmount() { effects.forEach(effect => effect?.cleanup?.()); },
    state,
  };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const button = (tree, index = 0) => nodes(tree).filter(node => node.type === 'Pressable')[index];
const text = tree => JSON.stringify(tree);
const settle = () => new Promise(resolve => setImmediate(resolve));
const previous = (changes = {}) => ({ workout_id: 'old', title: 'Push day',
  performed_at: '2026-08-01T12:00:00Z', finished_automatically: false,
  sets: [ { id: 1, exercise_id: 'bench', set_number: 2, weight_kg: '20', reps: 8, rir: 0 },
    { id: 2, exercise_id: 'bench', set_number: 3, weight_kg: '0', reps: 7, rir: null } ], ...changes });


const page = (id, cursor = null) => ({ items: [previous({ workout_id: id, title: id })], next_cursor: cursor });

test('history loads only on demand, paginates once per tap and preserves units and unknown RIR', async () => {
  const calls = [];
  const props = { workoutId: 'current', exerciseId: 'bench', unit: 'kg' };
  const screen = view(async (...args) => { calls.push(args); return args[2] === null ? page('first', 'next') : page('older'); }, props);
  screen.render();
  assert.equal(calls.length, 0);
  button(screen.render()).props.onPress(); screen.render(); await settle();
  assert.match(text(screen.render()), /RIR 0/);
  assert.match(text(screen.render()), /RIR not recorded/);
  const more = button(screen.render(), 1);
  more.props.onPress(); more.props.onPress(); screen.render(); await settle();
  assert.deepEqual(calls, [['current', 'bench', null], ['current', 'bench', 'next']]);
  assert.match(text(screen.render()), /first/);
  assert.match(text(screen.render()), /older/);
  assert.match(text(screen.render()), /All earlier sessions loaded/);
  props.unit = 'lb';
  assert.match(text(screen.render()), /44.1 lb/);
  assert.equal(calls.length, 2);
});

test('a failed older page retains records and retries the same cursor without duplicating rows', async () => {
  const cursors = [];
  let fail = true;
  const screen = view(async (_workout, _exercise, cursor) => {
    cursors.push(cursor);
    if (cursor === null) return page('first', 'next');
    if (fail) throw new Error('Offline');
    return { items: [previous({ workout_id: 'first' }), previous({ workout_id: 'older' })], next_cursor: null };
  });
  button(screen.render()).props.onPress(); screen.render(); await settle();
  button(screen.render(), 1).props.onPress(); screen.render(); await settle();
  assert.match(text(screen.render()), /first/);
  assert.match(text(screen.render()), /Could not load/);
  assert.doesNotMatch(text(screen.render()), /All earlier sessions loaded/);
  fail = false;
  button(screen.render(), 1).props.onPress(); screen.render(); await settle();
  assert.deepEqual(cursors, [null, 'next', 'next']);
  assert.equal(nodes(screen.render()).filter(node => node.props?.key === 'first').length, 1);
  assert.doesNotMatch(text(screen.render()), /Could not load/);
});

test('closing and reopening clears pages and ignores old successes and failures', async () => {
  for (const rejectOld of [false, true]) {
    const pending = [];
    const screen = view(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
    button(screen.render()).props.onPress(); screen.render();
    button(screen.render()).props.onPress(); screen.render();
    button(screen.render()).props.onPress(); screen.render();
    pending[1].resolve(page('fresh')); await settle();
    if (rejectOld) pending[0].reject(new Error('Old error'));
    else pending[0].resolve(page('stale'));
    await settle();
    assert.match(text(screen.render()), /fresh/);
    assert.doesNotMatch(text(screen.render()), /stale|Could not load/);
  }
});

test('unmount ignores a pending history page', async () => {
  let resolve;
  const screen = view(() => new Promise(done => { resolve = done; }));
  button(screen.render()).props.onPress(); screen.render();
  const before = JSON.stringify(screen.state);
  screen.unmount(); resolve(page('late')); await settle();
  assert.equal(JSON.stringify(screen.state), before);
});

test('empty history differs from an initial failure and can be retried', async () => {
  let fail = true;
  const screen = view(async () => { if (fail) throw new Error('Offline'); return { items: [], next_cursor: null }; });
  button(screen.render()).props.onPress(); screen.render(); await settle();
  assert.match(text(screen.render()), /Could not load/);
  assert.doesNotMatch(text(screen.render()), /No earlier/);
  fail = false;
  button(screen.render(), 1).props.onPress(); screen.render(); await settle();
  assert.match(text(screen.render()), /No earlier closed session/);
});

test('history preserves automatic and unknown closure labels', async () => {
  for (const closure of [true, null]) {
    const screen = view(async () => ({ items: [previous({ finished_automatically: closure })], next_cursor: null }));
    button(screen.render()).props.onPress(); screen.render(); await settle();
    assert.match(text(screen.render()), closure ? /Automatically closed/ : /closure method not recorded/);
  }
});

test('history API encodes opaque cursors and keeps the reference workout and exercise', async () => {
  const calls = [];
  const api = load(read('src/api/workouts.ts'), {}, { './client': {
    apiRequest: async (...args) => { calls.push(args); return { items: [], next_cursor: null }; },
  } });
  await api.getExerciseHistory('current', 'bench');
  await api.getExerciseHistory('current', 'bench', 'a+/=');
  assert.deepEqual(calls, [
    ['/workouts/current/exercises/bench/history?limit=10'],
    ['/workouts/current/exercises/bench/history?limit=10&cursor=a%2B%2F%3D'],
  ]);
});
