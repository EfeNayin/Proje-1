/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, modules = {}) {
  const loaded = { exports: {} };
  const code = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports,
    require: name => { if (!(name in modules)) throw new Error(name); return modules[name]; },
  });
  return loaded.exports;
}
const units = load('src/units/weight.ts');
const { compareSessionWeights: compare, formatRecordedWeightChange: describe } = load(
  'src/workout/sessionComparison.ts', { '../units/weight': units });
const set = (weight, changes = {}) => ({ exercise_id: 'bench', weight_kg: String(weight),
  reps: 8, rir: 2, is_warmup: false, ...changes });

test('compares maxima at identical reps and RIR, showing both sample sizes', () => {
  const [row] = compare('bench', [set(20), set(25), set(22.5)], [set(20), set(22.5)]);
  assert.equal(row.previousWeightKg, 22.5);
  assert.equal(row.currentWeightKg, 25);
  assert.equal(row.deltaKg, 2.5);
  assert.equal(row.currentSetCount, 3);
  assert.equal(row.previousSetCount, 2);
  assert.equal(describe(row.deltaKg, 'kg'), 'Recorded weight +2.5 kg');
});

test('different reps and different RIR are never substituted as matching conditions', () => {
  const prior = [set(40, { reps: 5 }), set(30, { rir: 0 })];
  assert.equal(compare('bench', [set(20)], prior).length, 0);
});

test('unknown RIR on either side is excluded, while explicit RIR zero matches', () => {
  assert.equal(compare('bench', [set(20, { rir: null })], [set(20)]).length, 0);
  assert.equal(compare('bench', [set(20)], [set(20, { rir: null })]).length, 0);
  assert.equal(compare('bench', [set(20, { rir: null })], [set(20, { rir: null })]).length, 0);
  assert.equal(compare('bench', [set(20, { rir: 0 })], [set(20, { rir: 0 })])[0].deltaKg, 0);
});

test('warmups, zero-rep entries and other exercises cannot inflate maxima', () => {
  const excluded = [set(100, { is_warmup: true }), set(100, { reps: 0 }),
    set(100, { exercise_id: 'squat' })];
  const [row] = compare('bench', [...excluded, set(25)], [...excluded, set(20)]);
  assert.equal(row.deltaKg, 5);
  assert.equal(row.currentSetCount, 1);
  assert.equal(row.previousSetCount, 1);
});

test('recorded zero load remains valid without adding an assumed body weight', () => {
  const [row] = compare('bench', [set(0)], [set(0)]);
  assert.equal(row.currentWeightKg, 0);
  assert.equal(row.deltaKg, 0);
});

test('decimal comparisons use stored precision and preserve negative and unchanged results', () => {
  const [lower] = compare('bench', [set('20.10')], [set('20.30')]);
  assert.equal(lower.deltaKg, -0.2);
  assert.equal(describe(lower.deltaKg, 'kg'), 'Recorded weight −0.2 kg');
  const [equal] = compare('bench', [set('20.10')], [set('20.1')]);
  assert.equal(describe(equal.deltaKg, 'lb'), 'Recorded weight unchanged');
});

test('unit preference affects displayed changes, never grouping or arithmetic', () => {
  assert.equal(describe(2.5, 'lb'), 'Recorded weight +5.5 lb');
  assert.equal(describe(-2.5, 'lb'), 'Recorded weight −5.5 lb');
  assert.equal(describe(0.01, 'kg'), 'Recorded weight increase under 0.1 kg');
  assert.equal(describe(-0.01, 'lb'), 'Recorded weight decrease under 0.1 lb');
});

test('each shared group appears once in stable order regardless of set ordering', () => {
  const sets = [set(30, { reps: 10 }), set(20), set(25), set(40, { reps: 5, rir: 0 }),
    set(40, { reps: 8, rir: 0 })];
  const rows = compare('bench', sets, [...sets].reverse());
  assert.deepEqual(Array.from(rows, row => [row.reps, row.rir]), [[5, 0], [8, 0], [8, 2], [10, 2]]);
});

test('empty or invalid logs do not invent matches and inputs stay unchanged', () => {
  const prior = [set(20)];
  const current = [set(25)];
  const before = JSON.stringify({ prior, current });
  compare('bench', current, prior);
  assert.equal(JSON.stringify({ prior, current }), before);
  assert.equal(compare('bench', [], prior).length, 0);
  assert.equal(compare('bench', current, []).length, 0);
  assert.equal(compare('bench', [set('bad'), set(-5), set('Infinity')], prior).length, 0);
});
