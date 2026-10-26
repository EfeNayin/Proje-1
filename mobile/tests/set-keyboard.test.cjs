/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const dependencies = process.env.BODYTRACK_DEPENDENCIES || root;
const ts = require(require.resolve('typescript', { paths: [dependencies] }));

// The keyboard's Done action reaches a TextInput as onSubmitEditing (and, with
// submitBehavior "blurAndSubmit", blurs it). It must never record or change a set.
// These tests drive the real SetForm / SetRow functions with host-element adapters:
// event and state behavior only, not native layout (see e2e/flows for that).

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
const read = file => readFileSync(path.join(root, file), 'utf8');
const rir = load(read('src/workout/rir.ts'));
const units = load(read('src/units/weight.ts'));
const { revealOffset, REVEAL_MARGIN } = load(read('src/workout/revealOffset.ts'));

function screen(name, props) {
  const source = read('app/(app)/workout/[id].tsx');
  const parsed = ts.createSourceFile('screen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ['RirField', 'SetForm', 'SetRow', 'ReadOnlySetRow', 'rirCell'];
  const functions = parsed.statements.filter(node => ts.isFunctionDeclaration(node) &&
    names.includes(node.name?.text)).map(node => node.getText(parsed)).join('\n');
  const state = [];
  let cursor = 0;
  const api = load(`${functions}\nexport { ${names.join(', ')} };`, {
    ...rir, ...units,
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      state[index] ??= { current: initial };
      return state[index];
    },
    React: { createElement: (type, properties, ...children) => ({ type, props: { ...properties, children } }) },
    View: 'View', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable',
    ActivityIndicator: 'ActivityIndicator', Ionicons: 'Ionicons',
    Alert: { alert() {} }, light: {},
    styles: new Proxy({}, { get: (_, key) => key }),
  });
  return () => { cursor = 0; return api[name](props); };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
// The shallow render leaves RirField unexpanded; render it so its TextInput is covered too.
const rirField = tree => nodes(tree).find(node => node.type?.name === 'RirField');
const inputs = tree => [
  ...nodes(tree).filter(node => node.type === 'TextInput'),
  ...(rirField(tree) ? nodes(screen('RirField', rirField(tree).props)()).filter(node => node.type === 'TextInput') : []),
];
const byLabel = (tree, label) => nodes(tree).find(node => node.props.accessibilityLabel === label);
const weightOf = tree => inputs(tree).find(node => /^Weight in /.test(node.props.accessibilityLabel));
const repsOf = tree => byLabel(tree, 'Reps');
const rirOf = tree => rirField(tree);
const logSet = tree => byLabel(tree, 'Log set');
const saveSet = tree => byLabel(tree, 'Save set');
const settle = () => new Promise(resolve => setImmediate(resolve));
const lastSet = { id: 1, weight_kg: '20', reps: 8, rir: 3, is_warmup: false, set_number: 1 };

// What the keyboard does when Done is pressed, for every input that is rendered.
function pressKeyboardDone(tree) {
  for (const input of inputs(tree)) input.props.onSubmitEditing?.({ nativeEvent: { text: input.props.value } });
}

test('new set: keyboard Done records nothing and the draft is still there afterwards', async () => {
  const calls = [];
  const render = screen('SetForm', { unit: 'kg', busy: false, lastSet,
    onSubmit: async (...args) => { calls.push(args); } });
  weightOf(render()).props.onChangeText('82.5');
  repsOf(render()).props.onChangeText('6');
  rirOf(render()).props.onChangeText('2');

  pressKeyboardDone(render());
  await settle();

  assert.equal(calls.length, 0);
  assert.equal(weightOf(render()).props.value, '82.5');
  assert.equal(repsOf(render()).props.value, '6');
  assert.equal(rirOf(render()).props.value, '2');
  // Done dismisses the keyboard instead: the field blurs when submitted.
  for (const input of inputs(render())) assert.equal(input.props.submitBehavior, 'blurAndSubmit');
  // Every number pad offers a Done key (iOS shows none without a return key type), and
  // so does the decimal pad on a hardware keyboard.
  for (const input of inputs(render())) assert.equal(input.props.returnKeyType, 'done');
});

test('new set: only the explicit Log set records it, once', async () => {
  const calls = [];
  const render = screen('SetForm', { unit: 'kg', busy: false, lastSet,
    onSubmit: async (...args) => { calls.push(args); } });
  weightOf(render()).props.onChangeText('82.5');
  repsOf(render()).props.onChangeText('6');
  pressKeyboardDone(render());
  logSet(render()).props.onPress();
  await settle();
  assert.deepEqual(calls, [[82.5, 6, false, null]]);
});

test('keyboard Done followed by Log set no longer produces two sets', async () => {
  const calls = [];
  const render = screen('SetForm', { unit: 'kg', busy: false, lastSet,
    onSubmit: async (...args) => { calls.push(args); } });
  weightOf(render()).props.onChangeText('80');
  repsOf(render()).props.onChangeText('8');
  pressKeyboardDone(render());
  logSet(render()).props.onPress();
  await settle();
  assert.equal(calls.length, 1);
});

test('two separate explicit Log set actions with identical values record two sets', async () => {
  const calls = [];
  const render = screen('SetForm', { unit: 'kg', busy: false, lastSet,
    onSubmit: async (...args) => { calls.push(args); } });
  for (let i = 0; i < 2; i++) {
    weightOf(render()).props.onChangeText('80');
    repsOf(render()).props.onChangeText('8');
    logSet(render()).props.onPress();
    await settle();
  }
  assert.deepEqual(calls, [[80, 8, false, null], [80, 8, false, null]]);
  // Nothing compares values or timestamps: a blank form repeats the previous set too.
  logSet(render()).props.onPress();
  await settle();
  assert.equal(calls.length, 3);
});

test('an in-flight save still ignores a second press, with or without the keyboard', async () => {
  let release;
  let count = 0;
  const render = screen('SetForm', { unit: 'kg', busy: false, lastSet,
    onSubmit: () => { count++; return new Promise(resolve => { release = resolve; }); } });
  weightOf(render()).props.onChangeText('80');
  repsOf(render()).props.onChangeText('8');
  const button = logSet(render());
  button.props.onPress();
  button.props.onPress();
  pressKeyboardDone(render());
  assert.equal(count, 1);
  release();
  await settle();
  assert.equal(count, 1);
});

test('a failed save keeps the draft; keyboard Done afterwards does not retry it', async () => {
  let count = 0;
  const render = screen('SetForm', { unit: 'kg', busy: false, lastSet,
    onSubmit: async () => { count++; throw new Error('Network unavailable'); } });
  weightOf(render()).props.onChangeText('80');
  repsOf(render()).props.onChangeText('8');
  logSet(render()).props.onPress();
  await settle();
  assert.equal(count, 1);
  assert.equal(weightOf(render()).props.value, '80');
  assert.ok(JSON.stringify(render()).includes('Network unavailable'));
  pressKeyboardDone(render());
  await settle();
  assert.equal(count, 1);
});

test('editing a set: keyboard Done neither saves nor discards the edit', async () => {
  const saves = [];
  const render = screen('SetRow', { set: { ...lastSet, rir: 3 }, unit: 'kg', onDelete() {},
    onSave: async (...args) => { saves.push(args); } });
  render().props.onPress();
  weightOf(render()).props.onChangeText('85');
  repsOf(render()).props.onChangeText('7');

  pressKeyboardDone(render());
  await settle();

  assert.equal(saves.length, 0);
  assert.equal(weightOf(render()).props.value, '85');
  assert.equal(repsOf(render()).props.value, '7');
  assert.ok(byLabel(render(), 'Save set'), 'the editor stays open until Save or Cancel');
  for (const input of inputs(render())) assert.equal(input.props.submitBehavior, 'blurAndSubmit');
  assert.equal(repsOf(render()).props.returnKeyType, 'done');
  assert.equal(inputs(render()).find(i => i.props.keyboardType === 'number-pad' && i.props.accessibilityLabel.startsWith('Recorded RIR')).props.returnKeyType, 'done');
});

test('editing a set: the explicit Save updates it once; Cancel leaves the saved values alone', async () => {
  const saves = [];
  const render = screen('SetRow', { set: { ...lastSet, rir: 3 }, unit: 'kg', onDelete() {},
    onSave: async (...args) => { saves.push(args); } });
  render().props.onPress();
  weightOf(render()).props.onChangeText('85');
  pressKeyboardDone(render());
  byLabel(render(), 'Cancel editing').props.onPress();
  assert.equal(saves.length, 0);
  assert.ok(JSON.stringify(render()).includes('Set 1, 20 kg for 8 reps'));

  render().props.onPress();
  assert.equal(weightOf(render()).props.value, '20');
  weightOf(render()).props.onChangeText('85');
  pressKeyboardDone(render());
  saveSet(render()).props.onPress();
  saveSet(render())?.props.onPress();
  await settle();
  assert.deepEqual(saves, [[1, 85, 8, 3]]);
});

test('editing a set: a failed Save keeps the editor and the draft', async () => {
  const render = screen('SetRow', { set: lastSet, unit: 'kg', onDelete() {},
    onSave: async () => { throw new Error('Offline'); } });
  render().props.onPress();
  weightOf(render()).props.onChangeText('85');
  saveSet(render()).props.onPress();
  await settle();
  assert.equal(weightOf(render()).props.value, '85');
  assert.ok(JSON.stringify(render()).includes('Offline'));
  pressKeyboardDone(render());
  assert.ok(byLabel(render(), 'Save set'));
});

test('only the workout title still submits on the keyboard; no numeric field does', () => {
  const source = read('app/(app)/workout/[id].tsx');
  const submits = source.match(/onSubmitEditing=/g) ?? [];
  assert.equal(submits.length, 1);
  assert.match(source, /onBlur=\{commit\}\s*\n\s*onSubmitEditing=\{commit\}/);
});

// ── keeping the action above the keyboard ──

test('revealOffset: already visible, below, above, taller than the area, and edges', () => {
  const area = { offset: 100, viewportHeight: 300, margin: 12 };
  assert.equal(revealOffset({ ...area, targetTop: 150, targetBottom: 330 }), null);
  // The panel's foot (where Log set / Save is) is below the visible area: scroll just enough.
  assert.equal(revealOffset({ ...area, targetTop: 300, targetBottom: 480 }), 480 + 12 - 300);
  // Above the visible area: bring its top back.
  assert.equal(revealOffset({ ...area, targetTop: 40, targetBottom: 220 }), 28);
  // Taller than the area: the bottom edge, with the action, wins.
  assert.equal(revealOffset({ ...area, targetTop: 150, targetBottom: 650 }), 650 + 12 - 300);
  assert.equal(revealOffset({ ...area, offset: 50, targetTop: 5, targetBottom: 100 }), 0);
  assert.equal(revealOffset({ ...area, viewportHeight: 0, targetTop: 300, targetBottom: 480 }), null);
});

function hook() {
  const listeners = {};
  const refs = [];
  let cursor = 0;
  const run = load(read('src/workout/useEntryReveal.ts'), {}, {
    react: {
      useRef(initial) { const i = cursor++; refs[i] ??= { current: initial }; return refs[i]; },
      useCallback: fn => fn,
      useEffect(fn) { fn(); },
    },
    'react-native': { Keyboard: { addListener(event, handler) {
      listeners[event] = handler;
      return { remove() { delete listeners[event]; } };
    } } },
    './revealOffset': { revealOffset, REVEAL_MARGIN },
  }).useEntryReveal;
  const api = run();
  const scrolls = [];
  api.scrollRef.current = { scrollTo: options => scrolls.push(options.y) };
  api.scrollProps.innerViewRef.current = {};
  const panel = (y, height) => ({ measureLayout: (_content, ok) => ok(0, y, 300, height) });
  return { api, listeners, scrolls, panel };
}

test('the focused panel is scrolled above the keyboard once the keyboard is up', () => {
  const { api, listeners, scrolls, panel } = hook();
  api.scrollProps.onLayout({ nativeEvent: { layout: { height: 300 } } });
  api.revealEntry(panel(500, 150));
  assert.deepEqual(scrolls, [], 'nothing to do before the keyboard is shown');

  listeners.keyboardDidShow();
  assert.deepEqual(scrolls, [650 + REVEAL_MARGIN - 300]);

  // Already visible after that scroll: no further movement.
  api.scrollProps.onScroll({ nativeEvent: { contentOffset: { y: 650 + REVEAL_MARGIN - 300 } } });
  api.scrollProps.onContentSizeChange();
  assert.equal(scrolls.length, 1);
});

test('content growing under an open keyboard (a logged set) re-reveals the form', () => {
  const { api, listeners, scrolls } = hook();
  api.scrollProps.onLayout({ nativeEvent: { layout: { height: 300 } } });
  listeners.keyboardDidShow();
  let y = 400;
  api.revealEntry({ measureLayout: (_content, ok) => ok(0, y, 300, 150) });
  const first = scrolls.length;
  api.scrollProps.onScroll({ nativeEvent: { contentOffset: { y: scrolls[first - 1] } } });
  y = 460; // a set row was added above the form
  api.scrollProps.onContentSizeChange();
  assert.equal(scrolls.length, first + 1);
});

test('a late keyboard-hidden event from the previous form does not make the next form unreachable', () => {
  const { api, listeners, scrolls, panel } = hook();
  api.scrollProps.onLayout({ nativeEvent: { layout: { height: 300 } } });
  listeners.keyboardDidShow();
  api.revealEntry(panel(500, 150));
  // The saved set replaced the form: the new form takes focus before the old keyboard's
  // hidden event is delivered, and the next keyboard then shows.
  api.revealEntry(panel(700, 150));
  listeners.keyboardDidHide();
  const before = scrolls.length;
  listeners.keyboardDidShow();
  assert.equal(scrolls.length, before + 1);
  assert.equal(scrolls[scrolls.length - 1], 850 + REVEAL_MARGIN - 300);
});

test('once no field of the panel has focus it is forgotten, so other keyboards do not scroll it', () => {
  const { api, listeners, scrolls, panel } = hook();
  api.scrollProps.onLayout({ nativeEvent: { layout: { height: 300 } } });
  api.revealEntry(panel(500, 150));
  api.revealEntry(panel(500, 150)); // moving between two fields: focus arrives twice
  api.releaseEntry();
  api.releaseEntry();
  listeners.keyboardDidShow(); // e.g. the workout title
  api.scrollProps.onContentSizeChange();
  assert.deepEqual(scrolls, []);
  // Focus before blur (the next field takes focus first) keeps the panel tracked.
  api.revealEntry(panel(500, 150));
  api.revealEntry(panel(500, 150));
  api.releaseEntry();
  api.scrollProps.onContentSizeChange();
  assert.equal(scrolls.length > 0, true);
});

test('screen wiring: one scroll area, both panels report focus to it', () => {
  const source = read('app/(app)/workout/[id].tsx');
  assert.match(source, /const \{ scrollRef, scrollProps, revealEntry, releaseEntry \} = useEntryReveal\(\);/);
  assert.match(source, /<ScrollView\s+ref=\{scrollRef\}\s+\{\.\.\.scrollProps\}/);
  assert.equal((source.match(/onEntryFocus=\{revealEntry\}/g) ?? []).length, 2);
  assert.equal((source.match(/onEntryBlur=\{releaseEntry\}/g) ?? []).length, 2);
  // Every field of both panels reports focus.
  assert.equal((source.match(/onFocus=\{focusPanel\}/g) ?? []).length, 3);
  assert.equal((source.match(/onFocus=\{focusEditor\}/g) ?? []).length, 3);
  assert.equal((source.match(/onBlur=\{blurPanel\}/g) ?? []).length, 3);
  assert.equal((source.match(/onBlur=\{blurEditor\}/g) ?? []).length, 3);
  assert.match(source, /<RirField[^>]*onFocus=\{focusPanel\}/);
  assert.match(source, /<RirField[^>]*onFocus=\{focusEditor\}/);
});
