const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(require.resolve('typescript', { paths: [process.env.BODYTRACK_DEPENDENCIES || path.resolve(__dirname, '..')] }));

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// The coach connection and workout-review screens are light; program sending,
// received programs and offer review are a separate task and keep their theme.
const light = [
  'app/(app)/coaching/athletes.tsx',
  'app/(app)/coaching/coaches.tsx',
  'app/(app)/coaching/athlete/[linkId]/index.tsx',
  'app/(app)/coaching/athlete/[linkId]/workout/[workoutId].tsx',
  'src/coaching/ConnectionRow.tsx',
  'src/coaching/CoachFeedbackSection.tsx',
  'src/coaching/AthleteExerciseHistoryPanel.tsx',
];
const deferred = [
  'app/(app)/coaching/athlete/[linkId]/send-program.tsx',
  'app/(app)/coaching/programs-received.tsx',
  'app/(app)/coaching/program-offer/[offerId].tsx',
  'src/coaching/OfferProgramView.tsx',
];

test('coach screens: the scoped files use the light theme and none of the Roman one', () => {
  for (const file of light) {
    const source = read(file);
    assert.match(source, /lightTheme/, file);
    assert.doesNotMatch(source, /romanTheme|romanFont|useRomanFonts|roman\./, file);
  }
});

test('coach screens: the deferred program screens were left on their own theme', () => {
  for (const file of deferred) assert.match(read(file), /romanTheme/, file);
});

test('coach screens: the stack gives the four scoped routes the light header and nothing else', () => {
  const layout = read('app/(app)/_layout.tsx');
  const withLight = [...layout.matchAll(/name="([^"]+)"\s*options=\{\{[^}]*\.\.\.lightHeader/g)].map((m) => m[1]);
  assert.deepEqual(withLight.sort(), [
    'coaching/athlete/[linkId]/index',
    'coaching/athlete/[linkId]/workout/[workoutId]',
    'coaching/athletes',
    'coaching/coaches',
  ]);
  for (const name of ['send-program', 'programs-received', 'program-offer/[offerId]']) {
    assert.match(layout, new RegExp(`name="coaching/(?:athlete/\\[linkId\\]/)?${name.replace(/[[\]/]/g, '\\$&')}"\\s*options=\\{\\{[^}]*romanHeader`), name);
  }
});

test('coach screens: the sharing status is written out and programs are not tied to it', () => {
  const coaches = read('app/(app)/coaching/coaches.tsx');
  assert.match(coaches, /Sharing is on/);
  assert.match(coaches, /Sharing is off/);
  assert.match(coaches, /do not depend on this setting/);
  // Turning sharing on still asks first.
  assert.match(coaches, /Share your workouts with/);
});

test('coach screens: every light screen owns the status bar through the shared focused component', () => {
  for (const file of light.filter((f) => f.startsWith('app/'))) {
    assert.match(read(file), /FocusedDarkStatusBar/, file);
  }
});

// ── ConnectionRow: shared by My Athletes and My Coaches ────────────────────

function load(file, modules, globals = {}) {
  const code = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  const module_ = { exports: {} };
  vm.runInNewContext(code, {
    module: module_, exports: module_.exports, Date, Number, ...globals,
    require: (name) => {
      if (!(name in modules)) throw new Error(`unexpected import ${name}`);
      return modules[name];
    },
  });
  return module_.exports;
}
const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) };
const presentation = load('src/coaching/presentation.ts', {});
const { ConnectionRow } = load('src/coaching/ConnectionRow.tsx', {
  react,
  '@expo/vector-icons': { Ionicons: 'Ionicons' },
  'react-native': {
    ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', Text: 'Text', View: 'View',
    StyleSheet: { create: (v) => v },
  },
  '../lightTheme': { light: {} },
  './presentation': presentation,
}, { React: react });
const walk = (tree) => {
  if (tree === null || tree === undefined || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(walk);
  return [tree, ...walk(tree.props?.children)];
};
const person = { username: 'ada_l', first_name: 'Ada', last_name: 'Lovelace' };
const connection = { id: 'l1', person, connected_at: '2026-10-01T10:00:00Z', shares_workouts: true };
const draw = (props) => walk(ConnectionRow({ connection, ending: false, onEnd() {}, ...props }));
const labels = (nodes) => nodes.map((n) => n.props?.accessibilityLabel).filter(Boolean);

test('connection row: the roster row opens the athlete and the coach row does not', () => {
  assert.ok(labels(draw({ onOpen() {}, status: 'Workouts shared' })).some((l) => /^Ada Lovelace\. Workouts shared\. Open workouts$/.test(l)));
  assert.equal(labels(draw({})).some((l) => /Open workouts/.test(l)), false);
});

test('connection row: ending is always offered, named after the person, and blocked while it runs', () => {
  const idle = draw({}).find((n) => n.props?.accessibilityLabel === 'End connection with Ada Lovelace');
  assert.equal(idle.props.disabled, false);
  const busy = draw({ ending: true }).find((n) => n.props?.accessibilityLabel === 'End connection with Ada Lovelace');
  assert.equal(busy.props.disabled, true);
  assert.equal(busy.props.accessibilityState.busy, true);
});

test('connection row: the sharing status is text, shown whatever the colours are', () => {
  const nodes = draw({ status: 'Workouts not shared' });
  assert.ok(nodes.some((n) => n.type === 'Text' && [n.props.children].flat().join('') === 'Workouts not shared'));
});
