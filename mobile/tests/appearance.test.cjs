/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync, readdirSync, statSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const walk = (dir) =>
  readdirSync(path.join(root, dir)).flatMap((name) => {
    const rel = path.join(dir, name);
    return statSync(path.join(root, rel)).isDirectory() ? walk(rel) : [rel];
  });
const sources = [...walk('app'), ...walk('src')].filter((f) => /\.tsx?$/.test(f));

// The whole app is light, so appearance is decided in three places only: the
// root (status bar), the (app) stack (header + page colour) and the (auth)
// stack (page colour). These guard that decision against a screen quietly
// reintroducing its own; they are not a substitute for looking at the app.

test('status bar: the root layout is the single owner and every screen is dark-on-light', () => {
  const owners = sources.filter((f) => /expo-status-bar|<StatusBar\b|useIsFocused/.test(read(f)));
  assert.deepEqual(owners, ['app/_layout.tsx']);
  const rootLayout = read('app/_layout.tsx');
  assert.equal(rootLayout.match(/<StatusBar\b/g).length, 1);
  assert.match(rootLayout, /<StatusBar style="dark" \/>/);
});

test('stacks: the (app) stack sets the light header and page colour once; routes do not override colours', () => {
  const layout = read('app/(app)/_layout.tsx');
  assert.match(layout, /screenOptions=\{\{\s*\.\.\.lightHeaderOptions,/);
  assert.match(layout, /contentStyle: \{ backgroundColor: light\.background \}/);
  assert.doesNotMatch(layout, /headerStyle|headerTintColor|romanHeader|lightHeader\b|colors\./);
  const auth = read('app/(auth)/_layout.tsx');
  assert.match(auth, /backgroundColor: light\.background/);
  // No screen sets its own header colours inside the component; the title of the
  // template screen is the one legitimate per-screen header option.
  for (const file of sources.filter((f) => f.startsWith('app/(app)/') && !f.endsWith('_layout.tsx'))) {
    assert.doesNotMatch(read(file), /lightHeaderOptions/, file);
  }
});

test('no application screen or component uses the dark or Roman palettes any more', () => {
  const allowed = new Set(['src/theme.ts', 'src/romanTheme.ts', 'src/lightTheme.ts']);
  for (const file of sources.filter((f) => !allowed.has(f))) {
    const source = read(file);
    assert.doesNotMatch(source, /romanTheme|romanFont|useRomanFonts/, file);
    // `spacing`/`radius` layout tokens may still come from theme.ts; its colours may not.
    for (const [, names] of source.matchAll(/import \{([^}]*)\} from "[./]*(?:src\/)?theme";/g)) {
      assert.doesNotMatch(names, /\b(colors|statusColors|findingSeverityColors|statusLabels)\b/, file);
    }
  }
});

test('app is light-only: system dialogs and keyboards follow the app, not the device appearance', () => {
  assert.equal(JSON.parse(readFileSync(path.join(root, 'app.json'), 'utf8')).expo.userInterfaceStyle, 'light');
});

test('the app shell screens (restoring session, cannot connect) are light too', () => {
  const rootLayout = read('app/_layout.tsx');
  assert.match(rootLayout, /backgroundColor: light\.background/);
  assert.doesNotMatch(rootLayout, /colors\./);
});

test('diagnosis and check-in keep their states distinct and use no palette but the light one', () => {
  const diagnosis = read('app/(app)/diagnosis.tsx');
  assert.match(diagnosis, /Not enough training records for this period/);
  assert.match(diagnosis, /Nothing stands out/);
  assert.match(diagnosis, /Showing the previous result for this period\./);
  assert.match(diagnosis, /lightStatus/);
  const checkin = read('app/(app)/workout/checkin.tsx');
  assert.match(checkin, /Could not start the workout\. Try again\./);
  assert.match(checkin, /Continue to workout/);
  for (const source of [diagnosis, checkin]) assert.doesNotMatch(source, /src\/theme"/);
});
