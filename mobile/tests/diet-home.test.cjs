/* global __dirname */
// The Diet home: the week strip (real days in the user's timezone), the daily-goal cards, and the
// honest recent-meals empty state. The real screen file is driven with stand-ins for the router, the
// API and the native components (tests/support/screen-harness.cjs): state, effects and handlers as
// written, not native layout. Goal loading rules themselves are in tests/nutrition-goals.test.cjs.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTs } = require('./support/load-ts.cjs');
const h = require('./support/screen-harness.cjs');

const week = loadTs('src/nutrition/dietWeek.ts');
const dietGoals = loadTs('src/nutrition/dietGoals.ts');
const { light, lightMacro } = loadTs('src/lightTheme.ts');

// ------------------------------------------------------------------ calendar arithmetic

test('week: Monday to Sunday around today, with real day numbers', () => {
  const days = week.weekContaining('2026-11-25'); // a Wednesday
  assert.deepEqual(h.plain(days.map((d) => d.date)), [
    '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29',
  ]);
  assert.deepEqual(h.plain(days.map((d) => d.weekday)), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  assert.deepEqual(h.plain(days.map((d) => d.dayOfMonth)), [23, 24, 25, 26, 27, 28, 29]);
  assert.deepEqual(h.plain(days.map((d) => d.isToday)), [false, false, true, false, false, false, false]);
  assert.deepEqual(h.plain(days.map((d) => d.isFuture)), [false, false, false, true, true, true, true]);
  assert.equal(days[0].longLabel, 'Monday, November 23, 2026');
});

test('week: a Monday and a Sunday today give the same Monday-start week', () => {
  assert.equal(week.weekContaining('2026-11-23')[0].date, '2026-11-23');
  assert.equal(week.weekContaining('2026-11-29')[0].date, '2026-11-23');
  assert.equal(week.weekContaining('2026-11-29')[6].date, '2026-11-29');
});

test('week: month, year and leap-day boundaries are real calendar arithmetic', () => {
  assert.deepEqual(h.plain(week.weekContaining('2026-12-31').map((d) => d.date)), [
    '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03',
  ]);
  assert.deepEqual(h.plain(week.weekContaining('2028-02-27').map((d) => d.date)), [
    '2028-02-21', '2028-02-22', '2028-02-23', '2028-02-24', '2028-02-25', '2028-02-26', '2028-02-27',
  ]);
  assert.equal(week.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(week.addDays('2027-02-28', 1), '2027-03-01');
  assert.equal(week.addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(week.addDays('2026-03-29', 1), '2026-03-30');
});

test('week: a daylight-saving change never skips or repeats a date', () => {
  // European spring-forward (2026-03-29) and fall-back (2026-10-25) weeks, and the US ones.
  for (const today of ['2026-03-29', '2026-10-25', '2026-03-08', '2026-11-01']) {
    const dates = week.weekContaining(today).map((d) => d.date);
    assert.equal(new Set(dates).size, 7);
    dates.slice(1).forEach((date, i) => assert.equal(week.addDays(dates[i], 1), date));
    assert.ok(dates.includes(today));
  }
});

test("today is decided in the user's timezone, not the device's or UTC", () => {
  // Monday 01:00 in Istanbul (UTC+3) is still Sunday 22:00 in UTC.
  const instant = new Date('2026-11-22T22:00:00Z');
  assert.equal(week.calendarDateIn(instant, 'Europe/Istanbul'), '2026-11-23');
  assert.equal(week.calendarDateIn(instant, 'UTC'), '2026-11-22');
  assert.equal(week.calendarDateIn(instant, 'America/Los_Angeles'), '2026-11-22');
  // Across the year boundary and a zone ahead of UTC.
  assert.equal(week.calendarDateIn(new Date('2026-12-31T20:00:00Z'), 'Pacific/Auckland'), '2027-01-01');
  // Around a DST change the local date still follows the zone.
  assert.equal(week.calendarDateIn(new Date('2026-03-29T00:30:00Z'), 'Europe/Istanbul'), '2026-03-29');
  assert.equal(week.calendarDateIn(new Date('2026-03-28T23:30:00Z'), 'Europe/Berlin'), '2026-03-29');
});

test('an unknown timezone falls back to the device calendar day instead of throwing', () => {
  const instant = new Date('2026-11-23T12:00:00');
  assert.equal(week.calendarDateIn(instant, 'Not/AZone'), '2026-11-23');
  assert.equal(week.calendarDateIn(instant, null), '2026-11-23');
  assert.equal(week.calendarDateIn(instant), '2026-11-23');
});

test('meal context names the day without claiming records exist', () => {
  assert.equal(week.formatMealContext('2026-11-23', '2026-11-23'), 'Today · Mon, Nov 23');
  assert.equal(week.formatMealContext('2026-11-22', '2026-11-23'), 'Yesterday · Sun, Nov 22');
  assert.equal(week.formatMealContext('2026-11-24', '2026-11-23'), 'Tomorrow · Tue, Nov 24');
  assert.equal(week.formatMealContext('2026-11-26', '2026-11-23'), 'Thu, Nov 26');
  assert.equal(week.formatMealContext('2027-01-01', '2026-12-31'), 'Tomorrow · Fri, Jan 1, 2027');
});

// ------------------------------------------------------------------------ the screen

function dietWorld({ user = { id: 'u1', timezone: 'Europe/Istanbul' }, now = '2026-11-23T10:00:00Z',
  fetchGoals = async () => ({ calorie_goal: 2400, protein_goal_g: 180, carb_goal_g: 260, fat_goal_g: 70 }),
  fontScale = 1 } = {}) {
  const hooks = h.createHooks();
  const pushes = [];
  const state = { user, fetches: 0, fetchGoals, fontScale };
  // Fake timers and AppState: the clock only moves when a test says so.
  const timers = new Map();
  let nextTimer = 1;
  const appState = { listeners: new Set(), removed: 0 };
  const RealDate = Date;
  const clock = { now: new RealDate(now) };
  class FakeDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [clock.now.getTime()])); }
    static now() { return clock.now.getTime(); }
  }
  const screen = h.loadFile('app/(app)/(tabs)/diet.tsx', {
    globals: {
      React: { createElement: h.createElement }, Date: FakeDate, Intl,
      setTimeout: (fn, delay) => { const id = nextTimer++; timers.set(id, { fn, due: clock.now.getTime() + delay }); return id; },
      clearTimeout: (id) => { timers.delete(id); },
    },
    modules: {
      '@expo/vector-icons': { Ionicons: 'Ionicons' },
      'expo-router': { useFocusEffect: hooks.hooks.useFocusEffect, useRouter: () => ({ push: (href) => pushes.push(href) }) },
      react: hooks.hooks,
      'react-native': h.reactNative({
        useWindowDimensions: () => ({ fontScale: state.fontScale }),
        AppState: {
          addEventListener: (event, listener) => {
            assert.equal(event, 'change');
            appState.listeners.add(listener);
            return { remove: () => { appState.listeners.delete(listener); appState.removed++; } };
          },
        },
      }),
      '../../../src/api/nutrition': { fetchNutritionGoals: () => { state.fetches++; return state.fetchGoals(); } },
      '../../../src/auth/AuthContext': { useAuth: () => ({ user: state.user }) },
      '../../../src/lightTheme': { light, lightMacro },
      '../../../src/navigation/TabTopBar': { TabTopBar: 'TabTopBar' },
      '../../../src/nutrition/dietGoals': dietGoals,
      '../../../src/nutrition/dietWeek': week,
    },
  }).default;
  const world = {
    hooks, pushes, state, clock, timers, appState,
    /** Moves the clock to `to` and fires every timer that has come due, in order (each may schedule the next). */
    advanceTo(to) {
      const target = new RealDate(to).getTime();
      for (;;) {
        const due = [...timers].filter(([, t]) => t.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
        if (!due) break;
        timers.delete(due[0]);
        clock.now = new RealDate(due[1].due);
        due[1].fn();
      }
      clock.now = new RealDate(target);
    },
    foreground: () => [...appState.listeners].forEach((listener) => listener('active')),
    background: () => [...appState.listeners].forEach((listener) => listener('background')),
    render: () => h.expand(hooks.render(screen)),
    async show() { world.render(); hooks.focus(); await h.settle(); return world.render(); },
    days: (tree) => h.nodes(tree).filter((n) => n.type === 'Pressable' && /^\w+day, \w+ \d+, \d{4}/.test(n.props.accessibilityLabel ?? '')),
    mealContext: (tree) => h.nodes(tree).find((n) => n.props?.testID === 'meal-context').props.children.join(''),
    action: (tree) => h.nodes(tree).find((n) => n.type === 'Pressable' && /^(Edit|Set) goals$/.test(n.props.accessibilityLabel ?? '')),
  };
  return world;
}

