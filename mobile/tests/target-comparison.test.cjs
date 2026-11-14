/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const dependencies = process.env.BODYTRACK_DEPENDENCIES || root;
const ts = require(require.resolve('typescript', { paths: [dependencies] }));
const loaded = { exports: {} };
const code = ts.transpileModule(readFileSync(path.join(root, 'src/workout/targetComparison.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(code, { module: loaded, exports: loaded.exports });
const { compareExerciseTargets: compare, describeTargetComparison: describe } = loaded.exports;
const target = (changes = {}) => ({ exercise_id: 'bench', target_sets: 2,
  target_reps_min: 6, target_reps_max: 8, target_rir: 2, ...changes });
const set = (reps, rir = null, changes = {}) => ({ exercise_id: 'bench', reps, rir,
  is_warmup: false, weight_kg: '0', ...changes });
const counts = result => [result.below, result.within, result.above, result.unrecorded];

test('rep boundaries are inclusive and all recorded working sets include extras', () => {
  const result = compare([target()], [set(5), set(6), set(8), set(9)]);
  assert.equal(result.workingSets, 4);
  assert.deepEqual(counts(result.reps), [1, 2, 1, 0]);
});

test('single-sided and exact rep targets have distinct valid bounds', () => {
  const sets = [set(5), set(6), set(8), set(9)];
  assert.deepEqual(counts(compare([target({ target_reps_max: null })], sets).reps), [1, 3, 0, 0]);
  assert.deepEqual(counts(compare([target({ target_reps_min: null })], sets).reps), [0, 3, 1, 0]);
  assert.deepEqual(counts(compare([target({ target_reps_max: 6 })], sets).reps), [1, 1, 2, 0]);
});

test('unknown RIR never becomes zero or counts as matching the target', () => {
  const result = compare([target()], [set(8, null), set(8, 0), set(8, 2), set(8, 3)]);
  assert.deepEqual(counts(result.rir), [1, 1, 1, 1]);
  assert.match(describe(result)[1], /1 not recorded/);
});

test('RIR target zero is compared rather than mistaken for a missing target', () => {
  assert.deepEqual(counts(compare([target({ target_rir: 0 })],
    [set(8, 0), set(8, 1), set(8)]).rir), [0, 1, 1, 1]);
});

test('warm-ups, zero-rep entries and other exercises do not affect either dimension', () => {
  const result = compare([target()], [set(20, 10, { is_warmup: true }), set(0, 0),
    set(12, 0, { exercise_id: 'squat' }), set(7, 2)]);
  assert.equal(result.workingSets, 1);
  assert.deepEqual(counts(result.reps), [0, 1, 0, 0]);
  assert.deepEqual(counts(result.rir), [0, 1, 0, 0]);
});

test('absent targets do not create a comparison even when RIR is recorded', () => {
  assert.equal(compare([], [set(8, 2)]), null);
  assert.equal(describe(null).length, 0);
  const result = compare([target({ target_reps_min: null, target_reps_max: null,
    target_rir: null, target_rpe: '8.0' })], [set(8, 2)]);
  assert.equal(result.reps.status, 'missing');
  assert.equal(result.rir.status, 'missing');
  assert.equal(describe(result).length, 0); // RPE is not converted into RIR.
});

test('identical targets across repeated blocks count each logged set only once', () => {
  const result = compare([target(), target({ target_sets: 3 })], [set(8, 2), set(8, 2)]);
  assert.deepEqual(counts(result.reps), [0, 2, 0, 0]);
  assert.deepEqual(counts(result.rir), [0, 2, 0, 0]);
});

test('different rep blocks are not assigned to sets but common RIR can still be compared', () => {
  const result = compare([target(), target({ target_reps_min: 10, target_reps_max: 12 })],
    [set(6, 2), set(12, 2)]);
  assert.equal(result.reps.status, 'mixed');
  assert.deepEqual(counts(result.rir), [0, 2, 0, 0]);
  assert.match(describe(result)[0], /different starting targets/);
});

test('different RIR blocks do not prevent comparison with common rep targets', () => {
  const result = compare([target(), target({ target_rir: 0 })], [set(8, 0)]);
  assert.equal(result.rir.status, 'mixed');
  assert.deepEqual(counts(result.reps), [0, 1, 0, 0]);
});

test('a missing target in one repeated block is not replaced with the other block target', () => {
  const result = compare([target(), target({ target_rir: null, target_reps_max: null })], [set(8, 2)]);
  assert.equal(result.rir.status, 'mixed');
  assert.equal(result.reps.status, 'mixed');
});

test('empty logs say no working sets recorded instead of implying target achievement', () => {
  const lines = describe(compare([target()], []));
  assert.deepEqual(Array.from(lines), ['Reps: no working sets recorded.', 'RIR: no working sets recorded.']);
});

test('corrections and cleared RIR recalculate without mutating the plan or original log', () => {
  const targets = [target()];
  const sets = [set(5, 0)];
  const before = JSON.stringify({ targets, sets });
  assert.deepEqual(counts(compare(targets, sets).rir), [1, 0, 0, 0]);
  assert.equal(JSON.stringify({ targets, sets }), before);
  const corrected = compare(targets, [set(7, null)]);
  assert.deepEqual(counts(corrected.reps), [0, 1, 0, 0]);
  assert.deepEqual(counts(corrected.rir), [0, 0, 0, 1]);
});
