/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const dependencies = process.env.BODYTRACK_DEPENDENCIES || root;
const ts = require(require.resolve('typescript', { paths: [dependencies] }));

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

test('blank RIR is unknown while zero and ten are explicit valid values', () => {
  for (const value of ['', '  ']) assert.equal(rir.parseRirInput(value), null);
  for (let value = 0; value <= 10; value++) assert.equal(rir.parseRirInput(` ${value} `), value);
  assert.equal(rir.formatRecordedRir(null), '');
  assert.equal(rir.formatRecordedRir(0), ' · RIR 0');
});

test('invalid RIR cannot silently become unknown or be rounded into a valid value', () => {
  for (const value of ['-1', '11', '1.5', '1,5', 'abc', '2reps', '1e1', 'Infinity']) {
    assert.throws(() => rir.parseRirInput(value), /whole RIR value/);
  }
});

// Exercise the actual screen functions with minimal state and host-element adapters.
// This tests event/state behavior, not native layout or the phone keyboard.
function screen(name, props) {
  const source = read('app/(app)/workout/[id].tsx');
  const parsed = ts.createSourceFile('screen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ['RirField', 'SetForm', 'SetRow', 'ReadOnlySetRow'];
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
    Alert: { alert() {} }, colors: {},
    styles: new Proxy({}, { get: (_, key) => key }),
  });
  return () => { cursor = 0; return api[name](props); };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const field = tree => nodes(tree).find(node => node.type?.name === 'RirField');
const add = tree => nodes(tree).find(node => node.props.style === 'addSet');
const confirm = tree => nodes(tree).find(node => node.type === 'Pressable' &&
  nodes(node).some(child => child.props.name === 'checkmark'));
const settle = () => new Promise(resolve => setImmediate(resolve));
const lastSet = { id: 1, weight_kg: '20', reps: 8, rir: 3, is_warmup: false, set_number: 1 };

test('new set does not copy previous RIR; explicit zero is sent and cleared after success', async () => {
  const calls = [];
  const render = screen('SetForm', { unit: 'kg', busy: false, lastSet,
    onSubmit: async (...args) => { calls.push(args); } });
  assert.equal(field(render()).props.value, '');
  add(render()).props.onPress();
  await settle();
  assert.equal(calls[0][3], null);
  field(render()).props.onChangeText('0');
  add(render()).props.onPress();
  await settle();
  assert.deepEqual(calls[1], [20, 8, false, 0]);
  assert.equal(field(render()).props.value, '');
});

test('failed set save preserves the draft and an in-flight save cannot be submitted twice', async () => {
  let reject;
  let count = 0;
  const render = screen('SetForm', { unit: 'kg', busy: false, lastSet,
    onSubmit: () => { count++; return new Promise((_, fail) => { reject = fail; }); } });
  field(render()).props.onChangeText('2');
  const button = add(render());
  button.props.onPress();
  button.props.onPress();
  assert.equal(count, 1);
  assert.equal(field(render()).props.disabled, true);
  reject(new Error('Network unavailable'));
  await settle();
  assert.equal(field(render()).props.value, '2');
  assert.equal(field(render()).props.disabled, false);
  assert.ok(JSON.stringify(render()).includes('Network unavailable'));
});

test('invalid RIR shows an error without submitting the set', async () => {
  let count = 0;
  const render = screen('SetForm', { unit: 'kg', busy: false, lastSet,
    onSubmit: async () => { count++; } });
  field(render()).props.onChangeText('11');
  add(render()).props.onPress();
  await settle();
  assert.equal(count, 0);
  assert.equal(field(render()).props.value, '11');
  assert.ok(JSON.stringify(render()).includes('whole RIR value'));
});

test('editing can clear RIR and a failed update keeps the editor and draft', async () => {
  const calls = [];
  let fail = true;
  const render = screen('SetRow', { set: { ...lastSet, rir: 0 }, unit: 'kg', onDelete() {},
    onSave: async (...args) => { calls.push(args); if (fail) throw new Error('Offline'); } });
  render().props.onPress();
  assert.equal(field(render()).props.value, '0');
  field(render()).props.onChangeText('');
  confirm(render()).props.onPress();
  await settle();
  assert.equal(calls[0][3], null);
  assert.equal(field(render()).props.value, '');
  fail = false;
  confirm(render()).props.onPress();
  await settle();
  assert.equal(field(render()), undefined);
});

test('finished session rows display recorded RIR zero but no invented value for unknown', () => {
  for (const value of [null, 0, 4]) {
    const render = screen('ReadOnlySetRow', { set: { ...lastSet, rir: value }, unit: 'kg' });
    assert.equal(JSON.stringify(render()).includes(' · RIR'), value !== null);
  }
});

test('API preserves explicit RIR zero and null in create and update requests', async () => {
  const calls = [];
  const api = load(read('src/api/workouts.ts'), {}, { './client': {
    apiRequest: async (...args) => { calls.push(args); return {}; },
  } });
  await api.addSet('workout', { exercise_id: 'bench', weight_kg: 20, reps: 8, rir: 0 });
  await api.updateSet('workout', 1, { rir: null });
  assert.equal(calls[0][1].body.rir, 0);
  assert.equal(calls[1][1].body.rir, null);
  assert.equal(calls[1][1].method, 'PATCH');
});

test('unresolved set locks the form without showing a perpetual sending indicator', async () => {
  let calls = 0;
  const render = screen('SetForm', { unit: 'kg', busy: false, blocked: true, lastSet,
    onSubmit: async () => { calls++; } });
  assert.equal(add(render()).props.disabled, true);
  assert.equal(field(render()).props.disabled, true);
  add(render()).props.onPress();
  await settle();
  assert.equal(calls, 0);
  assert.equal(nodes(render()).some(node => node.type === 'ActivityIndicator'), false);
});

test('editing only RIR in lb preserves the exact stored kg despite rounded display', async () => {
  const calls = [];
  const render = screen('SetRow', { set: { ...lastSet, weight_kg: '20.04' }, unit: 'lb', onDelete() {},
    onSave: async (...args) => { calls.push(args); } });
  render().props.onPress();
  field(render()).props.onChangeText('0');
  confirm(render()).props.onPress(); await settle();
  assert.equal(calls[0][1], 20.04);
  assert.equal(calls[0][3], 0);
});

test('set update converts an edited lb weight to API precision and preserves omitted weight', async () => {
  const calls = [];
  const api = load(read('src/api/workouts.ts'), {}, { './client': {
    apiRequest: async (...args) => { calls.push(args); return {}; },
  } });
  const changes = { weight_kg: units.parseWeightInput('45', 'lb'), reps: 8, rir: null };
  await api.updateSet('workout', 1, changes);
  assert.equal(calls[0][1].body.weight_kg, 20.41);
  assert.equal(changes.weight_kg, 20.41165665);
  await api.updateSet('workout', 1, { rir: 0 });
  assert.equal('weight_kg' in calls[1][1].body, false);
});
