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

const compile = (file, require_) => {
  const code = ts.transpileModule(readFileSync(path.join(mobileRoot, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  // Share this realm's Error so `instanceof Error` in the module matches errors thrown by the test.
  vm.runInNewContext(code, { module, exports: module.exports, Error, require: require_ });
  return module.exports;
};
const phoneNumber = compile('src/account/phoneNumber.ts');
const module_ = {
  exports: compile('src/auth/registerSubmit.ts', (specifier) => {
    if (specifier === '../account/phoneNumber') return phoneNumber;
    throw new Error(`unexpected import ${specifier}`);
  }),
};
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
    phone_number: undefined,
    timezone: 'Europe/Istanbul',
  });

  await submit({ ...valid, firstName: ' Efe ' });
  assert.equal(calls[1].first_name, 'Efe');
});

test('a blank or missing phone number is valid and is left out of the request', async () => {
  const calls = [];
  const submit = createRegisterSubmitter(async (input) => { calls.push(input); });

  for (const phone of [undefined, '', '   ']) {
    assert.equal((await submit({ ...valid, phoneNumber: phone })).kind, 'success');
  }
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.phone_number, undefined);
    // Left out of the JSON body entirely, exactly like an older client.
    assert.equal('phone_number' in JSON.parse(JSON.stringify(call)), false);
  }
});

test('a phone number is sent normalized, with its country code, never guessed', async () => {
  const calls = [];
  const submit = createRegisterSubmitter(async (input) => { calls.push(input); });

  await submit({ ...valid, phoneNumber: ' +90 (532) 123-45-67 ' });
  await submit({ ...valid, phoneNumber: '0090 532 123 45 67' });
  await submit({ ...valid, phoneNumber: '+1 415 555 0132' });
  assert.deepEqual(calls.map((call) => call.phone_number), ['+905321234567', '+905321234567', '+14155550132']);
});

test('an invalid phone number is refused locally, in screen order, without a request', async () => {
  const calls = [];
  let starts = 0;
  const submit = createRegisterSubmitter(async (input) => { calls.push(input); }, () => { starts += 1; });

  const national = await submit({ ...valid, phoneNumber: '0532 123 45 67' });
  assert.equal(national.kind, 'invalid');
  assert.match(national.message, /country code/);
  assert.doesNotMatch(national.message, /0532 123 45 67$/);
  assert.equal((await submit({ ...valid, phoneNumber: '+9053' })).kind, 'invalid');
  assert.equal((await submit({ ...valid, phoneNumber: '+90 532 abc 45 67' })).kind, 'invalid');
  // Earlier fields are named first, and the phone problem comes before the password one.
  assert.equal(
    (await submit({ ...valid, username: 'ab', phoneNumber: 'nope' })).message,
    'Username must be at least 3 characters.',
  );
  assert.match(
    (await submit({ ...valid, password: 'short', phoneNumber: 'nope' })).message,
    /country code/,
  );
  assert.equal(calls.length, 0);
  assert.equal(starts, 0);
});

test('a refused phone number does not weaken the password rule', async () => {
  const submit = createRegisterSubmitter(async () => {});
  assert.equal(
    (await submit({ ...valid, password: '1234567', phoneNumber: '+905321234567' })).message,
    'Password must be at least 8 characters.',
  );
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

test('Go then a button tap, a button tap then Go, and repeated taps all send one request', async () => {
  // The screen hands the same submitter to the Go key and to the button, so whichever came
  // second (or any number of further taps) meets the first request's lock.
  for (const pattern of ['go,button', 'button,go', 'button,button,button,go,go']) {
    const gate = deferred();
    const seen = [];
    let starts = 0;
    const submit = createRegisterSubmitter(
      (input) => { seen.push(input); return gate.promise; },
      () => { starts += 1; },
    );
    const outcomes = pattern.split(',').map(() => submit(valid));
    // Everything after the first resolves at once as ignored; the first is still pending.
    const later = await Promise.all(outcomes.slice(1));
    assert.ok(later.every((outcome) => outcome.kind === 'ignored'), pattern);
    assert.equal(seen.length, 1, pattern);
    assert.equal(starts, 1, pattern);
    gate.resolve();
    assert.equal((await outcomes[0]).kind, 'success', pattern);
  }
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
