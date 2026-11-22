/* global __dirname */
// Barbell plate calculator: the arithmetic (src/workout/plateMath.ts), its
// per-unit storage, and how the real SetForm and PlateCalculator functions fit
// together. Components are driven with host-element adapters — event and state
// behaviour only, not native layout, the keyboard or the Modal window (see the
// physical-device checklist in PROJE_1_CODEX_INCELEME.md).
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const ts = require(require.resolve('typescript', { paths: [process.env.BODYTRACK_DEPENDENCIES || root] }));

const read = file => readFileSync(path.join(root, file), 'utf8');
function load(source, globals = {}, modules = {}) {
  const loaded = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
  } }).outputText;
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, Error, ...globals,
    require: name => { if (!(name in modules)) throw new Error(`Unexpected dependency: ${name}`); return modules[name]; },
  });
  return loaded.exports;
}
// Values built inside the vm have another realm's prototypes; compare them as plain data.
const plain = value => JSON.parse(JSON.stringify(value));

const logic = load(read('src/workout/plateMath.ts'));
const units = load(read('src/units/weight.ts'));
const {
  calculatePlates, parseDecimalInput, initialPlateTotal, formatPlateNumber, describePerSide,
  sanitizePlatePreference, DEFAULT_PLATE_PREFERENCE, PLATE_OPTIONS, MAX_TOTAL, MAX_BAR,
} = logic;

const KG_ALL = [20, 10, 2.5, 1.25];
const calc = (total, bar, plates) => plain(calculatePlates(total, bar, plates));
const sides = result => result.perSide.map(({ size, count }) => `${count}x${size}`);

// ------------------------------------------------------------- input parsing

test('decimal comma and decimal point both parse; blank and junk do not', () => {
  assert.equal(parseDecimalInput('87.5'), 87.5);
  assert.equal(parseDecimalInput('87,5'), 87.5);
  assert.equal(parseDecimalInput(' 100 '), 100);
  assert.equal(parseDecimalInput('.5'), 0.5);
  assert.equal(parseDecimalInput('5.'), 5);
  for (const bad of ['', '   ', '.', ',', 'abc', '1e3', '0x10', '-5', '+5', '1,2,3', '1.2.3', '87.5kg', 'Infinity', '12.3456']) {
    assert.equal(parseDecimalInput(bad), null, JSON.stringify(bad));
  }
});

// --------------------------------------------------------------- the maths

test('87.5 kg on a 20 kg bar with 20, 10, 2.5 and 1.25 kg plates is one of each per side', () => {
  const result = calc('87.5', '20', KG_ALL);
  assert.equal(result.status, 'exact');
  assert.deepEqual(sides(result), ['1x20', '1x10', '1x2.5', '1x1.25']);
  assert.equal(result.total, 87.5);
  assert.equal(result.bar, 20);
});

test('a decimal comma gives the same answer as a decimal point', () => {
  assert.deepEqual(calc('87,5', '20', KG_ALL), calc('87.5', '20', KG_ALL));
  assert.deepEqual(calc('87.5', '20,0', KG_ALL), calc('87.5', '20', KG_ALL));
});

test('an exact load the largest-plate-first approach misses is found', () => {
  // 100 on a 20 bar is 40 per side. Largest first takes a 25 and is stuck with 15.
  const result = calc('100', '20', [25, 20]);
  assert.equal(result.status, 'exact');
  assert.deepEqual(sides(result), ['2x20']);
  assert.equal(result.total, 100);
});

test('among exact answers the one with the fewest plates is shown, heavier plates first', () => {
  // 30 per side is 20 + 10, not 10 + 10 + 10 or 20 + 5 + 5.
  assert.deepEqual(sides(calc('80', '20', [20, 10, 5])), ['1x20', '1x10']);
  // 45 per side with 25, 20, 10, 5 is 25 + 20.
  assert.deepEqual(sides(calc('110', '20', [25, 20, 10, 5])), ['1x25', '1x20']);
  // Same plate count either way (20+5 or 15+10 = 25): the heavier first plate wins, deterministically.
  assert.deepEqual(sides(calc('70', '20', [20, 15, 10, 5])), ['1x20', '1x5']);
});

test('repeated plates are counted per side', () => {
  const result = calc('140', '20', [25, 20, 10]);
  assert.equal(result.status, 'exact');
  assert.deepEqual(sides(result), ['2x25', '1x10']);
});

