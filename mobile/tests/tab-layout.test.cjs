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

test('tab layout: Volume, History, Start Workout, Exercises and Profile are the tabs, all light', () => {
  const screens = [...source.matchAll(/<Tabs\.Screen\s+name="([^"]+)"\s+options=\{\{([\s\S]*?)\}\}\s*\/>/g)];
  const names = screens.map((match) => match[1]);
  // Declared order is the visual order; the old Programs route follows as a hidden one.
  assert.deepEqual(names, ['volume', 'history', 'index', 'exercises', 'profile', 'programs']);

  const titles = Object.fromEntries(screens.map((match) => [match[1], /title: "([^"]+)"/.exec(match[2])?.[1]]));
  assert.deepEqual(
    ['volume', 'history', 'index', 'exercises', 'profile'].map((name) => titles[name]),
    ['Volume', 'History', 'Start Workout', 'Exercises', 'Profile'],
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
  // because a tab navigator would otherwise start on the first tab it lists (Volume).
  assert.match(source, /export const unstable_settings = \{\s*anchor: "index",?\s*\};/);
  const visible = [...source.matchAll(/<Tabs\.Screen\s+name="([^"]+)"\s+options=\{\{\s*title:/g)].map((match) => match[1]);
  assert.equal(visible.length, 5);
  assert.equal(visible[2], 'index');
});

test('tab layout: labels keep one size; "Start Workout" is two lines in a taller bar, never shrunk or truncated', () => {
  const [, screenOptions] = /screenOptions=\{\{([\s\S]*?)\n {6}\}\}/.exec(source) ?? [];
  assert.match(screenOptions, /tabBarAllowFontScaling: false/);
  assert.match(screenOptions, /tabBarLabelStyle: \{ fontSize: 10 \}/);
  // The bar is taller than the stock 49 pt, with the safe-area inset added on top of it.
  assert.match(screenOptions, /height: TAB_BAR_CONTENT_HEIGHT \+ bottom/);

  const [, middle] = /name="index"\s+options=\{\{([\s\S]*?)\}\}\s*\/>/.exec(source) ?? [];
  assert.ok(middle, 'index tab not found');
  assert.match(middle, /tabBarLabel: \(\{ color \}\) => <StartWorkoutTabLabel color=\{color\} \/>/);
  // The spoken name stays the whole phrase.
  assert.match(middle, /tabBarAccessibilityLabel: "Start Workout"/);
  assert.match(middle, /title: "Start Workout"/);
});

test('tab layout: the Start Workout label is "Start" over "Workout" at font size 10, one line each', () => {
  const label = fs.readFileSync(path.join(__dirname, '..', 'src', 'workout', 'StartWorkoutTabLabel.tsx'), 'utf8');
  assert.match(label, />\s*Start\s*<\/Text>/);
  assert.match(label, />\s*Workout\s*<\/Text>/);
  assert.equal(label.split('numberOfLines={1}').length - 1, 2);
  assert.equal(label.split('allowFontScaling={false}').length - 1, 2);
  assert.match(label, /fontSize: 10,/);
  // 49 pt is the stock bar (icon + one line); two lines need more.
  const height = Number(/TAB_BAR_CONTENT_HEIGHT = (\d+)/.exec(label)?.[1]);
  assert.ok(height >= 60, `bar content height ${height} is too small for icon + two label lines`);
});
