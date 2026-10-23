// Run with node --test tests/weekly-volume.test.cjs. Pure logic, no I/O.
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

function load(file) {
  const code = ts.transpileModule(readFileSync(path.join(mobileRoot, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module_ = { exports: {} };
  // Share this realm's Error/Array so `instanceof`/`isArray` match values built by the test.
  vm.runInNewContext(code, { module: module_, exports: module_.exports, Error, Array, Math, Date });
  return module_.exports;
}
const { createWeeklyVolumeLoader, initialVolumeState } = load('src/volume/weeklyVolumeLoader.ts');
const view = load('src/volume/volumePresentation.ts');

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const plain = value => JSON.parse(JSON.stringify(value));

const muscle = (over = {}) => ({
  muscle_group_id: 1, name: 'front_delts', name_tr: 'Ön omuz', region: 'upper',
  direct_sets: 0, involved_sets: 0, avg_effectiveness: null, volume_kg: '0.00',
  mev: 6, mav: 14, mrv: 20, status: 'untrained', ...over,
});
const response = (...starts) => ({ timezone: 'Europe/Istanbul', weeks: starts.map(week_start => ({ week_start, muscles: [muscle()] })) });

// ---- loader ----

function harness(fetchImpl) {
  const states = [];
  const loader = createWeeklyVolumeLoader(fetchImpl, state => states.push(plain(state)));
  return { loader, states, last: () => states[states.length - 1] };
}

test('first load shows loading, then the data', async () => {
  const data = response('2026-10-12');
  const h = harness(async () => data);
  assert.deepEqual(plain(initialVolumeState()), { data: null, loading: true, refreshing: false, error: null });
  await h.loader.load();
  assert.equal(h.states[0].loading, true);
  assert.equal(h.last().loading, false);
  assert.equal(h.last().data.weeks[0].week_start, '2026-10-12');
  assert.equal(h.last().error, null);
});

test('a failed first load reports the error and retry works', async () => {
  let attempt = 0;
  const h = harness(async () => {
    attempt += 1;
    if (attempt === 1) throw new Error('Cannot connect right now.');
    return response('2026-10-12');
  });
  await h.loader.load();
  assert.equal(h.last().data, null);
  assert.equal(h.last().loading, false);
  assert.equal(h.last().error, 'Cannot connect right now.');
  await h.loader.load();
  assert.equal(h.last().error, null);
  assert.equal(h.last().data.weeks.length, 1);
});

test('a failed refresh keeps the data already on screen and records the error', async () => {
  let attempt = 0;
  const h = harness(async () => {
    attempt += 1;
    if (attempt === 2) throw new Error('Server error');
    return response('2026-10-12');
  });
  await h.loader.load();
  await h.loader.load();
  assert.equal(h.last().data.weeks[0].week_start, '2026-10-12');
  assert.equal(h.last().error, 'Server error');
  assert.equal(h.last().refreshing, false);
  // A reload with data on screen never falls back to the full-screen spinner.
  assert.ok(h.states.every((state, i) => i === 0 || state.data === null || state.loading === false));
});

test('a late response from an older request cannot overwrite a newer one', async () => {
  const slow = deferred();
  const fast = deferred();
  const queue = [slow, fast];
  const h = harness(() => queue.shift().promise);

  const first = h.loader.load();
  const second = h.loader.load();
  fast.resolve(response('2026-10-19'));
  await second;
  slow.resolve(response('2026-10-12'));
  await first;
  assert.equal(h.last().data.weeks[0].week_start, '2026-10-19');
});

test('a late failure from an older request cannot replace newer data with an error', async () => {
  const slow = deferred();
  const fast = deferred();
  const queue = [slow, fast];
  const h = harness(() => queue.shift().promise);
  const first = h.loader.load();
  const second = h.loader.load();
  fast.resolve(response('2026-10-19'));
  await second;
  slow.reject(new Error('Timed out'));
  await first;
  assert.equal(h.last().error, null);
  assert.equal(h.last().data.weeks[0].week_start, '2026-10-19');
});

test('blur invalidates an in-flight request so it never updates the screen', async () => {
  const gate = deferred();
  const h = harness(() => gate.promise);
  const pending = h.loader.load();
  const before = h.states.length;
  h.loader.invalidate();
  gate.resolve(response('2026-10-12'));
  await pending;
  assert.equal(h.states.length, before);
});

test('a malformed response is treated as a failure, not as an empty week', async () => {
  const h = harness(async () => ({ timezone: 'UTC' }));
  await h.loader.load();
  assert.equal(h.last().data, null);
  assert.match(h.last().error, /Unexpected response/);
});

// ---- week selection ----

const weeks = response('2026-10-19', '2026-10-12', '2026-10-05').weeks;

test('selection defaults to the newest week and stays inside the loaded range', () => {
  assert.equal(view.resolveOffset(weeks, null), 0);
  assert.equal(view.stepWeek(weeks, null, -1), '2026-10-19', 'no week after the current one');
  assert.equal(view.stepWeek(weeks, null, 1), '2026-10-12');
  assert.equal(view.stepWeek(weeks, '2026-10-05', 1), '2026-10-05', 'no week before the oldest loaded one');
  assert.equal(view.stepWeek(weeks, '2026-10-05', -1), '2026-10-12');
});

test('selection follows the week, not its position, when a reload shifts the list', () => {
  const shifted = response('2026-10-26', '2026-10-19', '2026-10-12').weeks;
  assert.equal(view.resolveOffset(shifted, '2026-10-12'), 2);
  assert.equal(shifted[view.resolveOffset(shifted, '2026-10-12')].week_start, '2026-10-12');
  // A selected week that dropped out of the list falls back to the newest, never to another week's data under the old name.
  assert.equal(view.resolveOffset(shifted, '2026-10-05'), 0);
});

test('stepping with no weeks loaded changes nothing', () => {
  assert.equal(view.stepWeek([], null, 1), null);
});

test('week titles: current, previous, then a date range', () => {
  assert.equal(view.formatWeekTitle('2026-10-19', 0), 'This week');
  assert.equal(view.formatWeekTitle('2026-10-12', 1), 'Last week');
  assert.equal(view.formatWeekTitle('2026-10-05', 2), view.formatWeekRange('2026-10-05'));
});

// ---- one muscle ----

test('zero direct sets is described as a record, never as "did not train"', () => {
  const v = view.describeMuscle(muscle({ status: 'untrained' }));
  assert.equal(v.statusLabel, 'No direct sets recorded');
  assert.equal(v.directLabel, '0 direct sets');
  assert.equal(v.bar.fill, 0);
  assert.ok(!/not trained|did not/i.test(v.statusLabel + v.accessibilityLabel));
});

test('zero direct sets without a reference shows no bar and no reference text', () => {
  const v = view.describeMuscle(muscle({ status: 'untrained', mev: null, mav: null, mrv: null }));
  assert.equal(v.bar, null);
  assert.deepEqual([...v.references], []);
  assert.equal(v.statusLabel, 'No direct sets recorded');
});

test('a muscle without a reference keeps its count and invents no range', () => {
  const v = view.describeMuscle(muscle({ direct_sets: 5, status: 'no_reference', mev: null, mav: null, mrv: null }));
  assert.equal(v.directLabel, '5 direct sets');
  assert.equal(v.statusLabel, 'No reference range');
  assert.equal(v.bar, null);
  assert.deepEqual([...v.references], []);
});

test('a partial reference shows only the values the API gave, with no bar', () => {
  const v = view.describeMuscle(muscle({ direct_sets: 4, status: 'no_reference', mev: 6, mav: null, mrv: null }));
  assert.equal(v.bar, null);
  assert.deepEqual([...v.references], ['MEV 6']);
});

test('sets above MRV keep their full number and run past the MRV mark', () => {
  const v = view.describeMuscle(muscle({ direct_sets: 30, involved_sets: 30, status: 'above_mrv', mev: 8, mav: 12, mrv: 20 }));
  assert.equal(v.directLabel, '30 direct sets');
  assert.equal(v.statusLabel, 'Over MRV');
  assert.equal(v.bar.fill, 1);
  assert.equal(v.bar.overMrv, true);
  assert.ok(v.bar.mrv < 1 && v.bar.mrv > v.bar.mav, 'MRV mark sits inside the axis, left of the fill end');
  assert.equal(v.bar.mrv, 20 / 30);
  assert.deepEqual([...v.references], ['MEV 8', 'MAV 12', 'MRV 20']);
});

test('inside the range the marks scale to MRV and the fill is the real fraction', () => {
  const v = view.describeMuscle(muscle({ direct_sets: 10, involved_sets: 14, status: 'optimal', mev: 8, mav: 12, mrv: 20 }));
  assert.equal(v.bar.fill, 0.5);
  assert.equal(v.bar.mrv, 1);
  assert.equal(v.bar.overMrv, false);
  assert.equal(v.indirectSets, 4);
  assert.match(v.accessibilityLabel, /4 indirect sets, not counted/);
});

test('every API status keeps its own label', () => {
  const statuses = ['untrained', 'below_mev', 'optimal', 'high', 'above_mrv', 'no_reference'];
  const labels = statuses.map(status => view.STATUS_LABELS[status]);
  assert.equal(new Set(labels).size, statuses.length);
  assert.deepEqual(Object.keys(view.STATUS_LABELS).sort(), [...statuses].sort());
});

test('singular wording and muscle names', () => {
  assert.equal(view.describeMuscle(muscle({ direct_sets: 1, status: 'below_mev' })).directLabel, '1 direct set');
  assert.equal(view.formatMuscleName('front_delts'), 'Front Delts');
  assert.equal(view.formatMuscleName('biceps'), 'Biceps');
});

test('the accessible sentence carries the marker values the bar only shows visually', () => {
  const v = view.describeMuscle(muscle({ direct_sets: 8, status: 'below_mev', mev: 10, mav: 14, mrv: 20, name: 'biceps' }));
  assert.equal(v.accessibilityLabel, 'Biceps: 8 direct sets. Below MEV. Reference MEV 10, MAV 14, MRV 20.');
});
