const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'app', '(app)', '(tabs)', '_layout.tsx'),
  'utf8',
);

// The four tabs share one light appearance. It lives in screenOptions only:
// a per-tab override would let one tab fall back to a different bar (the
// navigator applies the focused tab's options), which is what the redesign
// of Training, Programs, Volume and Profile consolidated away.
test('tab layout: the bar appearance is defined once for all four tabs', () => {
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

test('tab layout: Training, Programs, Volume and Profile are the tabs, all light', () => {
  const names = [...source.matchAll(/<Tabs\.Screen\s+name="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(names, ['index', 'programs', 'volume', 'profile']);
  assert.doesNotMatch(source, /romanTheme|\.\.\/theme"/);
  assert.match(source, /lightTheme/);
});
