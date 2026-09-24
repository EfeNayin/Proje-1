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
const code = ts.transpileModule(readFileSync(path.join(root, 'src/workout/planComparison.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(code, { module: loaded, exports: loaded.exports });
const compare = loaded.exports.compareWorkoutToPlan;
const target = (exercise_id, target_sets) => ({ exercise_id, target_sets });
const set = (exercise_id, reps = 8, is_warmup = false) => ({
  exercise_id, reps, is_warmup, weight_kg: '0',
});
const workout = (targets, sets = []) => ({
  template_id: 'live-template', template_snapshot: { exercises: targets }, sets,
});
const counts = result => [result.plannedSets, result.recordedPlannedSets,
  result.unrecordedSets, result.extraSets];

test('planned exercises with no logged sets remain visible in the comparison', () => {
  const result = compare(workout([target('bench', 4), target('squat', 3)]));
  assert.deepEqual(counts(result), [7, 0, 7, 0]);
  assert.equal(result.exercises.get('squat').unrecordedSets, 3);
});

test('extra sets never compensate for unrecorded sets on another exercise', () => {
  const result = compare(workout([target('bench', 2), target('squat', 3)],
    [set('bench'), set('bench'), set('bench'), set('row'), set('squat')]));
  assert.deepEqual(counts(result), [5, 3, 2, 2]);
  assert.equal(result.exercises.get('bench').extraSets, 1);
  assert.equal(result.exercises.get('squat').unrecordedSets, 2);
  assert.equal(result.exercises.get('row').plannedSets, 0);
  assert.equal(result.exercises.get('row').extraSets, 1);
});

test('warm-ups and zero-rep entries do not count; positive bodyweight sets do', () => {
  const result = compare(workout([target('pushup', 3)], [set('pushup', 20, true),
    set('pushup', 0), set('pushup', 10), set('row', 0), set('row', 10, true)]));
  assert.deepEqual(counts(result), [3, 1, 2, 0]);
  assert.equal(result.exercises.has('row'), false);
});

test('repeated exercise targets are combined without counting logged sets twice', () => {
  const result = compare(workout([target('bench', 2), target('bench', 3)],
    [set('bench'), set('bench'), set('bench')]));
  assert.deepEqual(counts(result), [5, 3, 2, 0]);
  assert.equal(result.exercises.size, 1);
  assert.equal(result.exercises.get('bench').recordedSets, 3);
});

test('free, legacy and older-server workouts do not invent a comparison', () => {
  for (const value of [null, { template_id: null, sets: [] },
    { template_id: 'still-exists', template_snapshot: null, sets: [set('bench')] }]) {
    assert.equal(compare(value), null);
  }
});

test('captured empty plans classify logged working sets as extra', () => {
  assert.deepEqual(counts(compare(workout([], [set('bench')]))), [0, 0, 0, 1]);
  assert.deepEqual(counts(compare(workout([]))), [0, 0, 0, 0]);
});

test('finished sessions and deleted template links still use the saved plan', () => {
  const value = workout([target('bench', 2)], [set('bench'), set('bench')]);
  value.template_id = null;
  value.finished_at = '2026-09-24T10:00:00Z';
  assert.deepEqual(counts(compare(value)), [2, 2, 0, 0]);
});

test('set corrections and deletions recompute counts without changing the source plan', () => {
  const value = workout([target('bench', 2)], [set('bench'), set('bench')]);
  const before = JSON.stringify(value);
  assert.deepEqual(counts(compare(value)), [2, 2, 0, 0]);
  assert.equal(JSON.stringify(value), before);
  value.sets[0].is_warmup = true;
  assert.deepEqual(counts(compare(value)), [2, 1, 1, 0]);
  value.sets.pop();
  assert.deepEqual(counts(compare(value)), [2, 0, 2, 0]);
  assert.equal(value.template_snapshot.exercises[0].target_sets, 2);
});
