/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const dependencies = process.env.BODYTRACK_DEPENDENCIES || root;
const dependency = name => require(require.resolve(name, { paths: [dependencies] }));
const ts = dependency('typescript');

function load(file, modules) {
  const code = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, require: name => {
    if (!(name in modules)) throw new Error(`Unexpected dependency: ${name}`);
    return modules[name];
  } });
  return loaded.exports;
}

function picker() {
  let ref;
  let layout;
  let focus;
  const routes = [];
  const api = load('src/workout/usePickedExercise.ts', {
    react: {
      useRef: value => { ref ??= { current: value }; return ref; },
      useCallback: fn => fn,
      useLayoutEffect: fn => { layout = fn; },
    },
    'expo-router': {
      useRouter: () => ({ push: route => routes.push(route) }),
      useFocusEffect: fn => { focus = fn; },
    },
  });
  return { api, routes, commit: () => layout(), focus: () => focus() };
}

test('an uncommitted render cannot replace the callback used by the picker', () => {
  const { api, commit, focus } = picker();
  const seen = [];
  api.usePickedExercise(() => seen.push('committed'));
  commit();
  api.usePickedExercise(() => seen.push('pending'));
  api.depositPickedExercise({ id: '1', name: 'Squat' });
  focus();
  assert.deepEqual(seen, ['committed']);
  commit();
  api.depositPickedExercise({ id: '2', name: 'Row' });
  focus();
  assert.deepEqual(seen, ['committed', 'pending']);
});

test('picker still delivers each deposited exercise only once', () => {
  const { api, commit, focus, routes } = picker();
  const seen = [];
  const { openPicker } = api.usePickedExercise(item => seen.push(item.id));
  commit(); openPicker();
  api.depositPickedExercise({ id: '1', name: 'Squat' });
  focus(); focus();
  assert.deepEqual(seen, ['1']);
  assert.deepEqual(routes, ['/workout/exercise-picker']);
});

test('web server rendering starts in light mode even when the device reports dark', () => {
  const React = dependency('react');
  const { renderToString } = dependency('react-dom/server');
  const { useColorScheme } = load('hooks/use-color-scheme.web.ts', {
    react: React, 'react-native': { useColorScheme: () => 'dark' },
  });
  function Theme() { return React.createElement('span', null, useColorScheme()); }
  assert.equal(renderToString(React.createElement(Theme)), '<span>light</span>');
});
