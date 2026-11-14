const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'app', '(app)', '(tabs)', '_layout.tsx'),
  'utf8',
);

// The five tabs share one light appearance. It lives in screenOptions only:
// a per-tab override would let one tab fall back to a different bar (the
// navigator applies the focused tab's options), which is what the redesign
// of the tabs consolidated away.
test('tab layout: the bar appearance is defined once for all five tabs', () => {
  const [, screenOptions] = /screenOptions=\{\{([\s\S]*?)\n {6}\}\}/.exec(source) ?? [];
  assert.ok(screenOptions, 'screenOptions block not found');
  for (const key of ['sceneStyle', 'tabBarStyle', 'tabBarActiveTintColor', 'tabBarInactiveTintColor']) {
    assert.match(screenOptions, new RegExp(`${key}:`), `${key} missing from screenOptions`);
  }
  assert.match(screenOptions, /headerShown: false/);

  for (const key of ['sceneStyle', 'tabBarStyle', 'tabBarActiveTintColor', 'tabBarInactiveTintColor']) {
    const occurrences = source.split(`${key}:`).length - 1;
    assert.equal(occurrences, 1, `${key} is overridden per tab`);
  }
});

test('tab layout: Profile, History, Start Workout, Exercises and Volume are the tabs, all light', () => {
  const screens = [...source.matchAll(/<Tabs\.Screen\s+name="([^"]+)"\s+options=\{\{([\s\S]*?)\}\}\s*\/>/g)];
  const names = screens.map((match) => match[1]);
  // Declared order is the visual order; the old Programs route follows as a hidden one.
  assert.deepEqual(names, ['profile', 'history', 'index', 'exercises', 'volume', 'programs']);

  const titles = Object.fromEntries(screens.map((match) => [match[1], /title: "([^"]+)"/.exec(match[2])?.[1]]));
  assert.deepEqual(
    ['profile', 'history', 'index', 'exercises', 'volume'].map((name) => titles[name]),
    ['Profile', 'History', 'Start Workout', 'Exercises', 'Volume'],
  );
  assert.doesNotMatch(source, /title: "(Training|Programs)"/);
  assert.doesNotMatch(source, /romanTheme|\.\.\/theme"/);
  assert.match(source, /lightTheme/);
});

test('tab layout: Programs has no button in the bar, and the middle tab is where the app opens', () => {
  const programs = /<Tabs\.Screen name="programs" options=\{\{ href: null \}\} \/>/.exec(source);
  assert.ok(programs, 'programs must be a hidden route, not a tab');
  assert.doesNotMatch(source, /name="programs"[\s\S]{0,80}tabBarIcon/);
  // Start Workout is the third of five visible tabs and is named as the anchor explicitly,
  // because a tab navigator would otherwise start on the first tab it lists (Profile).
  assert.match(source, /export const unstable_settings = \{\s*anchor: "index",?\s*\};/);
  const visible = [...source.matchAll(/<Tabs\.Screen\s+name="([^"]+)"\s+options=\{\{\s*title:/g)].map((match) => match[1]);
  assert.equal(visible.length, 5);
  assert.equal(visible[2], 'index');
});

test('tab layout: labels keep one size so the longest ("Start Workout") fits five tabs on a small iPhone', () => {
  const [, screenOptions] = /screenOptions=\{\{([\s\S]*?)\n {6}\}\}/.exec(source) ?? [];
  assert.match(screenOptions, /tabBarAllowFontScaling: false/);
  assert.match(screenOptions, /tabBarLabelStyle: \{ fontSize: 10 \}/);
});
