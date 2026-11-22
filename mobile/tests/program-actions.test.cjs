// Run with node --test tests/program-actions.test.cjs. Pure logic, no I/O.
/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const mobileRoot = path.resolve(__dirname, '..');
const ts = require(require.resolve('typescript', {
  paths: [process.env.BODYTRACK_DEPENDENCIES || mobileRoot],
}));

const code = ts.transpileModule(readFileSync(path.join(mobileRoot, 'src/programs/programActions.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module_ = { exports: {} };
// Share this realm's Error so `instanceof Error` in the module matches errors thrown by the test.
vm.runInNewContext(code, { module: module_, exports: module_.exports, Error });
const { createProgramCreator, createProgramMutations } = module_.exports;

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const plain = outcome => ({ ...outcome });

function fakeApi(overrides = {}) {
  const calls = [];
  const record = name => async (...args) => { calls.push([name, ...args]); return { id: 'p1', name }; };
  return {
    calls,
    api: {
      updateProgram: record('updateProgram'),
      activateProgram: record('activateProgram'),
      deleteProgram: record('deleteProgram'),
      createTemplate: record('createTemplate'),
      ...overrides,
    },
  };
}

// ---- create program ----

test('create: an empty or blank name sends nothing and says why', async () => {
  const calls = [];
  let starts = 0;
  const create = createProgramCreator(async name => { calls.push(name); return { id: 'x' }; });
  assert.deepEqual(plain(await create('   ', () => { starts += 1; })), { kind: 'invalid', message: 'Enter a program name.' });
  assert.equal(calls.length, 0);
  assert.equal(starts, 0);
});

test('create: the name is trimmed and the new id is returned', async () => {
  const calls = [];
  const create = createProgramCreator(async name => { calls.push(name); return { id: 'new-id' }; });
  const outcome = await create('  Push Pull Legs ');
  assert.equal(outcome.kind, 'done');
  assert.equal(outcome.value.id, 'new-id');
  assert.deepEqual(calls, ['Push Pull Legs']);
});

test('create: a double press starts one request and the second is ignored', async () => {
  const gate = deferred();
  let calls = 0;
  let starts = 0;
  const create = createProgramCreator(() => { calls += 1; return gate.promise; });

  const first = create('PPL', () => { starts += 1; });
  const second = await create('PPL', () => { starts += 1; });
  assert.equal(second.kind, 'ignored');
  assert.equal(calls, 1);
  assert.equal(starts, 1);

  gate.resolve({ id: 'p' });
  assert.equal((await first).kind, 'done');
});

test('create: a failure reports the message, then a retry is allowed', async () => {
  let attempt = 0;
  const create = createProgramCreator(async () => {
    attempt += 1;
    if (attempt === 1) throw new Error('Cannot connect right now.');
    return { id: 'p2' };
  });
  assert.deepEqual(plain(await create('PPL')), { kind: 'failed', message: 'Cannot connect right now.' });
  const retry = await create('PPL');
  assert.equal(retry.kind, 'done');
  assert.equal(attempt, 2);
});

test('create: a non-Error rejection falls back to the generic message', async () => {
  const create = createProgramCreator(async () => { throw 'boom'; });
  assert.deepEqual(plain(await create('PPL')), { kind: 'failed', message: 'Could not create the program' });
});

// ---- program detail ----

test('activate: a double press sends one request; failure unlocks it for a retry', async () => {
  const gate = deferred();
  let calls = 0;
  const { api } = fakeApi({ activateProgram: () => { calls += 1; return gate.promise; } });
  const m = createProgramMutations(api, 'p1');

  const first = m.activate();
  assert.equal((await m.activate()).kind, 'ignored');
  assert.equal(calls, 1);
  gate.reject(new Error('Server error'));
  assert.deepEqual(plain(await first), { kind: 'failed', message: 'Server error' });

  // The lock was released by the failure: the same instance sends a second request.
  assert.notEqual((await m.activate()).kind, 'ignored');
  assert.equal(calls, 2);
});

test('delete: targets the right program once even when pressed twice', async () => {
  const gate = deferred();
  const { api, calls } = fakeApi({
    deleteProgram: async (...args) => { calls.push(['deleteProgram', ...args]); return gate.promise; },
  });
  const m = createProgramMutations(api, 'p9');
  const first = m.remove();
  assert.equal((await m.remove()).kind, 'ignored');
  gate.resolve();
  assert.equal((await first).kind, 'done');
  assert.deepEqual(calls, [['deleteProgram', 'p9']]);
  // Released afterwards: a failed leave must not keep the screen locked.
  assert.equal((await m.remove()).kind, 'done');
});

test('delete: a failure reports the message and the next press goes through', async () => {
  let attempt = 0;
  const { api } = fakeApi({
    deleteProgram: async () => { attempt += 1; if (attempt === 1) throw new Error('Could not delete'); },
  });
  const m = createProgramMutations(api, 'p1');
  assert.deepEqual(plain(await m.remove()), { kind: 'failed', message: 'Could not delete' });
  assert.equal((await m.remove()).kind, 'done');
});

test('add template: trims the name, uses the given day order, rejects a blank name', async () => {
  const { api, calls } = fakeApi();
  const m = createProgramMutations(api, 'p1');
  assert.deepEqual(plain(await m.addTemplate('  ', 2)), { kind: 'invalid', message: 'Enter a template name.' });
  assert.equal(calls.length, 0);
  assert.equal((await m.addTemplate('  Push A ', 2)).kind, 'done');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['createTemplate', 'p1', { name: 'Push A', day_order: 2 }]]);
});

test('add template: double press creates one template; failure keeps the retry open', async () => {
  const gate = deferred();
  let calls = 0;
  const { api } = fakeApi({ createTemplate: () => { calls += 1; return calls === 1 ? gate.promise : Promise.resolve({ id: 't' }); } });
  const m = createProgramMutations(api, 'p1');
  const first = m.addTemplate('Push A', 0);
  assert.equal((await m.addTemplate('Push A', 0)).kind, 'ignored');
  assert.equal(calls, 1);
  gate.reject(new Error('Network unavailable'));
  assert.deepEqual(plain(await first), { kind: 'failed', message: 'Network unavailable' });
  assert.equal((await m.addTemplate('Push A', 0)).kind, 'done');
  assert.equal(calls, 2);
});

test('rename: the blur that follows "done" is ignored while the first save runs', async () => {
  const gate = deferred();
  let calls = 0;
  const { api } = fakeApi({ updateProgram: () => { calls += 1; return gate.promise; } });
  const m = createProgramMutations(api, 'p1');
  const submit = m.rename(' New name ');
  assert.equal((await m.rename('New name')).kind, 'ignored');
  assert.equal(calls, 1);
  gate.resolve({ id: 'p1', name: 'New name' });
  assert.equal((await submit).kind, 'done');
});

test('rename does not share a lock with the other actions', async () => {
  const gate = deferred();
  const { api } = fakeApi({ updateProgram: () => gate.promise });
  const m = createProgramMutations(api, 'p1');
  const renaming = m.rename('A');
  // Tapping "Add template" blurs the name field and starts a rename; the tap itself must still work.
  assert.equal((await m.addTemplate('Push A', 0)).kind, 'done');
  assert.equal((await m.activate()).kind, 'done');
  gate.resolve({ id: 'p1' });
  await renaming;
});
