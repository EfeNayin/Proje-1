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

test('saving a populated template sends exactly one complete request', async () => {
  const calls = [];
  const result = { id: 'saved' };
  const api = load('src/api/programs.ts', { './client': {
    apiRequest: async (...args) => { calls.push(args); return result; },
  } });
  const input = { name: 'Push', day_order: 2, exercises: [
    { exercise_id: 'bench', target_sets: 2, target_reps_min: 6, target_reps_max: 8 },
  ] };
  assert.equal(await api.createTemplateWithExercises('program', input), result);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/programs/program/templates/with-exercises');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].body, input);
});

test('failed atomic request propagates without falling back to partial writes', async () => {
  let calls = 0;
  const failure = new Error('Network unavailable');
  const api = load('src/api/programs.ts', { './client': {
    apiRequest: async () => { calls++; throw failure; },
  } });
  await assert.rejects(api.createTemplateWithExercises('program', {
    name: 'Push', exercises: [],
  }), error => error === failure);
  assert.equal(calls, 1);
});

test('targets count only positive working sets and preserve their first occurrence', () => {
  const { buildTemplateExercisesFromWorkout: build } = load('src/workout/templateFromWorkout.ts', {});
  const set = (exercise_id, reps, is_warmup = false) => ({ exercise_id, reps, is_warmup });
  const result = build({ sets: [set('bench', 20, true), set('squat', 0),
    set('row', 10), set('bench', 8), set('row', 6), set('bench', 0), set('squat', 5, true)] });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [
    { exercise_id: 'row', target_sets: 2, target_reps_min: 6, target_reps_max: 10, target_rir: null },
    { exercise_id: 'bench', target_sets: 1, target_reps_min: 8, target_reps_max: 8, target_rir: null },
  ]);
  assert.equal(build({ sets: [set('bench', 10, true), set('row', 0)] }).length, 0);
});
