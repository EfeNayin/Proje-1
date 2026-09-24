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
function view(request, props = { workoutId: 'current', exerciseId: 'bench', unit: 'kg' }) {
  const state = [];
  const effects = [];
  let cursor = 0;
  let effectCursor = 0;
  let pending = [];
  const hooks = {
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
  const { PreviousExercise } = load(read('src/workout/PreviousExercise.tsx'), { React: react }, {
    react: hooks,
    'react-native': { ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable',
      Text: 'Text', View: 'View', StyleSheet: { create: value => value } },
    '../api/workouts': { getPreviousExerciseSession: request },
    '../theme': { colors: {}, spacing: {} }, '../units/weight': units,
  });
  return {
    render() {
      cursor = 0; effectCursor = 0; pending = [];
      const tree = PreviousExercise(props);
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
  sets: [ { id: 1, set_number: 2, weight_kg: '20', reps: 8, rir: 0 },
    { id: 2, set_number: 3, weight_kg: '0', reps: 7, rir: null } ], ...changes });

test('fetches only on demand, displays actual values and preserves zero vs unknown RIR', async () => {
  const calls = [];
  const screen = view(async (...args) => { calls.push(args); return previous(); });
  screen.render();
  assert.equal(calls.length, 0);
  button(screen.render()).props.onPress();
  screen.render();
  assert.deepEqual(calls, [['current', 'bench']]);
  assert.ok(nodes(screen.render()).some(node => node.type === 'ActivityIndicator'));
  await settle();
  const result = text(screen.render());
  assert.match(result, /20 kg/);
  assert.match(result, /0 kg/);
  assert.match(result, /RIR 0/);
  assert.match(result, /RIR not recorded/);
  assert.match(result, /Push day/);
});

test('empty history is different from an error and failures can be retried', async () => {
  let fail = true;
  const screen = view(async () => { if (fail) throw new Error('Offline'); return null; });
  button(screen.render()).props.onPress();
  screen.render(); await settle();
  assert.match(text(screen.render()), /Could not load/);
  assert.doesNotMatch(text(screen.render()), /No earlier/);
  fail = false;
  button(screen.render(), 1).props.onPress();
  screen.render(); await settle();
  assert.match(text(screen.render()), /No earlier closed session/);
  assert.doesNotMatch(text(screen.render()), /Could not load/);
});

test('closing and reopening refetches; obsolete responses cannot overwrite the new request', async () => {
  const resolve = [];
  const screen = view(() => new Promise(done => resolve.push(done)));
  button(screen.render()).props.onPress(); screen.render();
  button(screen.render()).props.onPress(); screen.render();
  button(screen.render()).props.onPress(); screen.render();
  assert.equal(resolve.length, 2);
  resolve[1](previous({ title: 'Updated record' })); await settle();
  resolve[0](previous({ title: 'Stale record' })); await settle();
  assert.match(text(screen.render()), /Updated record/);
  assert.doesNotMatch(text(screen.render()), /Stale record/);
});

test('unmount ignores a pending response', async () => {
  let resolve;
  const screen = view(() => new Promise(done => { resolve = done; }));
  button(screen.render()).props.onPress(); screen.render();
  const before = JSON.stringify(screen.state);
  screen.unmount(); resolve(previous()); await settle();
  assert.equal(JSON.stringify(screen.state), before);
});

test('weight preferences and automatic or unknown closure are displayed explicitly', async () => {
  for (const closure of [true, null]) {
    const screen = view(async () => previous({ finished_automatically: closure }),
      { workoutId: 'current', exerciseId: 'bench', unit: 'lb' });
    button(screen.render()).props.onPress(); screen.render(); await settle();
    const result = text(screen.render());
    assert.match(result, /44.1 lb/);
    assert.match(result, closure === true ? /Automatically closed/ : /closure method not recorded/);
  }
});

test('previous-session API uses the specific workout and exercise as its reference', async () => {
  const calls = [];
  const api = load(read('src/api/workouts.ts'), {}, { './client': {
    apiRequest: async (...args) => { calls.push(args); return null; },
  } });
  assert.equal(await api.getPreviousExerciseSession('old-workout', 'bench'), null);
  assert.deepEqual(calls, [['/workouts/old-workout/exercises/bench/previous']]);
});
