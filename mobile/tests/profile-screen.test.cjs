// Run with node --test tests/profile-screen.test.cjs. Pure logic, no I/O.
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

function load(file, modules = {}) {
  const code = ts.transpileModule(readFileSync(path.join(mobileRoot, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module_ = { exports: {} };
  // Share this realm's Error so `instanceof Error` matches errors thrown by the test.
  vm.runInNewContext(code, {
    module: module_, exports: module_.exports, Error, Number, Date, Math,
    require: name => {
      if (!(name in modules)) throw new Error(`Unexpected dependency: ${name}`);
      return modules[name];
    },
  });
  return module_.exports;
}
const weight = load('src/units/weight.ts');
const { createBodySummaryLoader, initialBodySummaryState } = load('src/profile/bodySummaryLoader.ts');
const { describeLatestWeight, formatMeasuredOn } = load('src/profile/profilePresentation.ts', {
  '../units/weight': weight,
});
const { createSignOutAction } = load('src/profile/signOutAction.ts');

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const plain = value => JSON.parse(JSON.stringify(value));
const summary = (kg, on) => ({
  current_weight_kg: kg, last_measured_on: on, first_weight_kg: kg, first_measured_on: on, change_kg: '0.0',
});
const empty = { current_weight_kg: null, last_measured_on: null, first_weight_kg: null, first_measured_on: null, change_kg: null };

// ---- latest weight wording ----

test('no measurements is "none", never 0 kg', () => {
  assert.equal(describeLatestWeight(empty, 'kg').kind, 'none');
  assert.equal(describeLatestWeight(empty, 'lb').kind, 'none');
});

test('an unreadable weight is treated as nothing recorded, not shown as NaN or 0', () => {
  assert.equal(describeLatestWeight(summary('abc', '2026-10-21'), 'kg').kind, 'none');
});

test('the measurement and its date are described together', () => {
  const latest = describeLatestWeight(summary('82.40', '2026-10-21'), 'kg');
  assert.equal(latest.kind, 'recorded');
  assert.equal(latest.value, '82.4 kg');
  assert.ok(latest.date.includes('2026'), latest.date);
  assert.equal(latest.date, formatMeasuredOn('2026-10-21'));
  assert.ok(latest.accessibilityLabel.includes(latest.value) && latest.accessibilityLabel.includes(latest.date));
  // Worded as the last recording, never as today's weight.
  assert.ok(!/today|current/i.test(latest.accessibilityLabel));
});

test('the display unit converts through the existing helper; the stored kg is untouched', () => {
  const stored = summary('82.5', '2026-10-21');
  const latest = describeLatestWeight(stored, 'lb');
  assert.equal(latest.value, weight.formatWeight(82.5, 'lb'));
  assert.match(latest.value, /lb$/);
  assert.equal(stored.current_weight_kg, '82.5');
});

test('a weight without a date still shows, without inventing one', () => {
  const latest = describeLatestWeight(summary('82.5', null), 'kg');
  assert.equal(latest.kind, 'recorded');
  assert.equal(latest.date, null);
});

// ---- loader ----

function harness(fetchImpl) {
  const states = [];
  const loader = createBodySummaryLoader(fetchImpl, state => states.push(plain(state)));
  return { loader, states, last: () => states[states.length - 1] };
}

test('first load shows loading, then this user\'s summary', async () => {
  const h = harness(async () => summary('80', '2026-10-01'));
  assert.deepEqual(plain(initialBodySummaryState()), { userId: null, summary: null, loading: true, refreshing: false, error: null });
  await h.loader.load('u1');
  assert.equal(h.states[0].loading, true);
  assert.equal(h.last().userId, 'u1');
  assert.equal(h.last().summary.current_weight_kg, '80');
  assert.equal(h.last().loading, false);
});

test('no measurements and a failed load stay different states', async () => {
  const none = harness(async () => empty);
  await none.loader.load('u1');
  assert.equal(none.last().error, null);
  assert.equal(none.last().summary.current_weight_kg, null);

  const failed = harness(async () => { throw new Error('Cannot connect right now.'); });
  await failed.loader.load('u1');
  assert.equal(failed.last().summary, null);
  assert.equal(failed.last().error, 'Cannot connect right now.');
});

test('a failed load can be retried', async () => {
  let attempt = 0;
  const h = harness(async () => { attempt += 1; if (attempt === 1) throw new Error('Server error'); return summary('80', '2026-10-01'); });
  await h.loader.load('u1');
  await h.loader.load('u1');
  assert.equal(h.last().error, null);
  assert.equal(h.last().summary.current_weight_kg, '80');
});

test('a failed refresh for the same user keeps their summary on screen', async () => {
  let attempt = 0;
  const h = harness(async () => { attempt += 1; if (attempt === 2) throw new Error('Server error'); return summary('80', '2026-10-01'); });
  await h.loader.load('u1');
  await h.loader.load('u1');
  assert.equal(h.last().summary.current_weight_kg, '80');
  assert.equal(h.last().error, 'Server error');
  // The second load never fell back to the full loading state.
  assert.equal(h.states[2].loading, false);
  assert.equal(h.states[2].refreshing, true);
});

test('a different user never sees the previous user\'s weight, even when the load fails', async () => {
  let attempt = 0;
  const h = harness(async () => { attempt += 1; if (attempt === 2) throw new Error('Server error'); return summary('99', '2026-10-01'); });
  await h.loader.load('u1');
  await h.loader.load('u2');
  assert.equal(h.states[2].userId, 'u2');
  assert.equal(h.states[2].summary, null, 'dropped before the request even starts');
  assert.equal(h.last().userId, 'u2');
  assert.equal(h.last().summary, null);
  assert.equal(h.last().error, 'Server error');
});

test('a late answer for the previous user cannot replace the new user\'s state', async () => {
  const slow = deferred();
  const fast = deferred();
  const queue = [slow, fast];
  const h = harness(() => queue.shift().promise);
  const first = h.loader.load('u1');
  const second = h.loader.load('u2');
  fast.resolve(summary('70', '2026-10-02'));
  await second;
  slow.resolve(summary('99', '2026-10-01'));
  await first;
  assert.equal(h.last().userId, 'u2');
  assert.equal(h.last().summary.current_weight_kg, '70');
});

test('a late failure from an older request cannot replace newer data with an error', async () => {
  const slow = deferred();
  const fast = deferred();
  const queue = [slow, fast];
  const h = harness(() => queue.shift().promise);
  const first = h.loader.load('u1');
  const second = h.loader.load('u1');
  fast.resolve(summary('70', '2026-10-02'));
  await second;
  slow.reject(new Error('Timed out'));
  await first;
  assert.equal(h.last().error, null);
  assert.equal(h.last().summary.current_weight_kg, '70');
});

test('blur invalidates an in-flight request so it never updates the screen', async () => {
  const gate = deferred();
  const h = harness(() => gate.promise);
  const pending = h.loader.load('u1');
  const before = h.states.length;
  h.loader.invalidate();
  gate.resolve(summary('80', '2026-10-01'));
  await pending;
  assert.equal(h.states.length, before);
});

// ---- sign out ----

test('sign out: a double tap runs one sign-out', async () => {
  const gate = deferred();
  let calls = 0;
  let starts = 0;
  const run = createSignOutAction(() => { calls += 1; return gate.promise; }, () => { starts += 1; });
  const first = run();
  assert.equal((await run()).kind, 'ignored');
  assert.equal(calls, 1);
  assert.equal(starts, 1);
  gate.resolve();
  assert.equal((await first).kind, 'done');
});

test('sign out: a failure reports why and the button works again', async () => {
  let attempt = 0;
  const run = createSignOutAction(async () => { attempt += 1; if (attempt === 1) throw new Error('Storage unavailable'); });
  assert.deepEqual(plain(await run()), { kind: 'failed', message: 'Storage unavailable' });
  assert.equal((await run()).kind, 'done');
  assert.equal(attempt, 2);
});

test('sign out hands over to the existing flow unchanged', async () => {
  const seen = [];
  const run = createSignOutAction(async (...args) => { seen.push(args.length); });
  await run();
  assert.deepEqual(seen, [0]);
});