test('pounds: its own bar and sizes, nothing converted', () => {
  const lb = DEFAULT_PLATE_PREFERENCE.lb;
  assert.equal(lb.bar, 45);
  assert.deepEqual(sides(calc('135', '45', lb.plates)), ['1x45']);
  // 100 lb on a 45 lb bar: 27.5 per side = 25 + 2.5.
  const hundred = calc('100', '45', lb.plates);
  assert.equal(hundred.status, 'exact');
  assert.deepEqual(sides(hundred), ['1x25', '1x2.5']);
  assert.equal(hundred.total, 100);
  assert.deepEqual(sides(calc('225', '45', lb.plates)), ['2x45']);
});

test('fractional plates are exact and printed without float noise', () => {
  const result = calc('22.5', '20', [1.25]);
  assert.equal(result.status, 'exact');
  assert.deepEqual(sides(result), ['1x1.25']);
  assert.deepEqual(sides(calc('20.5', '20', [0.25])), ['1x0.25']);
  // 0.1-sized arithmetic would drift in floating point; thousandths do not.
  const odd = calc('20.3', '20', [0.1]);
  assert.equal(odd.status, 'closest');
  assert.equal(odd.total, 20.2);
  assert.equal(odd.shortfall, 0.1);
  assert.equal(formatPlateNumber(1.25), '1.25');
  assert.equal(formatPlateNumber(0.1 + 0.2), '0.3');
  assert.equal(formatPlateNumber(20), '20');
  assert.equal(describePerSide([{ size: 20, count: 1 }, { size: 1.25, count: 2 }], 'kg'), '1 × 20 kg, 2 × 1.25 kg');
});

test('an unattainable total shows the closest one below it and the shortfall', () => {
  const result = calc('88', '20', KG_ALL);
  assert.equal(result.status, 'closest');
  assert.equal(result.requested, 88);
  assert.equal(result.total, 87.5);
  assert.equal(result.shortfall, 0.5);
  assert.deepEqual(sides(result), ['1x20', '1x10', '1x2.5', '1x1.25']);
  // Never rounds up: 89.9 is still 87.5, not 90.
  assert.equal(calc('89.9', '20', KG_ALL).total, 90 - 2.5);
});

test('closest also works when only some sizes can make the load', () => {
  // 40 per side with 25 and 15: 25 + 15 is exact. With 25 and 30 nothing makes 40;
  // 30 is the heaviest reachable, so 20 + 2 x 30 = 80 and 20 is short.
  assert.equal(calc('100', '20', [25, 15]).status, 'exact');
  const result = calc('100', '20', [25, 30]);
  assert.equal(result.status, 'closest');
  assert.equal(result.total, 80);
  assert.equal(result.shortfall, 20);
});

test('when even the smallest plate is too heavy, the bar alone is the closest', () => {
  const result = calc('21', '20', KG_ALL);
  assert.equal(result.status, 'closest');
  assert.equal(result.total, 20);
  assert.equal(result.shortfall, 1);
  assert.deepEqual(result.perSide, []);
});

// ---------------------------------------------------- bars, blanks, bad input

test('a total below the bar is reported, not calculated', () => {
  const result = calc('15', '20', KG_ALL);
  assert.deepEqual(result, { status: 'below-bar', bar: 20, total: 15 });
});

test('an empty bar: exactly the bar weight needs no plates, and a 0 bar is allowed', () => {
  assert.deepEqual(calc('20', '20', KG_ALL), { status: 'bar-only', bar: 20, total: 20 });
  assert.deepEqual(calc('0', '0', KG_ALL), { status: 'bar-only', bar: 0, total: 0 });
  // No bar at all: the total is plates only, split across the two sides.
  const noBar = calc('50', '0', KG_ALL);
  assert.equal(noBar.status, 'exact');
  // 25 per side: 20 + 2.5 + 2.5 (three plates) beats 10 + 10 + 2.5 + 2.5.
  assert.deepEqual(sides(noBar), ['1x20', '2x2.5']);
  assert.equal(noBar.total, 50);
});

test('a blank bar weight is an input error, separate from a bar of zero', () => {
  assert.deepEqual(calc('100', '', KG_ALL), { status: 'invalid', field: 'bar', reason: 'blank' });
  assert.deepEqual(calc('100', '   ', KG_ALL), { status: 'invalid', field: 'bar', reason: 'blank' });
  assert.deepEqual(calc('100', 'x', KG_ALL), { status: 'invalid', field: 'bar', reason: 'invalid' });
});

