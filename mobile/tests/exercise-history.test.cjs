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

function view(request, props = { workoutId: 'current', exerciseId: 'bench', exerciseName: 'Bench Press', unit: 'kg' }) {
  const state = [];
  const effects = [];
  let cursor = 0;
  let effectCursor = 0;
  let pending = [];
  const dismissed = [];
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
    'react-native': {
      ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', Text: 'Text', View: 'View',
      FlatList: 'FlatList', Modal: 'Modal', ScrollView: 'ScrollView',
      Keyboard: { dismiss: () => dismissed.push(true) },
      StyleSheet: { create: value => value, hairlineWidth: 1, absoluteFill: { position: 'absolute' } },
    },
    'react-native-safe-area-context': { SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView' },
    '../api/workouts': { getExerciseHistory: request },
    '../romanTheme': { roman: {}, romanFont: {} }, '../units/weight': units,
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
    dismissed,
  };
}
// FlatList never receives real children (data/renderItem/List*Component are
// props, not JSX children), so it needs its own expansion: run renderItem
// over data and splice in the header/footer elements in display order.
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (tree.type === 'FlatList') {
    const { data = [], renderItem, ListHeaderComponent, ListFooterComponent } = tree.props;
    return [
      tree,
      ...nodes(ListHeaderComponent),
      ...data.flatMap(item => nodes(renderItem({ item }))),
      ...nodes(ListFooterComponent),
    ];
  }
  return [tree, ...nodes(tree.props?.children)];
}
const pressables = tree => nodes(tree).filter(node => node.type === 'Pressable');
// JSON.stringify of an ancestor Pressable (backdrop, panel wrapper) also
// contains any button text nested inside it, so a plain .find() would return
// the wrapper instead of the actual button. The innermost match is always
// last in pre-order traversal, since none of these leaf buttons nest another
// Pressable inside themselves.
const findButton = (tree, regex) => {
  const matches = pressables(tree).filter(node => regex.test(JSON.stringify(node)));
  return matches[matches.length - 1];
};
const openButton = tree => findButton(tree, /All earlier sessions/);
const closeButton = tree => findButton(tree, /"accessibilityLabel":"Close exercise history"/);
const retryButton = tree => findButton(tree, /Retry history/);
const loadMoreButton = tree => findButton(tree, /Load older sessions/);
const backdrop = tree => pressables(tree).find(node => node.props.testID === 'history-backdrop');
const modalNode = tree => nodes(tree).find(node => node.type === 'Modal');
const text = tree => JSON.stringify(nodes(tree));
const settle = () => new Promise(resolve => setImmediate(resolve));
const previous = (changes = {}) => ({ workout_id: 'old', title: 'Push day',
  performed_at: '2026-08-01T12:00:00Z', finished_automatically: false,
  sets: [ { id: 1, exercise_id: 'bench', set_number: 2, weight_kg: '20', reps: 8, rir: 0 },
    { id: 2, exercise_id: 'bench', set_number: 3, weight_kg: '0', reps: 7, rir: null } ], ...changes });
const page = (id, cursor = null) => ({ items: [previous({ workout_id: id, title: id })], next_cursor: cursor });

test('history stays hidden and request-free until opened, then paginates once per tap', async () => {
  const calls = [];
  const props = { workoutId: 'current', exerciseId: 'bench', exerciseName: 'Bench Press', unit: 'kg' };
  const screen = view(async (...args) => { calls.push(args); return args[2] === null ? page('first', 'next') : page('older'); }, props);
  assert.equal(modalNode(screen.render()), undefined);
  assert.equal(calls.length, 0);
  openButton(screen.render()).props.onPress(); screen.render(); await settle();
  assert.ok(modalNode(screen.render()));
  assert.match(text(screen.render()), /RIR 0/);
  assert.match(text(screen.render()), /RIR not recorded/);
  const more = loadMoreButton(screen.render());
  more.props.onPress(); more.props.onPress(); screen.render(); await settle();
  assert.deepEqual(calls, [['current', 'bench', null], ['current', 'bench', 'next']]);
  assert.match(text(screen.render()), /first/);
  assert.match(text(screen.render()), /older/);
  assert.match(text(screen.render()), /All earlier sessions loaded/);
  props.unit = 'lb';
  assert.match(text(screen.render()), /44.1 lb/);
  assert.equal(calls.length, 2);
});

