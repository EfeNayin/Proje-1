/* global __dirname */
// Reading the saved nutrition goals for the Diet home (src/nutrition/dietGoals.ts), and a guard that
// the existing goals API and form were not touched by that work.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadTs } = require('./support/load-ts.cjs');
const h = require('./support/screen-harness.cjs');

const { createDietGoalsLoader, formatGoal, hasAnyGoal, normalizeGoals } = loadTs('src/nutrition/dietGoals.ts');

const response = (overrides = {}) => ({
  activity_level: 'moderate', nutrition_goal: 'maintain', missing_for_calculation: [],
  calorie_goal: 2400, protein_goal_g: 180, carb_goal_g: 260, fat_goal_g: 70, ...overrides,
});

test('saved goals are read as they are; an absent goal stays null and prints as an em dash', () => {
  assert.deepEqual(h.plain(normalizeGoals(response())), { calories: 2400, protein: 180, carbs: 260, fat: 70 });
  const partial = normalizeGoals(response({ calorie_goal: null, carb_goal_g: undefined, fat_goal_g: 'x' }));
  assert.deepEqual(h.plain(partial), { calories: null, protein: 180, carbs: null, fat: null });
  assert.equal(formatGoal(null), '—');
  assert.equal(formatGoal(2400), '2400');
  assert.equal(formatGoal(180.4), '180');
  assert.equal(hasAnyGoal(partial), true);
  assert.equal(hasAnyGoal(normalizeGoals(response({ calorie_goal: null, protein_goal_g: null, carb_goal_g: null, fat_goal_g: null }))), false);
  assert.equal(hasAnyGoal(null), false);
  assert.throws(() => normalizeGoals(null), /Unexpected response/);
});

test('loader: loading, then the goals; a load that fails says so instead of reporting "no goals"', async () => {
  const loader = createDietGoalsLoader(async () => response());
  assert.deepEqual(h.plain(loader.getSnapshot()), { goals: null, loading: true, error: null });
  await loader.load();
  assert.deepEqual(h.plain(loader.getSnapshot()), {
    goals: { calories: 2400, protein: 180, carbs: 260, fat: 70 }, loading: false, error: null,
  });

  const failing = createDietGoalsLoader(async () => { throw new Error('Offline'); });
  await failing.load();
  const state = failing.getSnapshot();
  assert.equal(state.goals, null); // unknown, not "none saved"
  assert.equal(state.loading, false);
  assert.equal(state.error, 'Offline');

  const unreadable = createDietGoalsLoader(async () => null);
  await unreadable.load();
  assert.match(unreadable.getSnapshot().error, /Unexpected response/);
  assert.equal(unreadable.getSnapshot().goals, null);
});

test('loader: retry after a failure loads again and clears the error', async () => {
  let attempt = 0;
  const loader = createDietGoalsLoader(async () => {
    if (++attempt === 1) throw new Error('Offline');
    return response({ calorie_goal: 2000 });
  });
  await loader.load();
  assert.equal(loader.getSnapshot().error, 'Offline');
  const states = [];
  loader.subscribe(() => states.push(h.plain(loader.getSnapshot())));
  await loader.load();
  assert.equal(states[0].loading, true); // an empty screen is loading again while it retries
  assert.equal(states[0].error, null);
  assert.equal(loader.getSnapshot().goals.calories, 2000);
  assert.equal(loader.getSnapshot().error, null);
});

test('loader: a failed refresh keeps the goals already shown and only records the error', async () => {
  let attempt = 0;
  const loader = createDietGoalsLoader(async () => {
    if (++attempt === 2) throw new Error('Timeout');
    return response();
  });
  await loader.load();
  await loader.load();
  const state = loader.getSnapshot();
  assert.equal(state.goals.calories, 2400);
  assert.equal(state.loading, false); // a reload with goals on screen is not a first load
  assert.equal(state.error, 'Timeout');
});

test('loader: only the newest request applies, and invalidate drops one still on its way', async () => {
  const first = h.deferred();
  let calls = 0;
  const loader = createDietGoalsLoader(() => (++calls === 1 ? first.promise : Promise.resolve(response({ calorie_goal: 2600 }))));
  const stale = loader.load();
  await loader.load();
  first.resolve(response({ calorie_goal: 1111 }));
  await stale;
  assert.equal(loader.getSnapshot().goals.calories, 2600);

  const late = h.deferred();
  const leaving = createDietGoalsLoader(() => late.promise);
  const pending = leaving.load();
  leaving.invalidate(); // blur, unmount or another account
  late.resolve(response());
  await pending;
  assert.equal(leaving.getSnapshot().goals, null);

  const lateFailure = h.deferred();
  const failing = createDietGoalsLoader(() => lateFailure.promise);
  const failed = failing.load();
  failing.invalidate();
  lateFailure.reject(new Error('Too late'));
  await failed;
  assert.equal(failing.getSnapshot().error, null);
});

test('subscribers hear every change and can unsubscribe', async () => {
  const loader = createDietGoalsLoader(async () => response());
  let heard = 0;
  const off = loader.subscribe(() => { heard++; });
  await loader.load();
  assert.equal(heard, 2); // loading, then loaded
  off();
  await loader.load();
  assert.equal(heard, 2);
});

test('the goals API and the goals form are unchanged: GET /nutrition/goals, the same screen and route', () => {
  const api = h.read('src/api/nutrition.ts');
  assert.match(api, /apiRequest<NutritionGoals>\("\/nutrition\/goals"\);/);
  assert.match(api, /"\/nutrition\/goals\/generate", \{ method: "POST" \}/);
  assert.match(api, /"\/nutrition\/goals", \{ method: "PATCH", body: changes \}/);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'app', '(app)', 'profile', 'nutrition-goals.tsx')));
  const form = h.read('app/(app)/profile/nutrition-goals.tsx');
  assert.match(form, /fetchNutritionGoals,\n {2}generateNutritionGoals,\n {2}updateNutritionGoals,/);
  // Profile still links to it, and Diet reads only (no write call).
  assert.match(h.read('app/(app)/(tabs)/profile.tsx'), /router\.push\("\/profile\/nutrition-goals"\)/);
  const diet = h.read('app/(app)/(tabs)/diet.tsx');
  assert.doesNotMatch(diet, /generateNutritionGoals|updateNutritionGoals/);
  assert.match(diet, /router\.push\("\/profile\/nutrition-goals"\)/);
});