test('blank, invalid, negative and oversized totals are reported by what is wrong', () => {
  assert.deepEqual(calc('', '20', KG_ALL), { status: 'invalid', field: 'total', reason: 'blank' });
  assert.deepEqual(calc('  ', '20', KG_ALL), { status: 'invalid', field: 'total', reason: 'blank' });
  for (const bad of ['abc', '-80', '1e3', '12.3456', '8 0']) {
    assert.deepEqual(calc(bad, '20', KG_ALL), { status: 'invalid', field: 'total', reason: 'invalid' }, bad);
  }
  assert.deepEqual(calc(String(MAX_TOTAL + 1), '20', KG_ALL), { status: 'invalid', field: 'total', reason: 'too-large' });
  assert.deepEqual(calc('100', String(MAX_BAR + 1), KG_ALL), { status: 'invalid', field: 'bar', reason: 'too-large' });
  // The largest accepted total still answers, quickly.
  const started = Date.now();
  assert.equal(calc(String(MAX_TOTAL), '20', KG_ALL.concat([0.25])).status, 'exact');
  assert.ok(Date.now() - started < 500);
});

test('selecting no plates leaves only the bar, with a reason', () => {
  assert.deepEqual(calc('100', '20', []), { status: 'no-plates', bar: 20, total: 100 });
  // But a total at or below the bar never needs a plate.
  assert.equal(calc('20', '20', []).status, 'bar-only');
  assert.equal(calc('10', '20', []).status, 'below-bar');
});

test('junk in the plate list (zero, negative, repeats) cannot break the maths', () => {
  const result = calc('87.5', '20', [20, 20, 10, 2.5, 1.25, 0, -5]);
  assert.equal(result.status, 'exact');
  assert.deepEqual(sides(result), ['1x20', '1x10', '1x2.5', '1x1.25']);
});

// ------------------------------------------------- defaults and preferences

test('kg and lb have separate defaults, and the lists are what the screen offers', () => {
  assert.deepEqual(plain(DEFAULT_PLATE_PREFERENCE.kg), { bar: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] });
  assert.deepEqual(plain(DEFAULT_PLATE_PREFERENCE.lb), { bar: 45, plates: [45, 35, 25, 10, 5, 2.5] });
  for (const unit of ['kg', 'lb']) {
    for (const size of DEFAULT_PLATE_PREFERENCE[unit].plates) assert.ok(PLATE_OPTIONS[unit].includes(size));
  }
});

test('a stored preference is used only when it is usable', () => {
  const ok = { bar: 15, plates: [20, 5] };
  assert.deepEqual(plain(sanitizePlatePreference(ok, 'kg')), { bar: 15, plates: [20, 5] });
  // An explicit empty choice is kept; it is not "missing".
  assert.deepEqual(plain(sanitizePlatePreference({ bar: 20, plates: [] }, 'kg')), { bar: 20, plates: [] });
  // Sizes this unit does not offer are dropped; order follows the options.
  assert.deepEqual(plain(sanitizePlatePreference({ bar: 20, plates: [5, 20, 7, 'x', null] }, 'kg')), { bar: 20, plates: [20, 5] });
  for (const bad of [null, undefined, 'x', 5, [], { bar: 'x' }, { bar: NaN, plates: 'x' }, { bar: -1 }, { bar: MAX_BAR + 1 }]) {
    const got = plain(sanitizePlatePreference(bad, 'lb'));
    assert.equal(got.bar, 45, JSON.stringify(bad));
  }
  assert.deepEqual(plain(sanitizePlatePreference({ bar: 'x', plates: 'x' }, 'lb')), plain(DEFAULT_PLATE_PREFERENCE.lb));
});

function makeStore(initial = {}, { failGet = false, failSet = false } = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async getItemAsync(key) { if (failGet) throw new Error('keychain'); return data.has(key) ? data.get(key) : null; },
    async setItemAsync(key, value) { if (failSet) throw new Error('keychain'); data.set(key, value); },
  };
}
const preferenceModule = store => load(read('src/workout/plateCalculatorPreference.ts'), { JSON }, {
  'expo-secure-store': store, './plateMath': logic,
});

