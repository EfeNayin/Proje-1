const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'app', '(app)', '(tabs)', '_layout.tsx'),
  'utf8',
);

// The five visible tabs share one light appearance. It lives in screenOptions only:
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

test('tab layout: Volume, History, Start Workout, Exercises and Diet are the tabs, all light; Profile is a hidden route', () => {
  const screens = [...source.matchAll(/<Tabs\.Screen\s+name="([^"]+)"\s+options=\{\{([\s\S]*?)\}\}\s*\/>/g)];
  const names = screens.map((match) => match[1]);
  // Declared order is the visual order; the Profile and old Programs routes follow as hidden ones.
  assert.deepEqual(names, ['volume', 'history', 'index', 'exercises', 'diet', 'profile', 'programs']);

  const titles = Object.fromEntries(screens.map((match) => [match[1], /title: "([^"]+)"/.exec(match[2])?.[1]]));
  assert.deepEqual(
    ['volume', 'history', 'index', 'exercises', 'diet'].map((name) => titles[name]),
    ['Volume', 'History', 'Start Workout', 'Exercises', 'Diet'],
  );
  assert.doesNotMatch(source, /title: "(Training|Programs)"/);
  assert.doesNotMatch(source, /romanTheme|\.\.\/theme"/);
  assert.match(source, /lightTheme/);
});

test('tab layout: Profile stays a registered route but is not a tab, and is never redirected to Diet', () => {
  assert.match(source, /<Tabs\.Screen name="profile" options=\{\{ href: null \}\} \/>/);
  assert.doesNotMatch(source, /name="profile"[\s\S]{0,80}tabBarIcon/);
  assert.doesNotMatch(source, /Redirect/);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'app', '(app)', '(tabs)', 'profile.tsx')));
  const diet = fs.readFileSync(path.join(__dirname, '..', 'app', '(app)', '(tabs)', 'diet.tsx'), 'utf8');
  assert.match(diet, /<TabTopBar title="Diet" \/>/);
  assert.doesNotMatch(diet, /Redirect|router|fetch|api\//);
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

test('tab layout: labels keep one size; "Start Workout" is one line in the stock-height bar, only that tab is widened', () => {
  const [, screenOptions] = /screenOptions=\{\{([\s\S]*?)\n {6}\}\}/.exec(source) ?? [];
  assert.match(screenOptions, /tabBarAllowFontScaling: false/);
  assert.match(screenOptions, /tabBarLabelStyle: \{ fontSize: 10 \}/);
  // A one-line label needs no taller bar: the library's own height and safe-area handling stay.
  assert.doesNotMatch(screenOptions, /height:/);
  assert.doesNotMatch(source, /useSafeAreaInsets/);

  const [, middle] = /name="index"\s+options=\{\{([\s\S]*?)\}\}\s*\/>/.exec(source) ?? [];
  assert.ok(middle, 'index tab not found');
  assert.match(middle, /tabBarLabel: \(\{ color \}\) => <StartWorkoutTabLabel color=\{color\} \/>/);
  assert.match(middle, /tabBarItemStyle: \{ flex: [\d.]+ \}/);
  // The spoken name stays the whole phrase.
  assert.match(middle, /tabBarAccessibilityLabel: "Start Workout"/);
  assert.match(middle, /title: "Start Workout"/);
  // The other four tabs keep the default item style.
  assert.equal(source.split('tabBarItemStyle:').length - 1, 1, 'only the middle tab sets tabBarItemStyle');
});

test('tab layout: the Start Workout label is the exact text on one line, never wrapped or cut', () => {
  const label = fs.readFileSync(path.join(__dirname, '..', 'src', 'workout', 'StartWorkoutTabLabel.tsx'), 'utf8');
  assert.match(label, />\s*Start Workout\s*<\/Text>/);
  assert.doesNotMatch(label, /<br|\\n/);
  assert.equal(label.split('<Text').length - 1, 1);
  assert.match(label, /numberOfLines=\{1\}/);
  assert.match(label, /adjustsFontSizeToFit/);
  assert.match(label, /allowFontScaling=\{false\}/);
  assert.match(label, /fontSize: 10,/);
});