test('the modal header shows the actual exercise name passed by the caller', async () => {
  const screen = view(async () => page('first'), { workoutId: 'current', exerciseId: 'squat',
    exerciseName: 'Back Squat', unit: 'kg' });
  openButton(screen.render()).props.onPress(); screen.render(); await settle();
  assert.match(text(screen.render()), /Exercise history/);
  assert.match(text(screen.render()), /Back Squat/);
});

test('the close button, backdrop tap and Android back button share the same close handler', async () => {
  const screen = view(async () => page('first'));
  openButton(screen.render()).props.onPress(); screen.render(); await settle();
  const tree = screen.render();
  const modal = modalNode(tree);
  const close = closeButton(tree);
  assert.equal(typeof close.props.onPress, 'function');
  assert.equal(modal.props.onRequestClose, close.props.onPress);
  assert.equal(backdrop(tree).props.onPress, close.props.onPress);
  close.props.onPress(); screen.render();
  assert.equal(modalNode(screen.render()), undefined);
});

test('opening the panel dismisses the keyboard', async () => {
  const screen = view(async () => page('first'));
  assert.equal(screen.dismissed.length, 0);
  openButton(screen.render()).props.onPress(); screen.render();
  assert.equal(screen.dismissed.length, 1);
});

test('a failed older page retains loaded records and retries the same cursor without duplicating rows', async () => {
  const cursors = [];
  let fail = true;
  const screen = view(async (_workout, _exercise, cursor) => {
    cursors.push(cursor);
    if (cursor === null) return page('first', 'next');
    if (fail) throw new Error('Offline');
    return { items: [previous({ workout_id: 'first' }), previous({ workout_id: 'older' })], next_cursor: null };
  });
  openButton(screen.render()).props.onPress(); screen.render(); await settle();
  loadMoreButton(screen.render()).props.onPress(); screen.render(); await settle();
  assert.match(text(screen.render()), /first/);
  assert.match(text(screen.render()), /Could not load/);
  assert.doesNotMatch(text(screen.render()), /All earlier sessions loaded/);
  fail = false;
  retryButton(screen.render()).props.onPress(); screen.render(); await settle();
  assert.deepEqual(cursors, [null, 'next', 'next']);
  const list = nodes(screen.render()).find(node => node.type === 'FlatList');
  assert.equal(list.props.data.filter(item => item.workout_id === 'first').length, 1);
  assert.doesNotMatch(text(screen.render()), /Could not load/);
});