test('preferences are stored per unit under keys SecureStore accepts and round-trip', async () => {
  const store = makeStore();
  const prefs = preferenceModule(store);
  await prefs.setPlatePreference('kg', { bar: 15, plates: [20, 10] });
  await prefs.setPlatePreference('lb', { bar: 35, plates: [45, 10] });
  assert.equal(store.data.size, 2);
  for (const key of store.data.keys()) assert.match(key, /^[A-Za-z0-9._-]+$/);
  assert.deepEqual(plain(await prefs.getPlatePreference('kg')), { bar: 15, plates: [20, 10] });
  assert.deepEqual(plain(await prefs.getPlatePreference('lb')), { bar: 35, plates: [45, 10] });
});

test('nothing stored, corrupted storage and a failing Keychain all give that unit its defaults', async () => {
  assert.deepEqual(plain(await preferenceModule(makeStore()).getPlatePreference('kg')), plain(DEFAULT_PLATE_PREFERENCE.kg));
  const corrupted = makeStore({ 'bodytrack.plate_calculator.lb': '{not json' });
  assert.deepEqual(plain(await preferenceModule(corrupted).getPlatePreference('lb')), plain(DEFAULT_PLATE_PREFERENCE.lb));
  const failing = makeStore({}, { failGet: true });
  assert.deepEqual(plain(await preferenceModule(failing).getPlatePreference('kg')), plain(DEFAULT_PLATE_PREFERENCE.kg));
});

test('the kg setup never leaks into lb or the other way round', async () => {
  const store = makeStore();
  const prefs = preferenceModule(store);
  await prefs.setPlatePreference('kg', { bar: 15, plates: [20] });
  assert.deepEqual(plain(await prefs.getPlatePreference('lb')), plain(DEFAULT_PLATE_PREFERENCE.lb));
});

// --------------------------------------------- the real components, driven

function harness() {
  const state = [];
  const effects = [];
  let cursor = 0;
  return {
    reset() { cursor = 0; },
    effects,
    globals: {
      useState(initial) {
        const index = cursor++;
        if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
        return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
      },
      useRef(initial) {
        const index = cursor++;
        state[index] ??= { current: initial };
        return state[index];
      },
      // Effects run once, at the first render of their slot (the calculator's depend on a constant unit).
      useEffect(fn) {
        const index = cursor++;
        if (!(index in state)) { state[index] = true; effects.push(fn()); }
      },
      React: { createElement: (type, properties, ...children) => ({ type, props: { ...properties, children } }) },
      View: 'View', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable', ScrollView: 'ScrollView',
      Modal: 'Modal', KeyboardAvoidingView: 'KeyboardAvoidingView', SafeAreaProvider: 'SafeAreaProvider',
      SafeAreaView: 'SafeAreaView', ActivityIndicator: 'ActivityIndicator', Ionicons: 'Ionicons',
      RestCountdownChip: 'RestCountdownChip', Platform: { OS: 'ios' }, Alert: { alert() {} }, light: {},
      StyleSheet: { absoluteFill: {} }, MIN_TOUCH: 44,
      styles: new Proxy({}, { get: (_, key) => key }),
    },
  };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const byLabel = (tree, label) => nodes(tree).find(node => node.props.accessibilityLabel === label);
const texts = tree => nodes(tree).filter(node => node.type === 'Text').map(node =>
  node.props.children.flat(Infinity).filter(part => typeof part === 'string' || typeof part === 'number').join(''));
function extract(file, names) {
  const source = read(file);
  const parsed = ts.createSourceFile('x.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const code = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
    .map(node => node.getText(parsed).replace(/^export\s+/, '')).join('\n');
  return `${code}\nexport { ${names.join(', ')} };`;
}

function setForm(props) {
  const h = harness();
  const keyboard = { dismissed: 0, dismiss() { this.dismissed++; } };
  const api = load(extract('app/(app)/workout/[id].tsx', ['RirField', 'SetForm']), {
    ...h.globals, ...units, ...load(read('src/workout/rir.ts')), ...logic,
    Keyboard: keyboard, PlateCalculator: 'PlateCalculator',
  });
  return { keyboard, render: () => { h.reset(); return api.SetForm(props); } };
}

function calculator(props, { saved = DEFAULT_PLATE_PREFERENCE[props.unit], store = restStore() } = {}) {
  const h = harness();
  const writes = [];
  let resolveLoad;
  const loaded = new Promise(resolve => { resolveLoad = resolve; });
  const api = load(extract('src/workout/PlateCalculator.tsx',
    ['resultMessage', 'PerSide', 'PlateCalculator']), {
    ...h.globals, ...logic,
    restTimerStore: store,
    getPlatePreference: () => loaded,
    setPlatePreference: async (unit, value) => { writes.push([unit, plain(value)]); },
  });
  let rendered = false;
  // A shallow render leaves child components (PerSide) unexpanded; expand them so their output can be read.
  const expand = node => {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: expand(node.props?.children) } };
  };
  const render = () => { rendered = true; h.reset(); return expand(api.PlateCalculator(props)); };
  return {
    store, writes, h,
    // The component asks for the saved choices when it first renders, so it must have rendered by now.
    finishLoading: async () => { if (!rendered) render(); resolveLoad(plain(saved)); await loaded; await Promise.resolve(); },
    render,
  };
}
function restStore() {
  const calls = { covered: 0, released: 0, other: [] };
  const trap = name => () => { calls.other.push(name); };
  return {
    calls,
    coverInline() { calls.covered++; return () => { calls.released++; }; },
    start: trap('start'), stop: trap('stop'), clearForWorkout: trap('clearForWorkout'), reset: trap('reset'),
  };
}

