/* global __dirname */
// Loads a TypeScript module from the app for a node:test file, the same way the other
// tests do (transpile, run in a vm), plus relative imports between .ts files so a
// module that imports a sibling (validate.ts -> links.ts) can be tested as written.
// Only relative .ts imports are resolved; a module that needs anything else is not
// meant for this loader.
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..', '..');
const ts = require(require.resolve('typescript', { paths: [process.env.BODYTRACK_DEPENDENCIES || root] }));

function loadTs(file, cache = new Map()) {
  const full = path.resolve(root, file);
  if (cache.has(full)) return cache.get(full).exports;
  const code = ts.transpileModule(readFileSync(full, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  cache.set(full, loaded);
  const localRequire = (request) => {
    if (!request.startsWith('.')) throw new Error(`load-ts: cannot resolve "${request}" from ${file}`);
    return loadTs(path.relative(root, path.resolve(path.dirname(full), `${request}.ts`)), cache);
  };
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, require: localRequire, Math, Set, WeakMap, Map, Number, Date, Array, String, Object, Error, Promise });
  return loaded.exports;
}

module.exports = { loadTs };
