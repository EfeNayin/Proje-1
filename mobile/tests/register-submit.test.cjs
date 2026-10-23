// Run with node --test tests/register-submit.test.cjs. Pure logic, no I/O.
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

const code = ts.transpileModule(readFileSync(path.join(mobileRoot, 'src/auth/registerSubmit.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module_ = { exports: {} };
// Share this realm's Error so `instanceof Error` in the module matches errors thrown by the test.
vm.runInNewContext(code, { module: module_, exports: module_.exports, Error });
const { createRegisterSubmitter } = module_.exports;

const valid = {
  email: 'a@b.co',
  username: 'lifter_1',
  password: 'longenough',
  firstName: '',
  timezone: 'Europe/Istanbul',
};

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('invalid fields are rejected in order without a request or loading state', async () => {
  const calls = [];
  let starts = 0;
  const submit = createRegisterSubmitter(async (input) => { calls.push(input); }, () => { starts += 1; });
  const message = async (patch) => (await submit({ ...valid, ...patch })).message;

  assert.equal(await message({ email: '  ' }), 'Enter a valid email address.');
  assert.equal(await message({ email: 'nope' }), 'Enter a valid email address.');
  assert.equal(await message({ username: 'ab' }), 'Username must be at least 3 characters.');
  assert.equal(await message({ username: ' ab ' }), 'Username must be at least 3 characters.');
  assert.equal(await message({ username: 'bad name' }), 'Username can only contain letters, numbers and underscores.');
  assert.equal(await message({ username: 'çağlar' }), 'Username can only contain letters, numbers and underscores.');
  assert.equal(await message({ password: '1234567' }), 'Password must be at least 8 characters.');
  assert.equal(calls.length, 0);
  assert.equal(starts, 0);
});

test('payload is trimmed, username lower-cased, password untouched, optional name omitted', async () => {
  const calls = [];
  const submit = createRegisterSubmitter(async (input) => { calls.push(input); });

  const outcome = await submit({
    email: '  A@B.co ',
    username: '  LiFter_1 ',
    password: ' pass word ',
    firstName: '   ',
    timezone: 'Europe/Istanbul',
  });
  assert.equal(outcome.kind, 'success');
  assert.deepEqual({ ...calls[0] }, {
    email: 'A@B.co',
    username: 'lifter_1',
    password: ' pass word ',
    first_name: undefined,
    timezone: 'Europe/Istanbul',
  });

  await submit({ ...valid, firstName: ' Efe ' });
  assert.equal(calls[1].first_name, 'Efe');
});

test('a second submit while one is in flight starts no second request', async () => {
  const gate = deferred();
  let calls = 0;
  let starts = 0;
  const submit = createRegisterSubmitter(() => { calls += 1; return gate.promise; }, () => { starts += 1; });

  const first = submit(valid);
  const second = await submit(valid); // e.g. keyboard "go" then a button tap
  assert.equal(second.kind, 'ignored');
  assert.equal(calls, 1);
  assert.equal(starts, 1);

  gate.resolve();
  assert.equal((await first).kind, 'success');
});

test('a failure keeps the server wording and releases the lock for a retry with the same input', async () => {
  const seen = [];
  let attempt = 0;
  const submit = createRegisterSubmitter(async (input) => {
    seen.push(input);
    attempt += 1;
    if (attempt === 1) throw new Error('Email already registered');
    if (attempt === 2) throw new Error('Cannot connect right now. Check your connection and try again.');
    if (attempt === 3) throw 'not an Error';
  });

  assert.deepEqual({ ...(await submit(valid)) }, { kind: 'failed', message: 'Email already registered' });
  assert.deepEqual(
    { ...(await submit(valid)) },
    { kind: 'failed', message: 'Cannot connect right now. Check your connection and try again.' },
  );
  assert.deepEqual({ ...(await submit(valid)) }, { kind: 'failed', message: 'Registration failed' });
  assert.equal((await submit(valid)).kind, 'success');
  // Every retry carried the same values: nothing was consumed or cleared by a failure.
  assert.equal(new Set(seen.map((input) => JSON.stringify(input))).size, 1);
  assert.equal(seen.length, 4);
});

test('an invalid submit does not take the lock', async () => {
  const gate = deferred();
  let calls = 0;
  const submit = createRegisterSubmitter(() => { calls += 1; return gate.promise; });

  assert.equal((await submit({ ...valid, password: 'short' })).kind, 'invalid');
  const running = submit(valid);
  assert.equal(calls, 1);
  gate.resolve();
  assert.equal((await running).kind, 'success');
});
