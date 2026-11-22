/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadTs } = require('./support/load-ts.cjs');

const root = path.resolve(__dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const payload = loadTs('src/readiness/checkinPayload.ts');
const { createDailyCheckinStore } = loadTs('src/readiness/dailyCheckin.ts');

const log = (over = {}) => ({
  id: 1, log_date: '2026-09-09', sleep_hours: null, sleep_quality: null, energy: null,
  mood: null, soreness: null, notes: null, ...over,
});

function setup(initial = log()) {
  const calls = { get: 0, patch: [] };
  const pending = { get: [], patch: [] };
  let current = initial;
  const api = {
    getToday: () => { calls.get += 1; return new Promise((resolve, reject) => pending.get.push({ resolve, reject })); },
    patchToday: (body) => { calls.patch.push(body); return new Promise((resolve, reject) => pending.patch.push({ resolve, reject })); },
  };
  const store = createDailyCheckinStore(api);
  const settle = async () => { await new Promise((r) => setImmediate(r)); };
  const loadReady = async (user = 'u1', record = current) => {
    store.bind(user);
    const done = store.load();
    pending.get.shift().resolve(record);
    await done;
  };
  return { store, calls, pending, settle, loadReady, setCurrent: (v) => { current = v; } };
}

// Objects made inside the vm have another Object.prototype; compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value));
const httpError = (status, message = 'x') => Object.assign(new Error(message), { status });

// ---- payload helpers ------------------------------------------------------

test('sleep text: empty is not recorded, 0 is a real value, typos are invalid', () => {
  assert.deepEqual(plain(payload.parseSleepText('')), { kind: 'empty' });
  assert.deepEqual(plain(payload.parseSleepText('  ')), { kind: 'empty' });
  assert.deepEqual(plain(payload.parseSleepText('0')), { kind: 'valid', hours: 0 });
  assert.deepEqual(plain(payload.parseSleepText('7,5')), { kind: 'valid', hours: 7.5 });
  assert.deepEqual(plain(payload.parseSleepText('24')), { kind: 'valid', hours: 24 });
  for (const bad of ['25', '7.55', 'abc', '-1', '7.', '1e1', '7 5']) {
    assert.deepEqual(plain(payload.parseSleepText(bad)), { kind: 'invalid' }, bad);
  }
});

test('server decimals show as plain numbers', () => {
  assert.equal(payload.sleepTextOf('7.5'), '7.5');
  assert.equal(payload.sleepTextOf('8.0'), '8');
  assert.equal(payload.sleepTextOf('0.0'), '0');
  assert.equal(payload.sleepTextOf(null), '');
});

test('the pre-workout patch contains only what was filled in', () => {
  assert.equal(payload.buildCheckinPatch({ sleepText: '', energy: null, soreness: {} }), null);
  assert.equal(payload.buildCheckinPatch({ sleepText: 'oops', energy: null, soreness: {} }), null);
  assert.deepEqual(plain(payload.buildCheckinPatch({ sleepText: '0', energy: null, soreness: {} })), { sleep_hours: 0 });
  assert.deepEqual(
    plain(payload.buildCheckinPatch({ sleepText: '7', energy: 4, soreness: { chest: 2 } })),
    { sleep_hours: 7, energy: 4, soreness: { chest: 2 } },
  );
  const onlyEnergy = payload.buildCheckinPatch({ sleepText: '', energy: 3, soreness: {} });
  assert.deepEqual(plain(onlyEnergy), { energy: 3 });
  assert.equal('sleep_hours' in onlyEnergy, false);
  assert.equal('soreness' in onlyEnergy, false);
});

// ---- store ----------------------------------------------------------------

test('loading shows today\'s record in the draft', async () => {
  const s = setup();
  await s.loadReady('u1', log({ sleep_hours: '6.5', sleep_quality: 3, energy: 4 }));
  const state = s.store.getSnapshot();
  assert.equal(state.phase, 'ready');
  assert.deepEqual(plain(state.draft), { sleepText: '6.5', sleepQuality: 3, energy: 4 });
});

test('only changed fields are sent, with the loaded day', async () => {
  const s = setup();
  await s.loadReady('u1', log({ sleep_hours: '6.5', sleep_quality: 3, energy: 4, mood: 2, notes: 'n' }));
  s.store.edit({ sleepText: '7.5' });
  const saving = s.store.save();
  assert.deepEqual(plain(s.calls.patch), [{ sleep_hours: 7.5, expected_log_date: '2026-09-09' }]);
  s.pending.patch[0].resolve(log({ sleep_hours: '7.5', sleep_quality: 3, energy: 4, mood: 2, notes: 'n' }));
  const outcome = await saving;
  assert.equal(outcome.kind, 'done');
  assert.equal(s.store.getSnapshot().saving, false);
});

test('clearing a field is sent as null; untouched fields are not sent', async () => {
  const s = setup();
  await s.loadReady('u1', log({ sleep_hours: '6.5', energy: 4 }));
  s.store.edit({ sleepText: '' });
  void s.store.save();
  assert.deepEqual(plain(s.calls.patch), [{ sleep_hours: null, expected_log_date: '2026-09-09' }]);
});

test('an unchanged form makes no request', async () => {
  const s = setup();
  await s.loadReady('u1', log({ sleep_hours: '6.5' }));
  assert.deepEqual(plain(await s.store.save()), { kind: 'nothing' });
  assert.equal(s.calls.patch.length, 0);
});

test('0 hours is saved as 0, not as empty', async () => {
  const s = setup();
  await s.loadReady();
  s.store.edit({ sleepText: '0' });
  void s.store.save();
  assert.equal(s.calls.patch[0].sleep_hours, 0);
});

test('an invalid sleep value is refused before any request and the draft is kept', async () => {
  const s = setup();
  await s.loadReady();
  s.store.edit({ sleepText: '99', energy: 3 });
  const outcome = await s.store.save();
  assert.equal(outcome.kind, 'invalid');
  assert.equal(s.calls.patch.length, 0);
  const state = s.store.getSnapshot();
  assert.ok(state.sleepError);
  assert.equal(state.draft.sleepText, '99');
  assert.equal(state.draft.energy, 3);
  s.store.edit({ sleepText: '9' });
  assert.equal(s.store.getSnapshot().sleepError, null);
});

test('a second tap while saving makes no second request', async () => {
  const s = setup();
  await s.loadReady();
  s.store.edit({ energy: 4 });
  const first = s.store.save();
  const second = await s.store.save();
  assert.equal(second.kind, 'ignored');
  assert.equal(s.calls.patch.length, 1);
  s.pending.patch[0].resolve(log({ energy: 4 }));
  assert.equal((await first).kind, 'done');
});

test('edits are ignored while a save is in flight', async () => {
  const s = setup();
  await s.loadReady();
  s.store.edit({ energy: 4 });
  const saving = s.store.save();
  s.store.edit({ energy: 1 });
  assert.equal(s.store.getSnapshot().draft.energy, 4);
  s.pending.patch[0].resolve(log({ energy: 4 }));
  await saving;
});

test('a failed save keeps the draft and a retry sends the same fields', async () => {
  const s = setup();
  await s.loadReady();
  s.store.edit({ sleepText: '7', energy: 5 });
  const first = s.store.save();
  s.pending.patch[0].reject(new TypeError('Network request failed'));
  const outcome = await first;
  assert.equal(outcome.kind, 'unknown');
  assert.match(outcome.message, /not be saved twice/);
  assert.deepEqual(plain(s.store.getSnapshot().draft), { sleepText: '7', sleepQuality: null, energy: 5 });
  assert.equal(s.store.getSnapshot().saving, false);
  void s.store.save();
  assert.deepEqual(plain(s.calls.patch[1]), plain(s.calls.patch[0]));
});

test('a refused save (4xx) keeps the draft and reports the message', async () => {
  const s = setup();
  await s.loadReady();
  s.store.edit({ energy: 5 });
  const saving = s.store.save();
  s.pending.patch[0].reject(httpError(422, 'Energy must be 1-5'));
  const outcome = await saving;
  assert.deepEqual(plain(outcome), { kind: 'failed', message: 'Energy must be 1-5' });
  assert.equal(s.store.getSnapshot().draft.energy, 5);
});

test('a day change (409) saves nothing, keeps the edited fields and re-bases the rest', async () => {
  const s = setup();
  await s.loadReady('u1', log({ sleep_hours: '6', energy: 2 }));
  s.store.edit({ sleepText: '8' });
  const saving = s.store.save();
  s.pending.patch[0].reject(httpError(409, 'The day changed'));
  await s.settle();
  assert.equal(s.calls.get, 2, 'reloads today');
  s.pending.get.shift().resolve(log({ log_date: '2026-09-10', id: null, sleep_hours: null, energy: null }));
  const outcome = await saving;
  assert.equal(outcome.kind, 'day-changed');
  const state = s.store.getSnapshot();
  assert.equal(state.log.log_date, '2026-09-10');
  assert.equal(state.draft.sleepText, '8', 'the typed value survives');
  assert.equal(state.draft.energy, null, 'the untouched value follows the new day');
  assert.equal(state.saving, false);
  // The next save names the new day.
  void s.store.save();
  assert.deepEqual(plain(s.calls.patch[1]), { sleep_hours: 8, expected_log_date: '2026-09-10' });
});

test('a failed first load offers a retry and nothing can be saved', async () => {
  const s = setup();
  s.store.bind('u1');
  const loading = s.store.load();
  s.pending.get.shift().reject(new Error('offline'));
  await loading;
  assert.equal(s.store.getSnapshot().phase, 'failed');
  assert.equal((await s.store.save()).kind, 'stale');
  assert.equal(s.calls.patch.length, 0);
  const again = s.store.load();
  s.pending.get.shift().resolve(log());
  await again;
  assert.equal(s.store.getSnapshot().phase, 'ready');
});

test('a second load while one is running is not duplicated', async () => {
  const s = setup();
  s.store.bind('u1');
  const first = s.store.load();
  void s.store.load();
  assert.equal(s.calls.get, 1);
  s.pending.get.shift().resolve(log());
  await first;
});

test('signing out voids a save in flight and clears the draft', async () => {
  const s = setup();
  await s.loadReady();
  s.store.edit({ energy: 4 });
  const saving = s.store.save();
  s.store.reset();
  s.pending.patch[0].resolve(log({ energy: 4 }));
  assert.equal((await saving).kind, 'stale');
  const state = s.store.getSnapshot();
  assert.equal(state.userId, null);
  assert.equal(state.log, null);
  assert.equal(state.draft.energy, null);
});

test('another account never sees the previous account\'s draft, and its late load is ignored', async () => {
  const s = setup();
  s.store.bind('u1');
  const slow = s.store.load();
  s.store.bind('u2');
  assert.equal(s.store.getSnapshot().phase, 'idle');
  const fast = s.store.load();
  s.pending.get[1].resolve(log({ energy: 5 }));
  await fast;
  s.pending.get[0].resolve(log({ energy: 1, sleep_hours: '3' }));
  await slow;
  const state = s.store.getSnapshot();
  assert.equal(state.userId, 'u2');
  assert.equal(state.draft.energy, 5);
  assert.equal(state.draft.sleepText, '');
});

test('binding the same user again keeps the draft', async () => {
  const s = setup();
  await s.loadReady();
  s.store.edit({ energy: 3 });
  s.store.bind('u1');
  assert.equal(s.store.getSnapshot().draft.energy, 3);
});

test('re-loading keeps what the user already changed', async () => {
  const s = setup();
  await s.loadReady('u1', log({ sleep_hours: '6' }));
  s.store.edit({ energy: 5 });
  const again = s.store.load();
  s.pending.get.shift().resolve(log({ sleep_hours: '7', energy: 1 }));
  await again;
  assert.deepEqual(plain(s.store.getSnapshot().draft), { sleepText: '7', sleepQuality: null, energy: 5 });
});

test('a typo survives a re-load, so the user can fix it instead of retyping', async () => {
  const s = setup();
  await s.loadReady('u1', log({ sleep_hours: '6' }));
  s.store.edit({ sleepText: '7..5' });
  const again = s.store.load();
  s.pending.get.shift().resolve(log({ sleep_hours: '6' }));
  await again;
  assert.equal(s.store.getSnapshot().draft.sleepText, '7..5');
});

// ---- source guards --------------------------------------------------------

test('the standalone check-in cannot create or start a workout', () => {
  for (const file of ['src/readiness/dailyCheckin.ts', 'src/readiness/dailyCheckinSession.ts', 'app/(app)/daily-checkin.tsx']) {
    const source = read(file);
    assert.doesNotMatch(source, /api\/workouts|api\/programs|setActiveWorkout|startWorkout|templateId/, file);
  }
  assert.match(read('src/readiness/dailyCheckinSession.ts'), /patchToday: readinessApi\.patchTodayReadiness/);
});

test('the pre-workout check-in saves only filled fields and still starts the workout', () => {
  const source = read('app/(app)/workout/checkin.tsx');
  assert.match(source, /buildCheckinPatch/);
  assert.match(source, /patchTodayReadiness/);
  assert.doesNotMatch(source, /upsertTodayReadiness/);
  assert.match(source, /startWorkoutFromTemplate\(templateId\)/);
  assert.match(source, /workoutsApi\.startWorkout\(\)/);
  assert.match(source, /Continue to workout/);
  assert.match(source, /handleSkip/);
});

test('the check-in screen is registered, reachable from Profile and cleared at sign-out', () => {
  assert.ok(existsSync(path.join(root, 'app/(app)/daily-checkin.tsx')));
  assert.match(read('app/(app)/_layout.tsx'), /name="daily-checkin"/);
  assert.match(read('app/(app)/(tabs)/profile.tsx'), /router\.push\("\/daily-checkin"\)/);
  assert.match(read('src/auth/AuthContext.tsx'), /dailyCheckinStore\.reset\(\)/);
});

test('the check-in screen follows the accessibility and layout conventions', () => {
  const source = read('app/(app)/daily-checkin.tsx');
  assert.match(source, /key=\{user\?\.id/);
  assert.match(source, /KeyboardAvoidingView/);
  assert.match(source, /keyboardShouldPersistTaps="handled"/);
  assert.match(source, /accessibilityLabel="Save check-in"/);
  assert.match(source, /minHeight: 5[0-9]|minHeight: 44/);
});
