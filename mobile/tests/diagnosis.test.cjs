/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const ts = require(require.resolve('typescript', { paths: [process.env.BODYTRACK_DEPENDENCIES || root] }));
const code = ts.transpileModule(readFileSync(path.join(root, 'src/diagnosis/messages.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
vm.runInNewContext(code, { module: loaded, exports: loaded.exports });
const { describeFinding } = loaded.exports;
const { describeTrainingCoverage } = loaded.exports;
const sleepData = { nights_total: 3, days_total: 84, avg_hours: 5,
  nights_under_7: 3, period_start: '2026-06-20', period_end: '2026-09-11',
  first_logged_on: '2026-09-09', last_logged_on: '2026-09-11', latest_age_days: 0 };

test('sleep average explicitly describes the recorded sample, not all 84 days', () => {
  for (const code of ['sleep_low', 'sleep_very_low']) {
    const copy = describeFinding({ code, data: sleepData });
    assert.match(copy.description, /Recorded-night average: 5h/);
    assert.match(copy.description, /3 of 84 days/);
    assert.match(copy.description, /2026-09-09 to 2026-09-11/);
    assert.match(copy.description, /Missing nights are unknown/);
    assert.doesNotMatch(copy.action, /will blunt/);
  }
});

test('stale sleep records ask for current data instead of giving a sleep verdict', () => {
  const copy = describeFinding({ code: 'readiness_no_data', data: { ...sleepData,
    reason: 'stale_records', latest_age_days: 8 } });
  assert.match(copy.description, /8 days ago/);
  assert.match(copy.title, /Recent sleep records/);
});

test('empty sleep coverage does not display null record dates', () => {
  const copy = describeFinding({ code: 'readiness_no_data', data: { ...sleepData,
    reason: 'too_few_nights', nights_total: 0, first_logged_on: null, last_logged_on: null } });
  assert.match(copy.description, /0 of 84 days/);
  assert.doesNotMatch(copy.description, /null|undefined/);
});

test('legacy sleep payload does not invent coverage', () => {
  const copy = describeFinding({ code: 'sleep_low',
    data: { avg_hours: 6, nights_total: 3, nights_under_7: 3 } });
  assert.match(copy.description, /recorded nights only/);
  assert.doesNotMatch(copy.description, /undefined|NaN/);
});
const coverage = { weeks: 12, first_measured_on: '2026-08-28', last_measured_on: '2026-09-11',
  span_days: 14, measurement_count: 3, required_span_days: 14, latest_age_days: 0 };

for (const code of ['weight_stalled_bulk', 'weight_stalled_cut', 'weight_on_track']) {
  test(`${code} shows actual dates, span and sample count instead of selected weeks`, () => {
    const copy = describeFinding({ code, data: { ...coverage, change_kg: 1, change_pct: 1.25 } });
    assert.match(copy.description, /2026-08-28 and 2026-09-11/);
    assert.match(copy.description, /14 days; 3 weigh-ins/);
    assert.doesNotMatch(copy.description, /12 weeks/);
    assert.doesNotMatch(copy.action, /Increase your calorie|Lower your calorie|Keep doing what/);
  });
}

test('short span explains why two measurements are still insufficient', () => {
  const copy = describeFinding({ code: 'weight_no_data', data: { ...coverage,
    reason: 'short_span', span_days: 1, measurement_count: 2 } });
  assert.match(copy.title, /too close/);
  assert.match(copy.description, /At least 14 days/);
  assert.match(copy.action, /wider period/);
});

test('stale measurements ask for a current measurement', () => {
  const copy = describeFinding({ code: 'weight_no_data', data: { ...coverage,
    reason: 'stale_measurements', latest_age_days: 8 } });
  assert.match(copy.description, /8 days ago/);
  assert.match(copy.action, /current measurement/);
});

test('missing measurements show the count and coverage requirement', () => {
  const copy = describeFinding({ code: 'weight_no_data', data: { weeks: 4,
    reason: 'too_few_measurements', measurement_count: 0, required_span_days: 14 } });
  assert.match(copy.description, /0 weigh-ins/);
  assert.match(copy.action, /spanning 14 days/);
});

test('older backend response never invents a measurement interval', () => {
  const copy = describeFinding({ code: 'weight_on_track',
    data: { weeks: 12, change_kg: 1, change_pct: 1.25 } });
  assert.match(copy.description, /first and last recorded weigh-ins/);
  assert.doesNotMatch(JSON.stringify(copy), /undefined|NaN|12 weeks/);
  const empty = describeFinding({ code: 'weight_no_data', data: { weeks: 4 } });
  assert.doesNotMatch(JSON.stringify(empty), /undefined|NaN/);
});

test('training coverage shows evaluated dates, denominator and missing-log limitation', () => {
  const copy = describeTrainingCoverage({ period_start: '2026-08-10', period_end: '2026-09-06',
    completed_weeks: 4, weeks_with_work: 2, sessions: 3, required_weeks_with_work: 2 });
  assert.match(copy, /2026-08-10 to 2026-09-06/);
  assert.match(copy, /3 recorded sessions across 4 completed weeks/);
  assert.match(copy, /2 weeks contain working sets/);
  assert.match(copy, /missing logs/);
});

test('new history never prints null as a date', () => {
  const copy = describeTrainingCoverage({ period_start: null, period_end: '2026-09-06',
    completed_weeks: 0, weeks_with_work: 0, sessions: 0, required_weeks_with_work: 2 });
  assert.match(copy, /No completed training weeks/);
  assert.doesNotMatch(copy, /null|undefined/);
});

test('missing direct sets are described as absent records rather than proof of no training', () => {
  // 'abs', not the Turkish 'Karın' — muscles_untrained now carries English
  // names in `muscles` (see PROJE_1_CODEX_INCELEME.md Adım 16); `muscles_tr`
  // is the Turkish counterpart, reserved for the future translated build.
  const copy = describeFinding({ code: 'muscles_untrained',
    data: { region: 'core', count: 1, muscles: ['abs'], muscles_tr: ['Karın'] } });
  assert.match(copy.description, /No direct working sets were recorded/);
  assert.match(copy.action, /logs are complete/);
  assert.doesNotMatch(copy.title, /untrained/);
});

// Adım 16: volume_below_mev / volume_above_mrv used to splice the Turkish
// muscle_tr name into an otherwise-English sentence ("Göğüs: low recorded
// volume"). These pin the fix — English throughout, muscle_tr ignored.
for (const code of ['volume_below_mev', 'volume_above_mrv']) {
  test(`${code} uses the English muscle name, not muscle_tr, in title and description`, () => {
    const copy = describeFinding({ code, data: { muscle: 'chest', muscle_tr: 'Göğüs',
      avg_sets: 4.8, mev: 8, mrv: 22, weeks_below: 3, weeks_above: 3, weeks_total: 4 } });
    assert.match(copy.title, /^chest:/);
    assert.doesNotMatch(copy.title, /Göğüs/);
    assert.doesNotMatch(copy.description, /Göğüs/);
  });
}
