/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadTs } = require('./support/load-ts.cjs');

const root = path.resolve(__dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const A = loadTs('src/diagnosis/assessment.ts');

const dom = (state, reason, over = {}) => ({
  state, reason, period_start: null, period_end: '2026-09-09', record_count: 0,
  first_recorded_on: null, last_recorded_on: null, latest_age_days: null, ...over,
});
const coverage = (over = {}) => ({
  period_start: '2026-08-10', period_end: '2026-09-06', completed_weeks: 4,
  weeks_with_work: 3, sessions: 9, required_weeks_with_work: 2, ...over,
});
const sleepSufficient = dom('sufficient', null, {
  period_start: '2026-08-13', period_end: '2026-09-09', record_count: 5,
  first_recorded_on: '2026-09-02', last_recorded_on: '2026-09-09', latest_age_days: 0,
});
const weightSufficient = dom('sufficient', null, {
  period_start: '2026-08-13', period_end: '2026-09-09', record_count: 4,
  first_recorded_on: '2026-08-20', last_recorded_on: '2026-09-08', latest_age_days: 1,
});
const trainingSufficient = dom('sufficient', null, {
  period_start: '2026-08-10', period_end: '2026-09-06', record_count: 9,
  first_recorded_on: '2026-08-11', last_recorded_on: '2026-09-04',
});
const response = (over = {}) => ({
  period_weeks: 4, label: 'x', findings: [], has_enough_data: false, training_coverage: null,
  today: '2026-09-09', timezone: 'Europe/Istanbul',
  domains: { training: dom('missing', 'no_working_sets'), sleep: dom('missing', 'no_sleep_records'), weight: dom('missing', 'no_measurements') },
  ...over,
});
const finding = (code, data = {}, severity = 'warning') => ({ code, severity, data });
const sleepLow = finding('sleep_low', { nights_total: 5, days_total: 28, avg_hours: 5.5, nights_under_7: 5,
  period_start: '2026-08-13', period_end: '2026-09-09', first_logged_on: '2026-09-02', last_logged_on: '2026-09-09', latest_age_days: 0 });
// Objects made inside the vm have another prototype; compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value));
const keyed = (view) => Object.fromEntries(view.domains.map((d) => [d.key, d]));
const allText = (view) => JSON.stringify(view);

test('a new user: three separate "No records" cards, no observations, and an honest empty state', () => {
  const view = A.buildAssessment(response());
  assert.deepEqual(plain(view.domains.map((d) => d.key)), ['training', 'sleep', 'weight']);
  assert.deepEqual(plain(view.domains.map((d) => d.state)), ['missing', 'missing', 'missing']);
  assert.equal(view.observations.length, 0);
  assert.equal(view.empty.kind, 'insufficient');
  assert.match(view.empty.title, /Not enough records/);
  assert.equal(view.sufficientCount, 0);
  assert.equal(view.referenceNote, null);
});

test('every state has its own label; none reads as another', () => {
  const states = ['sufficient', 'insufficient', 'stale', 'missing', 'not_applicable'];
  const labels = states.map((state) => A.buildAssessment(response({
    domains: { training: dom('missing', 'no_working_sets'), sleep: dom(state, state === 'sufficient' ? null : 'no_sleep_records'), weight: dom('missing', 'no_measurements') },
  })).domains[1].stateLabel);
  assert.equal(new Set(labels).size, 5);
});

test('partial coverage: sleep alone is sufficient and is still reported, with its own dates', () => {
  const view = A.buildAssessment(response({
    findings: [sleepLow],
    domains: { training: dom('missing', 'no_working_sets'), sleep: sleepSufficient, weight: dom('missing', 'no_measurements') },
  }));
  const d = keyed(view);
  assert.equal(d.sleep.state, 'sufficient');
  assert.equal(d.training.state, 'missing');
  assert.equal(view.observations.length, 1);
  assert.equal(view.observations[0].domain, 'sleep');
  assert.equal(view.sufficientCount, 1);
  assert.equal(view.empty, null);
  assert.match(d.sleep.recordsText, /5 nights recorded, Sep 2, 2026 to Sep 9, 2026/);
});

test('the three domains show their own, different windows', () => {
  const view = A.buildAssessment(response({
    training_coverage: coverage(), has_enough_data: true,
    domains: { training: trainingSufficient, sleep: sleepSufficient, weight: weightSufficient },
  }));
  const d = keyed(view);
  assert.match(d.training.windowText, /Completed weeks Aug 10, 2026 to Sep 6, 2026/);
  assert.match(d.sleep.windowText, /Aug 13, 2026 to Sep 9, 2026 \(through today\)/);
  assert.notEqual(d.training.windowText, d.sleep.windowText);
  assert.equal(view.sufficientCount, 3);
});

test('stale sleep says the record is old; it does not say the user slept little', () => {
  const stale = dom('stale', 'stale_records', { period_start: '2026-08-13', record_count: 3,
    first_recorded_on: '2026-08-14', last_recorded_on: '2026-08-20', latest_age_days: 20 });
  const view = A.buildAssessment(response({ domains: { ...response().domains, sleep: stale } }));
  const sleep = keyed(view).sleep;
  assert.equal(sleep.stateLabel, 'Records out of date');
  assert.match(sleep.recordsText, /20 days old/);
  assert.match(sleep.note, /more than 7 days old/);
  assert.deepEqual(plain(sleep.actions.map((a) => a.target.kind)), ['daily-checkin']);
});

test('missing sleep is unknown, never zero', () => {
  const sleep = keyed(A.buildAssessment(response())).sleep;
  assert.match(sleep.recordsText, /No sleep recorded/);
  assert.match(sleep.note, /unknown, not counted as zero/);
});

test('weight without a goal is not applicable, keeps its records and offers the goal screen', () => {
  const d = dom('not_applicable', 'no_goal', { period_start: '2026-08-13', record_count: 3,
    first_recorded_on: '2026-08-14', last_recorded_on: '2026-09-08', latest_age_days: 1 });
  const weight = keyed(A.buildAssessment(response({ domains: { ...response().domains, weight: d } }))).weight;
  assert.equal(weight.stateLabel, 'Not applicable');
  assert.match(weight.recordsText, /3 weigh-ins/);
  assert.match(weight.note, /none is set/);
  assert.ok(weight.actions.some((a) => a.target.kind === 'nutrition-goals'));
});

test('a maintain goal compares no direction', () => {
  const d = dom('not_applicable', 'goal_maintain');
  const weight = keyed(A.buildAssessment(response({ domains: { ...response().domains, weight: d } }))).weight;
  assert.match(weight.note, /maintain/);
  assert.match(weight.note, /no direction is compared/);
});

test('weight domain short of a span or measurements asks for a weigh-in', () => {
  for (const reason of ['short_span', 'too_few_measurements', 'no_measurements', 'stale_measurements']) {
    const weight = keyed(A.buildAssessment(response({
      domains: { ...response().domains, weight: dom('insufficient', reason) },
    }))).weight;
    assert.ok(weight.actions.some((a) => a.target.kind === 'weight-history'), reason);
  }
});

test('training reasons stay distinct: no records, only the first/current week, too few weeks', () => {
  const texts = ['no_working_sets', 'no_completed_week', 'too_few_weeks_with_work'].map((reason) => {
    const state = reason === 'no_working_sets' ? 'missing' : 'insufficient';
    return keyed(A.buildAssessment(response({
      training_coverage: reason === 'too_few_weeks_with_work' ? coverage({ weeks_with_work: 1 }) : null,
      domains: { ...response().domains, training: dom(state, reason, { record_count: 1 }) },
    }))).training.recordsText;
  });
  assert.equal(new Set(texts).size, 3);
  assert.match(texts[0], /No working sets were recorded/);
  assert.match(texts[1], /first recorded week or the week in progress/);
  assert.match(texts[2], /1 week of the 4 evaluated/);
});

test('training gaps never claim the user did not train', () => {
  const view = A.buildAssessment(response());
  const training = keyed(view).training;
  assert.match(training.note, /describes what was recorded, not what you did/);
});

test('an insufficient training domain does not hide a supported sleep observation', () => {
  const view = A.buildAssessment(response({
    findings: [sleepLow],
    domains: { training: dom('insufficient', 'too_few_weeks_with_work', { record_count: 1 }), sleep: sleepSufficient, weight: dom('missing', 'no_measurements') },
  }));
  assert.equal(view.observations.length, 1);
  assert.equal(view.empty, null);
});

test('coverage findings become domain state, not observations', () => {
  const view = A.buildAssessment(response({
    findings: [finding('readiness_no_data', {}, 'info'), finding('weight_no_data', {}, 'info')],
  }));
  assert.equal(view.observations.length, 0);
  assert.equal(view.empty.kind, 'insufficient');
});

test('"no observations" with a sufficient domain does not claim adequacy', () => {
  const view = A.buildAssessment(response({
    domains: { ...response().domains, sleep: sleepSufficient },
  }));
  assert.equal(view.empty.kind, 'nothing-found');
  assert.match(view.empty.text, /does not mean your training or recovery is adequate/);
  assert.match(view.empty.text, /were not assessed/);
});

test('things worth checking come before readings that look consistent, server order kept inside each', () => {
  const consistent = finding('training_consistent', { weeks_with_work: 4, completed_weeks: 4, sessions: 12, avg_sessions_per_week: 3 }, 'good');
  const view = A.buildAssessment(response({
    findings: [consistent, sleepLow],
    training_coverage: coverage(), has_enough_data: true,
    domains: { training: trainingSufficient, sleep: sleepSufficient, weight: dom('missing', 'no_measurements') },
  }));
  assert.deepEqual(plain(view.observations.map((o) => o.kind)), ['check', 'consistent']);
  assert.equal(view.observations[0].domain, 'sleep');
});

test('repeated finding codes get distinct keys', () => {
  const a = finding('volume_below_mev', { muscle: 'chest', muscle_tr: 'Göğüs', actual_sets: 4, mev: 8, mav: 14, mrv: 20, weeks: 4, status: 'below_mev' });
  const b = finding('volume_below_mev', { muscle: 'back', muscle_tr: 'Sırt', actual_sets: 5, mev: 8, mav: 14, mrv: 20, weeks: 4, status: 'below_mev' });
  const keys = A.buildObservations([a, b]).map((o) => o.key);
  assert.equal(new Set(keys).size, 2);
});

test('the reference note appears with a volume observation and only then', () => {
  const volume = finding('volume_below_mev', { muscle: 'chest', muscle_tr: 'Göğüs', actual_sets: 4, mev: 8, mav: 14, mrv: 20, weeks: 4, status: 'below_mev' });
  const withVolume = A.buildAssessment(response({ findings: [volume] }));
  assert.equal(withVolume.referenceNote, A.VOLUME_REFERENCE_NOTE);
  assert.match(withVolume.referenceNote, /Renaissance Periodization/);
  assert.match(withVolume.referenceNote, /not peer-reviewed/);
  assert.match(withVolume.referenceNote, /not been validated for you/);
  assert.equal(A.buildAssessment(response({ findings: [sleepLow] })).referenceNote, null);
});

test('a server that does not send domains still produces a safe view', () => {
  const { domains: _omit, ...legacy } = response();
  const view = A.buildAssessment(legacy);
  assert.equal(view.domains.length, 0);
  assert.equal(view.sufficientCount, 0);
  assert.ok(view.limitations.length >= 3);
});

test('limitations are always present and say what the reading is not', () => {
  const text = A.buildAssessment(response()).limitations.join(' ');
  assert.match(text, /does not measure muscle growth/);
  assert.match(text, /cannot tell why/);
  assert.match(text, /unknown, not zero/);
  assert.match(text, /RIR is unknown, not low effort|without RIR is unknown, not low effort/);
});

test('no copy claims a cause, muscle growth, or uses alarming labels', () => {
  const volume = finding('volume_above_mrv', { muscle: 'chest', muscle_tr: 'Göğüs', actual_sets: 30, mev: 8, mav: 14, mrv: 20, weeks: 4, status: 'above_mrv' });
  const view = A.buildAssessment(response({
    findings: [volume, sleepLow,
      finding('weight_stalled_bulk', { weeks: 4, change_pct: 0.1, change_kg: 0.1, first_kg: 80, last_kg: 80.1, measurements: 4, days_span: 20, first_logged_on: '2026-08-20', last_logged_on: '2026-09-08', latest_age_days: 1, threshold_pct: 0.5 }, 'critical'),
      finding('training_infrequent', { weeks_with_work: 2, completed_weeks: 4, sessions: 3, avg_sessions_per_week: 0.8 })],
    training_coverage: coverage(), has_enough_data: true,
    domains: { training: trainingSufficient, sleep: sleepSufficient, weight: weightSufficient },
  }));
  const text = allText(view);
  assert.doesNotMatch(text, /critical/i);
  assert.doesNotMatch(text, /\byou are not growing\b|\bis why\b|\bbecause of\b|\bcaused by\b|\bthe reason\b/i);
  assert.doesNotMatch(text, /muscle (gain|growth) (is|was|of)/i);
  assert.doesNotMatch(text, /muscle you gained|gained muscle/i);
  assert.doesNotMatch(text, /Zero sleep|0 hours of sleep/i);
});

test('every action leads to a screen or a research entry that exists', () => {
  const entries = [...read('src/research/library/entries.ts').matchAll(/^\s+id: "([a-z-]+)"/gm)].map((m) => m[1]);
  assert.ok(entries.length >= 11);
  const volumeData = { muscle: 'chest', muscle_tr: 'Göğüs', actual_sets: 4, mev: 8, mav: 14, mrv: 20, weeks: 4, status: 'below_mev' };
  const weightData = { weeks: 4, change_pct: 0.1, change_kg: 0.1, first_kg: 80, last_kg: 80.1, measurements: 4, days_span: 20,
    first_logged_on: '2026-08-20', last_logged_on: '2026-09-08', latest_age_days: 1, threshold_pct: 0.5 };
  const trainingData = { weeks_with_work: 2, completed_weeks: 4, sessions: 3, avg_sessions_per_week: 0.8 };
  const byCode = {
    volume_below_mev: volumeData, volume_above_mrv: volumeData,
    muscles_untrained: { region: 'core', count: 1, muscles: ['abs'], muscles_tr: ['Karın'] },
    sleep_low: sleepLow.data, sleep_very_low: sleepLow.data,
    weight_stalled_bulk: weightData, weight_stalled_cut: weightData, weight_on_track: weightData,
    training_infrequent: trainingData, training_consistent: trainingData,
  };
  const observations = A.buildObservations(Object.entries(byCode).map(([code, data]) => finding(code, data)));
  assert.equal(observations.length, 10);
  const domainStates = ['sufficient', 'insufficient', 'stale', 'missing', 'not_applicable'];
  const reasons = [null, 'no_working_sets', 'no_completed_week', 'too_few_weeks_with_work', 'no_sleep_records', 'too_few_nights', 'stale_records',
    'no_measurements', 'too_few_measurements', 'short_span', 'stale_measurements', 'no_goal', 'goal_maintain'];
  const actions = observations.flatMap((o) => o.actions);
  for (const state of domainStates) for (const reason of reasons) {
    const d = dom(state, reason, { period_start: '2026-08-10' });
    actions.push(...A.buildAssessment(response({ training_coverage: coverage(), domains: { training: d, sleep: d, weight: d } })).domains.flatMap((v) => v.actions));
  }
  assert.ok(actions.length > 20);
  const files = {
    '/daily-checkin': 'app/(app)/daily-checkin.tsx',
    '/profile/weight-history': 'app/(app)/profile/weight-history.tsx',
    '/profile/nutrition-goals': 'app/(app)/profile/nutrition-goals.tsx',
    '/volume': 'app/(app)/(tabs)/volume.tsx',
    // "Review training records" must open the completed sessions, which live on the History tab.
    '/history': 'app/(app)/(tabs)/history.tsx',
  };
  for (const action of actions) {
    const href = A.hrefFor(action.target);
    if (action.target.kind === 'research') {
      assert.ok(entries.includes(action.target.id), `unknown research entry ${action.target.id}`);
      assert.equal(href, `/research/${action.target.id}`);
      assert.ok(existsSync(path.join(root, 'app/(app)/research/[id].tsx')));
    } else {
      assert.ok(files[href], `no screen for ${href}`);
      assert.ok(existsSync(path.join(root, files[href])), files[href]);
    }
    assert.ok(action.label.length > 0 && action.hint.length > 0);
  }
});

test('days are formatted without a Date, so no timezone can shift them', () => {
  assert.equal(A.formatDay('2026-09-04'), 'Sep 4, 2026');
  assert.equal(A.formatDay('2026-01-01'), 'Jan 1, 2026');
  assert.equal(A.formatDay('2026-12-31'), 'Dec 31, 2026');
  assert.equal(A.formatDay(null), '');
  assert.equal(A.formatDay('garbage'), '');
});

test('the diagnosis screen uses the view model, refreshes on focus and is account-scoped', () => {
  const source = read('app/(app)/diagnosis.tsx');
  assert.match(source, /buildAssessment/);
  assert.match(source, /useFocusEffect|useIsFocused/);
  assert.match(source, /key=\{user\?\.id|user\?\.id/);
  assert.match(source, /Observations/);
  assert.match(source, /What was evaluated/);
  assert.match(source, /createDiagnosisLoader/);
});