const weightProps = (overrides = {}) => ({
  unit: 'kg', busy: false, blocked: false, lastSet: undefined,
  draft: { weight: '87,5', reps: '6', rir: '2', isWarmup: true },
  onSubmit: async () => { throw new Error('a set must not be saved by the calculator'); },
  onDraftChange: () => {},
  ...overrides,
});

test('the set form offers an explicit barbell "Plate calculator" button, enabled while saving too', () => {
  const form = setForm(weightProps({ busy: true }));
  const tree = form.render();
  const button = byLabel(tree, 'Plate calculator');
  assert.ok(button);
  assert.equal(button.props.accessibilityRole, 'button');
  assert.match(button.props.accessibilityHint, /barbell only/i);
  assert.ok(texts(tree).includes('Plate calculator'));
});

test('opening the calculator hands it the draft weight once and dismisses the keyboard', () => {
  const form = setForm(weightProps());
  const open = byLabel(form.render(), 'Plate calculator');
  open.props.onPress();
  assert.equal(form.keyboard.dismissed, 1);
  const shown = nodes(form.render()).find(node => node.type === 'PlateCalculator');
  assert.ok(shown);
  assert.equal(shown.props.initialTotal, '87,5');
  assert.equal(shown.props.unit, 'kg');
  // Only a way out is handed over: no draft setter, no save.
  assert.deepEqual(Object.keys(shown.props).filter(key => key !== 'children').sort(), ['initialTotal', 'onClose', 'unit']);
});

test('no usable draft weight opens an empty calculator; the last set is not guessed', () => {
  const lastSet = { weight_kg: '100', reps: 5 };
  const form = setForm(weightProps({ draft: { weight: '', reps: '', rir: '', isWarmup: false }, lastSet }));
  byLabel(form.render(), 'Plate calculator').props.onPress();
  assert.equal(nodes(form.render()).find(node => node.type === 'PlateCalculator').props.initialTotal, '');
  assert.equal(initialPlateTotal(undefined), '');
  assert.equal(initialPlateTotal('abc'), '');
  assert.equal(initialPlateTotal(' 82.5 '), '82.5');
});

test('using and closing the calculator leaves the set draft, warm-up and saving untouched', async () => {
  const changes = [];
  const submits = [];
  const form = setForm(weightProps({
    unit: 'kg',
    onDraftChange: draft => changes.push(plain(draft)),
    onSubmit: async (...args) => { submits.push(args); },
  }));
  byLabel(form.render(), 'Plate calculator').props.onPress();
  const calcProps = nodes(form.render()).find(node => node.type === 'PlateCalculator').props;

  const shown = calculator(calcProps);
  await shown.finishLoading();
  let tree = shown.render();
  // Edit everything the calculator lets you edit.
  byLabel(tree, 'Total weight in kg, bar included').props.onChangeText('140');
  byLabel(shown.render(), 'Bar weight in kg').props.onChangeText('15');
  byLabel(shown.render(), '25 kg plate').props.onPress();
  tree = shown.render();
  assert.ok(texts(tree).some(text => text.includes('Per side') || text.includes('×')));
  calcProps.onClose();

  // Back on the form: closed, and every field is as it was.
  tree = form.render();
  assert.equal(nodes(tree).some(node => node.type === 'PlateCalculator'), false);
  assert.equal(byLabel(tree, 'Weight in kg').props.value, '87,5');
  assert.equal(byLabel(tree, 'Reps').props.value, '6');
  assert.equal(nodes(tree).find(node => node.type?.name === 'RirField').props.value, '2');
  assert.equal(byLabel(tree, 'Warm-up set').props.accessibilityState.checked, true);
  assert.deepEqual(changes, [], 'the calculator must not report a draft change');
  assert.deepEqual(submits, [], 'the calculator must not save a set');
  assert.equal(byLabel(tree, 'Log set').props.disabled, false);
});

