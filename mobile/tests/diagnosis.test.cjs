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
