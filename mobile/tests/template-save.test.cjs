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
  assert.equal(await api.createTemplateWithExercises('program', input, 'request'), result);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/programs/program/templates/requests/request');
  assert.equal(calls[0][1].method, 'PUT');
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
  }, 'request'), error => error === failure);
  assert.equal(calls, 1);
});

class ApiError extends Error {
  constructor(status) { super(`Failure ${status}`); this.status = status; }
}

function retryHarness(storage, send) {
  return load('src/workout/templateSaveRequest.ts', {
    'expo-secure-store': storage,
    '../api/client': { ApiError },
    '../api/programs': { createTemplateWithExercises: send },
  });
}

function memoryStorage() {
  const values = new Map();
  return {
    getItemAsync: async key => values.get(key) ?? null,
    setItemAsync: async (key, value) => { values.set(key, value); },
    deleteItemAsync: async key => { values.delete(key); },
  };
}

const proposed = () => ({ programId: 'program', input: {
  name: 'Push', day_order: 1, exercises: [{ exercise_id: 'bench', target_sets: 2 }],
} });

test('lost response and app restart reuse the original request including order and targets', async () => {
  const storage = memoryStorage();
  const calls = [];
  const send = async (...args) => {
    calls.push(args);
    if (calls.length === 1) throw new ApiError(0);
    return { id: 'one-template' };
  };
  let retry = retryHarness(storage, send);
  const first = await retry.prepareTemplateSaveRequest('workout', proposed());
  await assert.rejects(retry.sendTemplateSaveRequest('workout', first));
  retry = retryHarness(storage, send); // Fresh module, like reopening the application.
  const recovered = await retry.prepareTemplateSaveRequest('workout', {
    programId: 'different', input: { name: 'Changed', day_order: 2, exercises: [] },
  });
  await retry.sendTemplateSaveRequest('workout', recovered);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), JSON.parse(JSON.stringify(calls[1])));
  assert.equal(calls[1][2], 'workout');
  assert.deepEqual(JSON.parse(JSON.stringify(await retry.getTemplateSaveRequest('workout'))), proposed());
});

test('storage failure prevents an untracked server write', async () => {
  let calls = 0;
  const storage = memoryStorage();
  storage.setItemAsync = async () => { throw new Error('Storage unavailable'); };
  const retry = retryHarness(storage, async () => { calls++; });
  await assert.rejects(async () => {
    const request = await retry.prepareTemplateSaveRequest('workout', proposed());
    await retry.sendTemplateSaveRequest('workout', request);
  }, /Storage unavailable/);
  assert.equal(calls, 0);
});

test('only validation rejection releases the stored form for correction', async () => {
  for (const status of [0, 401, 404, 409, 422, 500]) {
    const retry = retryHarness(memoryStorage(), async () => { throw new ApiError(status); });
    const request = await retry.prepareTemplateSaveRequest('workout', proposed());
    await assert.rejects(retry.sendTemplateSaveRequest('workout', request));
    assert.equal(await retry.getTemplateSaveRequest('workout') === null, status === 422);
  }
});

test('different workouts keep independent pending saves', async () => {
  const retry = retryHarness(memoryStorage(), async () => ({}));
  await retry.prepareTemplateSaveRequest('one', proposed());
  assert.equal(await retry.getTemplateSaveRequest('two'), null);
  await retry.clearTemplateSaveRequest('one');
  assert.equal(await retry.getTemplateSaveRequest('one'), null);
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