test('closing then reopening refetches from the first page; late stale responses cannot overwrite it', async () => {
  for (const rejectOld of [false, true]) {
    const pending = [];
    const screen = view(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
    openButton(screen.render()).props.onPress(); screen.render();
    closeButton(screen.render()).props.onPress(); screen.render();
    openButton(screen.render()).props.onPress(); screen.render();
    assert.equal(pending.length, 2);
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
  openButton(screen.render()).props.onPress(); screen.render();
  const before = JSON.stringify(screen.state);
  screen.unmount(); resolve(page('late')); await settle();
  assert.equal(JSON.stringify(screen.state), before);
});

test('empty history differs from an initial failure and can be retried', async () => {
  let fail = true;
  const screen = view(async () => { if (fail) throw new Error('Offline'); return { items: [], next_cursor: null }; });
  openButton(screen.render()).props.onPress(); screen.render(); await settle();
  assert.match(text(screen.render()), /Could not load/);
  assert.doesNotMatch(text(screen.render()), /No earlier/);
  fail = false;
  retryButton(screen.render()).props.onPress(); screen.render(); await settle();
  assert.match(text(screen.render()), /No earlier closed session/);
});

test('history preserves automatic and unknown closure labels', async () => {
  for (const closure of [true, null]) {
    const screen = view(async () => ({ items: [previous({ finished_automatically: closure })], next_cursor: null }));
    openButton(screen.render()).props.onPress(); screen.render(); await settle();
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

test('structure check on the rendered tree: Modal, one vertical FlatList, fixed header, 44pt close target', async () => {
  const screen = view(async () => page('first'), { workoutId: 'current', exerciseId: 'bench',
    exerciseName: 'Very Long Incline Dumbbell Bench Press With Neutral Grip', unit: 'kg' });
  openButton(screen.render()).props.onPress(); screen.render(); await settle();
  const tree = screen.render();
  const all = nodes(tree);
  assert.equal(all.filter(node => node.type === 'FlatList').length, 1);
  assert.equal(all.filter(node => node.type === 'ScrollView').length, 0);
  assert.equal(all.find(node => node.type === 'FlatList').props.horizontal, undefined);
  // The header sits outside the list, so scrolling never moves it away.
  const list = all.find(node => node.type === 'FlatList');
  assert.ok(!nodes(list.props.ListHeaderComponent).some(node => /Exercise history/.test(JSON.stringify(node))));
  const title = all.find(node => node.props?.accessibilityRole === 'header');
  assert.match(JSON.stringify(title), /Exercise history/);
  const name = all.find(node => node.type === 'Text' && /Very Long/.test(JSON.stringify(node)));
  assert.ok(name.props.numberOfLines >= 2);
  const close = closeButton(tree);
  assert.ok(close.props.style.minWidth >= 44 && close.props.style.minHeight >= 44);
  assert.equal(close.props.accessibilityRole, 'button');
  // The backdrop is not an ancestor of the list, so list gestures cannot reach it.
  assert.ok(!nodes(backdrop(tree).props.children).some(node => node.type === 'FlatList'));
});

test('static wiring check (not a runtime proof): the history is keyed per workout/date/exercise and passes the card name', () => {
  const screen = read('app/(app)/workout/[id].tsx');
  assert.match(screen, /key=\{`\$\{workout\.id\}:\$\{workout\.performed_at\}:\$\{block\.exerciseId\}`\}/);
  assert.match(screen, /exerciseName=\{block\.name\}/);
  assert.match(read('src/workout/PreviousExercise.tsx'), /key=\{`\$\{workoutId\}:\$\{exerciseId\}`\}/);
});

test('a first-page failure shows no stale rows and a double retry tap starts one request', async () => {
  const calls = [];
  const screen = view(async (...args) => { calls.push(args); throw new Error('Offline'); });
  openButton(screen.render()).props.onPress(); screen.render(); await settle();
  assert.equal(nodes(screen.render()).find(node => node.type === 'FlatList').props.data.length, 0);
  const retry = retryButton(screen.render());
  retry.props.onPress(); retry.props.onPress(); screen.render(); await settle();
  assert.equal(calls.length, 2);
});

test('pages that repeat a session are merged without duplicates and keep zero weight and RIR 0', async () => {
  const screen = view(async (_w, _e, cursor) => cursor === null
    ? { items: [previous({ workout_id: 'a' })], next_cursor: 'c1' }
    : { items: [previous({ workout_id: 'a' }), previous({ workout_id: 'b' })], next_cursor: null });
  openButton(screen.render()).props.onPress(); screen.render(); await settle();
  loadMoreButton(screen.render()).props.onPress(); screen.render(); await settle();
  const data = nodes(screen.render()).find(node => node.type === 'FlatList').props.data;
  assert.deepEqual([...data.map(item => item.workout_id)], ['a', 'b']);
  const lines = nodes(screen.render()).filter(node => node.type === 'Text')
    .map(node => [node.props.children].flat(Infinity).join(''));
  assert.ok(lines.includes('3. 0 kg × 7 · RIR not recorded'));
  assert.ok(lines.includes('2. 20 kg × 8 · RIR 0'));
});

test('a response that arrives after closing does not change the next open', async () => {
  const pending = [];
  const screen = view(() => new Promise(resolve => pending.push(resolve)));
  openButton(screen.render()).props.onPress(); screen.render();
  closeButton(screen.render()).props.onPress(); screen.render();
  pending[0](page('late')); await settle();
  assert.equal(modalNode(screen.render()), undefined);
  openButton(screen.render()).props.onPress(); screen.render();
  assert.doesNotMatch(text(screen.render()), /late/);
});