test('Diet shows seven real days with today selected first, and pressing a day selects it and moves the meal context', async () => {
  const world = dietWorld();
  let tree = await world.show();
  assert.equal(h.nodes(tree).find((n) => n.type === 'TabTopBar').props.title, 'Diet');
  let days = world.days(tree);
  assert.equal(days.length, 7);
  assert.deepEqual(days.map((d) => d.props.accessibilityLabel.split(',')[0]),
    ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
  assert.ok(days[0].props.accessibilityLabel.endsWith('today')); // 23 Nov 2026 is a Monday
  assert.deepEqual(days.map((d) => d.props.accessibilityState.selected), [true, false, false, false, false, false, false]);
  assert.equal(world.mealContext(tree), 'Today · Mon, Nov 23');

  days[3].props.onPress();
  tree = world.render();
  days = world.days(tree);
  assert.deepEqual(days.map((d) => d.props.accessibilityState.selected), [false, false, false, true, false, false, false]);
  assert.equal(world.mealContext(tree), 'Thu, Nov 26');
  // The selected day is drawn in the capsule style, the others are not.
  assert.ok(days[3].props.style({ pressed: false }).some(Boolean));
  assert.notDeepEqual(h.plain(days[3].props.style({ pressed: false })), h.plain(days[1].props.style({ pressed: false })));
  // Picking a day does not reload or change the goals.
  assert.equal(world.state.fetches, 1);
});

test('"today" follows the signed-in user timezone, and a new week after midnight drops an old pick', async () => {
  // 22:30 UTC on Sunday is already Monday in Istanbul.
  const istanbul = dietWorld({ now: '2026-11-22T22:30:00Z' });
  let tree = await istanbul.show();
  assert.equal(istanbul.mealContext(tree), 'Today · Mon, Nov 23');
  assert.equal(istanbul.days(tree)[0].props.accessibilityState.selected, true);

  const utc = dietWorld({ user: { id: 'u2', timezone: 'UTC' }, now: '2026-11-22T22:30:00Z' });
  tree = await utc.show();
  assert.equal(utc.mealContext(tree), 'Today · Sun, Nov 22');
  assert.equal(utc.days(tree)[6].props.accessibilityState.selected, true);

  // The app stays open past Sunday: back on focus, a pick from the finished week is dropped.
  const world = dietWorld({ now: '2026-11-29T12:00:00Z' });
  tree = await world.show();
  world.days(tree)[1].props.onPress(); // Tuesday 24 Nov
  assert.equal(world.mealContext(world.render()), 'Tue, Nov 24');
  world.hooks.blur();
  world.clock.now = new Date('2026-11-30T12:00:00Z');
  world.hooks.focus();
  tree = world.render();
  assert.equal(world.mealContext(tree), 'Today · Mon, Nov 30');
  assert.equal(world.days(tree)[0].props.accessibilityState.selected, true);
});

test('the daily goals are the saved numbers, labelled as goals, with no consumed/left/streak claims', async () => {
  const world = dietWorld();
  const tree = await world.show();
  const texts = h.texts(tree);
  assert.ok(texts.includes('2400'));
  assert.ok(texts.includes('180') && texts.includes('260') && texts.includes('70'));
  assert.ok(texts.includes('Daily calorie goal'));
  assert.deepEqual(texts.filter((t) => t === 'daily goal').length, 3);
  const spoken = h.nodes(tree).map((n) => n.props?.accessibilityLabel).filter(Boolean);
  assert.ok(spoken.includes('Daily calorie goal: 2400 kilocalories'));
  assert.ok(spoken.includes('Protein daily goal: 180 grams'));
  assert.ok(spoken.includes('Carbs daily goal: 260 grams'));
  assert.ok(spoken.includes('Fat daily goal: 70 grams'));
  const all = [...texts, ...spoken].join(' | ');
  assert.doesNotMatch(all, /\b(left|remaining|consumed|eaten|streak|burned|completed)\b/i);
  // The same current goals whichever day is selected; the caption says so.
  assert.match(all, /current daily targets, the same for every day/i);
});

test('missing goals are em dashes, never zeros, and the action invites setting them', async () => {
  const world = dietWorld({ fetchGoals: async () => ({ calorie_goal: null, protein_goal_g: 150, carb_goal_g: null, fat_goal_g: null }) });
  let tree = await world.show();
  const texts = h.texts(tree);
  assert.equal(texts.filter((t) => t === '—').length, 3);
  assert.ok(!texts.includes('0'));
  assert.ok(texts.includes('150'));
  assert.equal(world.action(tree).props.accessibilityLabel, 'Edit goals');

  const none = dietWorld({ fetchGoals: async () => ({ calorie_goal: null, protein_goal_g: null, carb_goal_g: null, fat_goal_g: null }) });
  tree = await none.show();
  assert.equal(h.texts(tree).filter((t) => t === '—').length, 4);
  assert.equal(none.action(tree).props.accessibilityLabel, 'Set goals');
  assert.ok(h.texts(tree).includes('No daily goals saved yet.'));
});

test('loading keeps the dashboard layout; a failure shows a real retry, not "no goals"', async () => {
  const slow = h.deferred();
  const world = dietWorld({ fetchGoals: () => slow.promise });
  let tree = await world.show();
  assert.ok(h.texts(tree).includes('Loading your goals…'));
  assert.equal(h.texts(tree).filter((t) => t === '—').length, 4); // the cards are all there
  assert.ok(h.texts(tree).includes('Recent meals'));
  assert.ok(h.nodes(tree).some((n) => n.props?.accessibilityLabel === 'Protein daily goal: loading'));
  assert.equal(world.action(tree).props.accessibilityLabel, 'Edit goals');

  slow.reject(new Error('Offline'));
  tree = await (async () => { await h.settle(); return world.render(); })();
  assert.ok(h.texts(tree).join(' ').includes('Could not load your goals. Offline'));
  assert.ok(!h.texts(tree).includes('No daily goals saved yet.'));
  assert.ok(h.nodes(tree).some((n) => n.props?.accessibilityLabel === 'Protein daily goal: unavailable'));
  assert.ok(h.texts(tree).includes('Recent meals'));

  // Retry loads again and recovers.
  world.state.fetchGoals = async () => ({ calorie_goal: 2000, protein_goal_g: 150, carb_goal_g: 200, fat_goal_g: 60 });
  h.byLabel(tree, 'Try loading goals again').props.onPress();
  await h.settle();
  tree = world.render();
  assert.ok(h.texts(tree).includes('2000'));
  assert.ok(!h.texts(tree).join(' ').includes('Could not load'));
  assert.equal(world.state.fetches, 2);
});

test('returning to Diet re-reads the goals, so an edit made on the goals screen shows up', async () => {
  const world = dietWorld();
  let tree = await world.show();
  assert.ok(h.texts(tree).includes('2400'));
  world.state.fetchGoals = async () => ({ calorie_goal: 2600, protein_goal_g: 190, carb_goal_g: 300, fat_goal_g: 75 });
  world.hooks.blur();
  world.hooks.focus();
  await h.settle();
  tree = world.render();
  assert.ok(h.texts(tree).includes('2600'));
  assert.ok(!h.texts(tree).includes('2400'));
  assert.equal(world.state.fetches, 2);
});

test('leaving the screen drops an answer still on its way; another account gets its own goals', async () => {
  const late = h.deferred();
  const world = dietWorld({ fetchGoals: () => late.promise });
  world.render();
  world.hooks.focus();
  world.hooks.blur(); // the user left before the answer arrived
  late.resolve({ calorie_goal: 1111, protein_goal_g: 1, carb_goal_g: 1, fat_goal_g: 1 });
  await h.settle();
  assert.ok(!h.texts(world.render()).includes('1111'));

  const account = dietWorld();
  let tree = await account.show();
  assert.ok(h.texts(tree).includes('2400'));
  account.state.user = { id: 'u-other', timezone: 'UTC' };
  account.state.fetchGoals = async () => ({ calorie_goal: null, protein_goal_g: null, carb_goal_g: null, fat_goal_g: null });
  tree = account.render(); // a different account: the previous account's numbers are not shown
  assert.ok(!h.texts(tree).includes('2400'));
});

test('staying focused across midnight advances today by itself, in the account timezone', async () => {
  // 23:59:30 Sunday in Istanbul (20:59:30 UTC): Diet is open and never loses focus.
  const world = dietWorld({ now: '2026-11-22T20:59:30Z' });
  let tree = await world.show();
  assert.equal(world.mealContext(tree), 'Today · Sun, Nov 22');
  assert.equal(world.days(tree)[6].props.accessibilityState.selected, true);
  assert.equal(world.timers.size, 1);

  // Still the same Istanbul day a minute later than UTC midnight would suggest: nothing changes.
  world.advanceTo('2026-11-22T20:59:59Z');
  assert.equal(world.mealContext(world.render()), 'Today · Sun, Nov 22');

  // The minute boundary after local midnight: today moves to Monday, in a brand-new week.
  world.advanceTo('2026-11-22T21:01:00Z');
  tree = world.render();
  assert.equal(world.mealContext(tree), 'Today · Mon, Nov 23');
  assert.equal(world.days(tree)[0].props.accessibilityState.selected, true);
  assert.ok(world.days(tree)[0].props.accessibilityLabel.endsWith('today'));
  assert.equal(world.days(tree)[0].props.accessibilityLabel.split(',').slice(0, 2).join(','), 'Monday, November 23');
  assert.equal(world.timers.size, 1); // the next minute's check is already scheduled
  // The goals were not reloaded by the clock check.
  assert.equal(world.state.fetches, 1);

  // The UTC midnight (which is NOT local midnight for this account) never moved the day earlier.
  const utcMidnight = dietWorld({ now: '2026-11-22T20:59:30Z', user: { id: 'u3', timezone: 'Europe/Istanbul' } });
  await utcMidnight.show();
  utcMidnight.advanceTo('2026-11-22T21:00:20Z');
  assert.equal(utcMidnight.mealContext(utcMidnight.render()), 'Today · Mon, Nov 23');
});

test('a deliberately picked day survives the clock check; a pick outside the new week falls back to today', async () => {
  const world = dietWorld({ now: '2026-11-25T12:00:00Z' }); // Wednesday
  let tree = await world.show();
  world.days(tree)[4].props.onPress(); // Friday 27
  world.advanceTo('2026-11-25T12:05:00Z'); // minutes pass, same day
  assert.equal(world.mealContext(world.render()), 'Fri, Nov 27');
  world.advanceTo('2026-11-26T09:00:00Z'); // the next day, same week
  tree = world.render();
  assert.equal(world.mealContext(tree), 'Tomorrow · Fri, Nov 27'); // the pick is kept ...
  assert.ok(world.days(tree)[3].props.accessibilityLabel.endsWith('today')); // ... while today moved to Thursday

  // Across the weekend: the picked Friday belongs to the finished week, so today is selected.
  world.advanceTo('2026-11-30T09:00:00Z');
  tree = world.render();
  assert.equal(world.mealContext(tree), 'Today · Mon, Nov 30');
  assert.equal(world.days(tree)[0].props.accessibilityState.selected, true);
});

test('returning from the background re-reads the day at once, even before the next minute check', async () => {
  const world = dietWorld({ now: '2026-11-22T12:00:00Z' }); // Sunday
  let tree = await world.show();
  assert.equal(world.mealContext(tree), 'Today · Sun, Nov 22');
  assert.equal(world.appState.listeners.size, 1);

  world.background(); // going to the background does nothing
  assert.equal(world.mealContext(world.render()), 'Today · Sun, Nov 22');

  // The phone slept for two days: timers did not fire, the clock jumped.
  world.clock.now = new Date('2026-11-24T08:00:00Z');
  world.foreground();
  tree = world.render();
  assert.equal(world.mealContext(tree), 'Today · Tue, Nov 24');
  assert.equal(world.days(tree)[1].props.accessibilityState.selected, true);
  assert.equal(world.state.fetches, 1);

  // Resuming on the same day with a picked date changes nothing.
  world.days(tree)[4].props.onPress();
  world.foreground();
  assert.equal(world.mealContext(world.render()), 'Fri, Nov 27');
});

test('the clock timer and AppState listener are removed on blur and on unmount, and refocus starts one of each', async () => {
  const world = dietWorld();
  await world.show();
  assert.equal(world.timers.size, 1);
  assert.equal(world.appState.listeners.size, 1);

  world.hooks.blur();
  assert.equal(world.timers.size, 0);
  assert.equal(world.appState.listeners.size, 0);
  assert.equal(world.appState.removed, 1);
  // An event or timer arriving after blur has nothing left to run.
  world.foreground();
  world.advanceTo('2026-11-24T12:00:00Z');
  assert.equal(world.mealContext(world.render()), 'Today · Mon, Nov 23');

  world.hooks.focus();
  assert.equal(world.timers.size, 1);
  assert.equal(world.appState.listeners.size, 1);
  await h.settle();
  assert.equal(world.mealContext(world.render()), 'Today · Tue, Nov 24'); // refocus re-read the day

  world.hooks.unmount();
  assert.equal(world.timers.size, 0);
  assert.equal(world.appState.listeners.size, 0);
});

test('the week strip is a plain group of date buttons, not a tablist', async () => {
  const world = dietWorld();
  const tree = await world.show();
  assert.ok(!h.nodes(tree).some((n) => n.props?.accessibilityRole === 'tablist' || n.props?.role === 'tablist'));
  const days = world.days(tree);
  assert.equal(days.length, 7);
  days.forEach((day) => {
    assert.equal(day.props.accessibilityRole, 'button');
    assert.match(day.props.accessibilityLabel, /^\w+day, \w+ \d+, \d{4}/);
    assert.equal(typeof day.props.accessibilityState.selected, 'boolean');
  });
});

test('Edit goals / Set goals opens the existing nutrition goals form, once', async () => {
  const world = dietWorld();
  const tree = await world.show();
  const action = world.action(tree);
  action.props.onPress();
  action.props.onPress(); // a double tap must not stack two copies
  assert.deepEqual(h.plain(world.pushes), ['/profile/nutrition-goals']);
  const fs = require('node:fs');
  const path = require('node:path');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'app', '(app)', 'profile', 'nutrition-goals.tsx')));
});

