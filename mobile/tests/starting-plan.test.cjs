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
const code = ts.transpileModule(readFileSync(path.join(root, 'src/workout/startingPlan.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(code, { module: loaded, exports: loaded.exports });
const { getStartingPlan } = loaded.exports;

test('saved targets survive a deleted template link and keep their original order', () => {
  const exercises = [{ exercise_id: 'squat', target_sets: 4 }, { exercise_id: 'bench', target_sets: 3 }];
  const plan = getStartingPlan({ template_id: null,
    template_snapshot: { name: 'Original day', exercises } });
  assert.equal(plan.targets, exercises);
  assert.equal(plan.description, 'Starting plan: Original day');
});

test('legacy and older-server responses never invent historical targets', () => {
  for (const snapshot of [null, undefined]) {
    const plan = getStartingPlan({ template_id: 'still-exists', template_snapshot: snapshot });
    assert.equal(plan.targets.length, 0);
    assert.equal(plan.description, 'Starting targets were not saved for this workout.');
  }
});

test('a captured empty plan is distinguished from unavailable targets', () => {
  const plan = getStartingPlan({ template_id: 'template',
    template_snapshot: { name: 'Empty day', exercises: [] } });
  assert.equal(plan.targets.length, 0);
  assert.equal(plan.description, 'Starting plan: Empty day — no exercise targets');
});

test('free workouts and unloaded screens do not claim to have a starting plan', () => {
  for (const workout of [null, { template_id: null, template_snapshot: null }]) {
    const plan = getStartingPlan(workout);
    assert.equal(plan.targets.length, 0);
    assert.equal(plan.description, null);
  }
});
