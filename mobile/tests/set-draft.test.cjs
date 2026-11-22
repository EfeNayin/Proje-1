/* global __dirname */
// Unsaved workout input kept while the workout screen is closed (Back, then the
// rest-timer pill, must not cost a half-typed set). Screen wiring is covered in
// set-save.test.cjs and the form itself in set-keyboard.test.cjs.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = file => readFileSync(path.join(root, file), 'utf8');
function load(file) {
  const loaded = { exports: {} };
  const code = ts.transpileModule(read(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, Map, Object });
  return loaded.exports;
}
const { createSetDraftStore } = load('src/workout/setDraftStore.ts');
const draft = (changes = {}) => ({ weight: '', reps: '', rir: '', isWarmup: false, ...changes });
const plain = value => JSON.parse(JSON.stringify(value));

test('a draft comes back for the same account, workout and exercise', () => {
  const store = createSetDraftStore();
  store.saveDraft('user', 'workout', 'bench', draft({ weight: '82.5', reps: '6', rir: '2' }));
  assert.deepEqual(plain(store.getDraft('user', 'workout', 'bench')), draft({ weight: '82.5', reps: '6', rir: '2' }));
});

test('drafts are separated by account, workout and exercise', () => {
  const store = createSetDraftStore();
  store.saveDraft('user', 'workout', 'bench', draft({ weight: '80' }));
  for (const [who, workout, exercise] of [['other', 'workout', 'bench'], ['user', 'another', 'bench'], ['user', 'workout', 'squat']]) {
    assert.deepEqual(plain(store.getDraft(who, workout, exercise)), draft());
  }
});

test('an empty form leaves nothing behind, but a warm-up toggle on its own is kept', () => {
  const store = createSetDraftStore();
  store.saveDraft('user', 'workout', 'bench', draft({ weight: '80' }));
  store.saveDraft('user', 'workout', 'bench', draft());
  assert.deepEqual(plain(store.getDraft('user', 'workout', 'bench')), draft());
  store.saveDraft('user', 'workout', 'bench', draft({ isWarmup: true }));
  assert.equal(store.getDraft('user', 'workout', 'bench').isWarmup, true);
});

test('what was saved is a copy: later changes to the caller object do not leak in', () => {
  const store = createSetDraftStore();
  const typed = draft({ weight: '80' });
  store.saveDraft('user', 'workout', 'bench', typed);
  typed.weight = '999';
  assert.equal(store.getDraft('user', 'workout', 'bench').weight, '80');
});

test('picked but unlogged exercises are kept per account and workout', () => {
  const store = createSetDraftStore();
  const picked = [{ id: 'row', name: 'Row' }];
  store.savePending('user', 'workout', picked);
  picked[0].name = 'changed';
  assert.deepEqual(plain(store.getPending('user', 'workout')), [{ id: 'row', name: 'Row' }]);
  assert.deepEqual(plain(store.getPending('other', 'workout')), []);
  assert.deepEqual(plain(store.getPending('user', 'another')), []);
  store.savePending('user', 'workout', []);
  assert.deepEqual(plain(store.getPending('user', 'workout')), []);
});

test('a successful save, a finished workout and a sign-out each drop what they own', () => {
  const store = createSetDraftStore();
  store.saveDraft('user', 'workout', 'bench', draft({ weight: '80' }));
  store.saveDraft('user', 'workout', 'squat', draft({ reps: '5' }));
  store.saveDraft('user', 'next', 'bench', draft({ weight: '60' }));
  store.savePending('user', 'workout', [{ id: 'row', name: 'Row' }]);
  store.savePending('user', 'next', [{ id: 'curl', name: 'Curl' }]);

  store.clearDraft('user', 'workout', 'bench'); // that exercise's set was saved
  assert.equal(store.getDraft('user', 'workout', 'bench').weight, '');
  assert.equal(store.getDraft('user', 'workout', 'squat').reps, '5');

  store.clearWorkout('user', 'workout'); // finished
  assert.equal(store.getDraft('user', 'workout', 'squat').reps, '');
  assert.equal(store.getPending('user', 'workout').length, 0);
  assert.equal(store.getDraft('user', 'next', 'bench').weight, '60'); // another workout is untouched
  assert.equal(store.getPending('user', 'next').length, 1);

  store.reset(); // sign-out
  assert.equal(store.getDraft('user', 'next', 'bench').weight, '');
  assert.equal(store.getPending('user', 'next').length, 0);
});

test('every account reset clears the drafts too, and nothing is written to disk', () => {
  const auth = read('src/auth/AuthContext.tsx');
  const reset = auth.slice(auth.indexOf('resetAccountState: () => {'), auth.indexOf('apply: (view)'));
  assert.match(reset, /setDraftStore\.reset\(\)/);
  assert.doesNotMatch(read('src/workout/setDraftStore.ts'), /SecureStore|AsyncStorage|localStorage|require\(|import /);
});