test('reopening starts from the draft again, not from what was typed in the calculator', () => {
  const form = setForm(weightProps());
  byLabel(form.render(), 'Plate calculator').props.onPress();
  nodes(form.render()).find(node => node.type === 'PlateCalculator').props.onClose();
  byLabel(form.render(), 'Plate calculator').props.onPress();
  assert.equal(nodes(form.render()).find(node => node.type === 'PlateCalculator').props.initialTotal, '87,5');
});

test('the calculator shows the answer for what is typed, in the app unit, and the total stays editable', async () => {
  // Only the four sizes of the spec example are selected; with every default plate on there are
  // several equally short answers for 33.75 per side (25 + 5 + 2.5 + 1.25 among them).
  const shown = calculator({ unit: 'kg', initialTotal: '87,5', onClose() {} }, { saved: { bar: 20, plates: KG_ALL } });
  await shown.finishLoading();
  let tree = shown.render();
  assert.equal(byLabel(tree, 'Total weight in kg, bar included').props.value, '87,5');
  assert.equal(byLabel(tree, 'Bar weight in kg').props.value, '20');
  const perSide = byLabel(tree, 'Per side: 1 × 20 kg, 1 × 10 kg, 1 × 2.5 kg, 1 × 1.25 kg');
  assert.ok(perSide, 'the plates are one labelled group for a screen reader');

  byLabel(tree, 'Total weight in kg, bar included').props.onChangeText('88');
  tree = shown.render();
  assert.ok(texts(tree).some(text => /closest at or below it is 87\.5 kg, 0\.5 kg short/.test(text)));
  const alert = nodes(tree).find(node => node.props.accessibilityRole === 'alert');
  assert.ok(alert, 'an unreachable total is announced');

  byLabel(tree, 'Total weight in kg, bar included').props.onChangeText('');
  assert.ok(texts(shown.render()).some(text => /Enter the total weight/.test(text)));
  assert.equal(nodes(shown.render()).some(node => node.props.accessibilityRole === 'alert'), false, 'blank is a prompt, not an error');
});

test('pounds open with the pound bar and pound plates', async () => {
  const shown = calculator({ unit: 'lb', initialTotal: '135', onClose() {} });
  await shown.finishLoading();
  const tree = shown.render();
  assert.equal(byLabel(tree, 'Bar weight in lb').props.value, '45');
  assert.ok(byLabel(tree, 'Per side: 1 × 45 lb'));
  assert.ok(byLabel(tree, '45 lb plate'));
  assert.equal(byLabel(tree, '45 lb plate').props.accessibilityState.checked, true);
  assert.equal(byLabel(tree, '100 lb plate').props.accessibilityState.checked, false);
  assert.equal(byLabel(tree, '25 kg plate'), undefined);
});

test('plate and bar choices are remembered for that unit, once they are valid', async () => {
  const shown = calculator({ unit: 'kg', initialTotal: '100', onClose() {} });
  await shown.finishLoading();
  byLabel(shown.render(), '25 kg plate').props.onPress();
  assert.deepEqual(shown.writes.at(-1), ['kg', { bar: 20, plates: [20, 15, 10, 5, 2.5, 1.25] }]);
  assert.equal(byLabel(shown.render(), '25 kg plate').props.accessibilityState.checked, false);
  byLabel(shown.render(), 'Bar weight in kg').props.onChangeText('15');
  assert.deepEqual(shown.writes.at(-1), ['kg', { bar: 15, plates: [20, 15, 10, 5, 2.5, 1.25] }]);
  const count = shown.writes.length;
  byLabel(shown.render(), 'Bar weight in kg').props.onChangeText('');
  byLabel(shown.render(), 'Bar weight in kg').props.onChangeText('abc');
  assert.equal(shown.writes.length, count, 'an unusable bar is never stored');
});