test('recent meals is an honest empty state: no fake rows, add buttons, streaks or dots', async () => {
  const world = dietWorld();
  const tree = await world.show();
  const texts = h.texts(tree);
  assert.ok(texts.includes('Recent meals'));
  assert.ok(texts.includes('Meal logging is coming soon.'));
  // The only buttons are the seven days, Edit goals (and Try again when loading fails).
  const buttons = h.nodes(tree).filter((n) => n.type === 'Pressable');
  assert.equal(buttons.length, 8);
  assert.ok(h.nodes(tree).some((n) => n.type === 'Ionicons' && n.props.name === 'restaurant-outline'));
  assert.ok(!h.nodes(tree).some((n) => n.type === 'Ionicons' && /^add/.test(n.props.name)));
});

test('large text: the macro cards stack instead of being squeezed, and nothing is a fixed-height clip', async () => {
  const normal = dietWorld({ fontScale: 1 });
  const big = dietWorld({ fontScale: 2 });
  const rowStyle = (world, tree) => {
    const row = h.nodes(tree).find((n) => Array.isArray(n.props?.style) && n.children === undefined
      && h.nodes(n).filter((c) => c.props?.accessibilityLabel?.includes('daily goal:') && !c.props.accessibilityLabel.startsWith('Daily')).length === 3);
    return h.plain(row.props.style.filter(Boolean));
  };
  const normalStyles = rowStyle(normal, await normal.show());
  const bigStyles = rowStyle(big, await big.show());
  assert.equal(normalStyles.length, 1);
  assert.equal(bigStyles.length, 2);
  assert.equal(bigStyles[1].flexDirection, 'column');
  assert.equal(normalStyles[0].flexDirection, 'row');
});

// ------------------------------------------------------------------ source-level guards

test('Diet uses the light tokens and the existing icon library only, with no new dependency or backend', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = h.read('app/(app)/(tabs)/diet.tsx');
  assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(source, /romanTheme|\.\.\/theme"|useColorScheme|Cal AI/i);
  assert.match(source, /from "@expo\/vector-icons"/);
  assert.doesNotMatch(source, /fatsecret|camera|barcode|barkod/i);
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(!Object.keys(pkg.dependencies).some((name) => /fatsecret|camera|barcode|svg/i.test(name)));
  // The macro icon colours are theme tokens with a written-down contrast reason.
  assert.deepEqual(Object.keys(lightMacro), ['protein', 'carbs', 'fat']);
});
