// The development-only browser preview: tokens stay in memory, native keeps SecureStore.
/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const mobileRoot = path.resolve(__dirname, '..');
const ts = require(require.resolve('typescript', {
  paths: [process.env.BODYTRACK_DEPENDENCIES || mobileRoot],
}));
const shimFile = path.join(mobileRoot, 'src/dev/webSecureStore.ts');

function loadShim(dev) {
  const code = ts.transpileModule(readFileSync(shimFile, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module_ = { exports: {} };
  vm.runInNewContext(code, {
    module: module_, exports: module_.exports, Map, Promise, Error, __DEV__: dev,
  }, { filename: shimFile });
  return module_.exports;
}

test('the web stand-in keeps values in memory only', async () => {
  const store = loadShim(true);
  assert.equal(await store.getItemAsync('k'), null);
  await store.setItemAsync('k', 'v');
  assert.equal(await store.getItemAsync('k'), 'v');
  await store.deleteItemAsync('k');
  assert.equal(await store.getItemAsync('k'), null);

  // A fresh load (a page reload) starts empty: nothing was written anywhere.
  await store.setItemAsync('k', 'v');
  assert.equal(await loadShim(true).getItemAsync('k'), null);
});

test('outside a development bundle the stand-in refuses to hold anything', async () => {
  const store = loadShim(false);
  await assert.rejects(store.setItemAsync('k', 'v'), /development builds only/);
  await assert.rejects(store.getItemAsync('k'), /development builds only/);
  await assert.rejects(store.deleteItemAsync('k'), /development builds only/);
});

test('the stand-in never touches browser storage or cookies', () => {
  const source = readFileSync(shimFile, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie/);
});

test('Metro swaps expo-secure-store on web only', () => {
  const config = require(path.join(mobileRoot, 'metro.config.js'));
  const fallback = (_context, name, platform) => ({ type: 'sourceFile', filePath: `default:${name}:${platform}` });
  const context = { resolveRequest: fallback };
  const resolve = config.resolver.resolveRequest;

  assert.equal(resolve(context, 'expo-secure-store', 'web').filePath, shimFile);
  assert.equal(resolve(context, 'expo-secure-store', 'ios').filePath, 'default:expo-secure-store:ios');
  assert.equal(resolve(context, 'expo-secure-store', 'android').filePath, 'default:expo-secure-store:android');
  assert.equal(resolve(context, 'react', 'web').filePath, 'default:react:web');
});

test('native token storage still goes through SecureStore', () => {
  const source = readFileSync(path.join(mobileRoot, 'src/api/tokens.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.match(source, /from "expo-secure-store"/);
  assert.doesNotMatch(source, /webSecureStore/);
});