test('saved choices that arrive after the user already changed something do not overwrite it', async () => {
  const shown = calculator({ unit: 'kg', initialTotal: '100', onClose() {} }, { saved: { bar: 15, plates: [20] } });
  shown.render();
  byLabel(shown.render(), 'Bar weight in kg').props.onChangeText('25');
  await shown.finishLoading();
  assert.equal(byLabel(shown.render(), 'Bar weight in kg').props.value, '25');
  // Untouched, the saved setup is applied.
  const fresh = calculator({ unit: 'kg', initialTotal: '100', onClose() {} }, { saved: { bar: 15, plates: [20] } });
  fresh.render();
  await fresh.finishLoading();
  const tree = fresh.render();
  assert.equal(byLabel(tree, 'Bar weight in kg').props.value, '15');
  assert.equal(byLabel(tree, '10 kg plate').props.accessibilityState.checked, false);
});

test('the calculator only reads the rest timer: it covers the workout countdown while open and never starts, stops or clears it', async () => {
  const store = restStore();
  let closed = 0;
  const shown = calculator({ unit: 'kg', initialTotal: '100', onClose() { closed++; } }, { store });
  const tree = shown.render();
  await shown.finishLoading();
  assert.equal(store.calls.covered, 1);
  assert.ok(nodes(tree).some(node => node.type === 'RestCountdownChip'), 'the countdown is shown in its header');
  byLabel(shown.render(), 'Close plate calculator').props.onPress();
  assert.equal(closed, 1);
  assert.deepEqual(store.calls.other, []);
  // Closing unmounts it; the cleanup returned by the cover releases it.
  shown.h.effects.forEach(cleanup => typeof cleanup === 'function' && cleanup());
  assert.equal(store.calls.released, 1);
  assert.deepEqual(store.calls.other, []);
});

test('with the real rest timer store: opening and closing the calculator leaves a running countdown exactly as it was', () => {
  const storeModule = load(read('src/workout/restTimerStore.ts'), { Math, Number, Object, Array, Set, Map });
  const clock = { t: 1_000_000 };
  const store = storeModule.createRestTimerStore(() => clock.t);
  assert.equal(store.start({ userId: 'user', workoutId: 'workout' }, 120), true);
  const before = store.timerFor('user');

  const shown = calculator({ unit: 'kg', initialTotal: '100', onClose() {} }, { store });
  shown.render();
  assert.equal(store.getSnapshot().covers, 1);
  clock.t += 30_000;
  assert.equal(store.timerFor('user'), before, 'the timer object is untouched');
  assert.equal(storeModule.remainingSeconds(store.timerFor('user'), clock.t), 90);
  shown.h.effects.forEach(cleanup => typeof cleanup === 'function' && cleanup());
  assert.equal(store.getSnapshot().covers, 0);
  assert.equal(store.timerFor('user'), before);
  assert.equal(storeModule.remainingSeconds(store.timerFor('user'), clock.t), 90);
});

test('the calculator source cannot reach a draft, a save, the API or the rest timer controls', () => {
  const source = read('src/workout/PlateCalculator.tsx');
  assert.doesNotMatch(source, /setDraftStore|onDraftChange|onSubmit|workoutsApi|api\/workouts|setSaveRequest|toggleWarmup|isWarmup/);
  assert.doesNotMatch(source, /restTimerStore\.(start|stop|clearForWorkout|reset|suppressPill)/);
  assert.match(source, /restTimerStore\.coverInline\(\)/);
  assert.doesNotMatch(read('src/workout/plateMath.ts') + read('src/workout/plateCalculatorPreference.ts'),
    /fetch\(|api\/|XMLHttpRequest/);
});

test('the shared weight formatter and its tests are untouched by this feature', () => {
  // Fractional plates use their own formatter; formatWeight still rounds to one decimal.
  assert.equal(units.formatWeight(1.25, 'kg'), '1.3 kg');
  assert.equal(formatPlateNumber(1.25), '1.25');
});

test('the calculator and its storage are wired into the workout screen once', () => {
  const screen = read('app/(app)/workout/[id].tsx');
  assert.equal(screen.match(/<PlateCalculator/g).length, 1);
  assert.match(screen, /initialPlateTotal\(weight\)/);
  assert.match(screen, /onClose=\{\(\) => setCalculatorTotal\(null\)\}/);
});
