/* global __dirname */
// Drives the real screen files from node:test: a whole .tsx file is transpiled and run in a vm
// with its imports replaced by the stand-ins the test hands in, and React's hooks are replaced by
// a minimal renderer. It exercises state, effects and event handlers as written; it does not
// simulate native layout, gestures, the keyboard or the navigation stack (those are what the
// physical-device checklist in PROJE_1_CODEX_INCELEME.md is for).
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const ts = require(require.resolve('typescript', { paths: [process.env.BODYTRACK_DEPENDENCIES || root] }));

const read = (file) => readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
}

/** Runs TypeScript source in a vm. `modules` answers every import by its exact specifier. */
function loadSource(source, { globals = {}, modules = {} } = {}) {
  const loaded = { exports: {} };
  vm.runInNewContext(transpile(source), {
    module: loaded, exports: loaded.exports, Error, Promise, Math, Date, Number, String, Array, Object, Set, Map,
    JSON, parseInt, parseFloat, isNaN, Boolean,
    ...globals,
    require: (name) => {
      if (!(name in modules)) throw new Error(`Unexpected dependency: ${name}`);
      return modules[name];
    },
  });
  return loaded.exports;
}
const loadFile = (file, options) => loadSource(read(file), options);

/** Only the named top-level functions of a file (an `export` / `export default` is dropped). */
function extractFunctions(file, names) {
  const parsed = ts.createSourceFile('x.tsx', read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const code = parsed.statements
    .filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
    .map((node) => node.getText(parsed).replace(/^export\s+(default\s+)?/, ''))
    .join('\n');
  return `${code}\nexport { ${names.join(', ')} };`;
}

const createElement = (type, props, ...children) => ({ type, props: { ...props, children } });

/** `react-native` where every component is just its own name, and StyleSheet is a pass-through. */
function reactNative(overrides = {}) {
  const base = {
    StyleSheet: { create: (styles) => styles, hairlineWidth: 1, absoluteFill: {} },
    Platform: { OS: 'ios' },
    Alert: { alert() {} },
    ...overrides,
  };
  return new Proxy(base, { get: (target, key) => (key in target ? target[key] : String(key)) });
}

const sameDeps = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

/**
 * React's hooks, reduced: state, refs, memo, callbacks, effects (with dependency checks and
 * cleanups) and useSyncExternalStore (re-read on every render). A focus effect runs when the
 * test calls focus() and is cleaned up by blur(); it does not follow re-renders.
 */
function createHooks() {
  const slots = [];
  const effects = [];
  const focusEffects = [];
  let cursor = 0;
  let effectCursor = 0;
  let queue = [];

  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      const slot = slots[index];
      return [slot.value, (next) => { slot.value = typeof next === 'function' ? next(slot.value) : next; }];
    },
    useRef(initial) {
      const index = cursor++;
      slots[index] ??= { current: initial };
      return slots[index];
    },
    useMemo(factory, deps) {
      const index = cursor++;
      if (!slots[index] || !sameDeps(slots[index].deps, deps)) slots[index] = { deps, value: factory() };
      return slots[index].value;
    },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !sameDeps(slots[index].deps, deps)) slots[index] = { deps, value: callback };
      return slots[index].value;
    },
    useEffect(effect, deps) {
      const index = effectCursor++;
      const previous = effects[index];
      if (previous && deps && sameDeps(previous.deps, deps)) return;
      queue.push(() => {
        previous?.cleanup?.();
        effects[index] = { deps, cleanup: effect() };
      });
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      cursor++;
      return getSnapshot();
    },
    useFocusEffect(callback) {
      const index = effectCursor++;
      focusEffects[index] ??= { active: false, cleanup: undefined, callback };
      focusEffects[index].callback = callback;
    },
  };

  return {
    hooks,
    /** One render of `component`, then its effects (as a commit would run them). */
    render(component, props) {
      cursor = 0;
      effectCursor = 0;
      queue = [];
      const tree = component(props);
      const pending = queue;
      queue = [];
      pending.forEach((run) => run());
      return tree;
    },
    focus() {
      focusEffects.forEach((entry) => {
        if (entry.active) return;
        entry.cleanup = entry.callback();
        entry.active = true;
      });
    },
    blur() {
      focusEffects.forEach((entry) => {
        if (!entry.active) return;
        entry.active = false;
        entry.cleanup?.();
        entry.cleanup = undefined;
      });
    },
    unmount() {
      this.blur();
      effects.forEach((effect) => effect?.cleanup?.());
    },
  };
}

// ---- reading a rendered tree

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
/** Function components are called in place, like a render would, so only host nodes remain. */
function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== 'object') return node;
  if (typeof node.type === 'function') return expand(node.type({ ...node.props }));
  return { ...node, props: { ...node.props, children: expand(node.props?.children) } };
}
const byLabel = (tree, label) => nodes(tree).find((node) => node.props?.accessibilityLabel === label);
const allByLabel = (tree, label) => nodes(tree).filter((node) => node.props?.accessibilityLabel === label);
const textOf = (node) => nodes(node).filter((n) => n.type === 'Text').map((n) =>
  [n.props.children].flat(Infinity).filter((part) => typeof part === 'string' || typeof part === 'number').join(''));
const texts = (tree) => nodes(tree).filter((node) => node.type === 'Text').map((node) =>
  [node.props.children].flat(Infinity).filter((part) => typeof part === 'string' || typeof part === 'number').join(''));

/** Values built inside the vm have another realm's prototypes; compare them as plain data. */
const plain = (value) => JSON.parse(JSON.stringify(value));
/** Lets every pending promise callback run. */
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve)); };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

module.exports = {
  read, loadSource, loadFile, extractFunctions, createElement, reactNative, createHooks,
  nodes, expand, byLabel, allByLabel, texts, textOf, plain, settle, deferred,
};
