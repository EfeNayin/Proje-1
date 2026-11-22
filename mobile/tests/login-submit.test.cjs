// Run with node --test tests/login-submit.test.cjs. Pure logic, no I/O.
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

const code = ts.transpileModule(readFileSync(path.join(mobileRoot, 'src/auth/loginSubmit.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module_ = { exports: {} };
// Share this realm's Error so `instanceof Error` in the module matches errors thrown by the test.
vm.runInNewContext(code, { module: module_, exports: module_.exports, Error });
const { createLoginSubmitter } = module_.exports;

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('empty fields are rejected without a request or loading state', async () => {
  const calls = [];
  let starts = 0;
  const submit = createLoginSubmitter(async (...args) => { calls.push(args); }, () => { starts += 1; });

  assert.deepEqual({ ...(await submit('   ', 'pw')) }, { kind: 'invalid', message: 'Enter your email address.' });
  assert.deepEqual({ ...(await submit('a@b.co', '')) }, { kind: 'invalid', message: 'Enter your password.' });
  assert.equal(calls.length, 0);
  assert.equal(starts, 0);
});

test('email is trimmed, password is sent untouched', async () => {
  const calls = [];
  const submit = createLoginSubmitter(async (...args) => { calls.push(args); });
  assert.equal((await submit('  a@b.co ', ' pw ')).kind, 'success');
  assert.deepEqual(calls, [['a@b.co', ' pw ']]);
});

test('a second submit while one is in flight starts no second request', async () => {
  const gate = deferred();
  let calls = 0;
  const submit = createLoginSubmitter(() => { calls += 1; return gate.promise; });

  const first = submit('a@b.co', 'pw');
  const second = await submit('a@b.co', 'pw'); // e.g. keyboard "go" then a button tap
  assert.equal(second.kind, 'ignored');
  assert.equal(calls, 1);

  gate.resolve();
  assert.equal((await first).kind, 'success');
});

test('failure reports the server message and allows a retry', async () => {
  let attempt = 0;
  let starts = 0;
  const submit = createLoginSubmitter(async () => {
    attempt += 1;
    if (attempt === 1) throw new Error('Incorrect email or password');
    if (attempt === 2) throw 'not an Error';
  }, () => { starts += 1; });

  assert.deepEqual({ ...(await submit('a@b.co', 'pw')) }, { kind: 'failed', message: 'Incorrect email or password' });
  assert.deepEqual({ ...(await submit('a@b.co', 'pw')) }, { kind: 'failed', message: 'Sign in failed' });
  assert.equal((await submit('a@b.co', 'pw')).kind, 'success');
  assert.equal(starts, 3);
});
