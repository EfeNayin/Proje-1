/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
// Normalise CRLF so the checks do not depend on the working copy's line endings.
const read = (file) => readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

// These are source-level guards, not a navigation run: they pin the decisions
// that make Research's back behaviour work, so a refactor cannot silently drop one.

test('Training opens Research with push, so the tabs stay underneath it in the stack', () => {
  const home = read('app/(app)/(tabs)/index.tsx');
  assert.match(home, /router\.push\("\/research"\)/);
  assert.doesNotMatch(home, /router\.(replace|navigate)\("\/research"\)/);
});

test('app stack is anchored on the tabs, so a deep link to Research still has Training under it', () => {
  const layout = read('app/(app)/_layout.tsx');
  assert.match(layout, /export const unstable_settings = \{\s*anchor: "\(tabs\)",?\s*\};/);
});

test('back control is the native arrow only: no title text, titled "Research", no custom replacement', () => {
  const layout = read('app/(app)/_layout.tsx');
  assert.match(layout, /headerBackButtonDisplayMode: "minimal"/);
  // Extra options are only styling (header colours / font); the title and the
  // absence of a custom back control are what this guards.
  assert.match(layout, /<Stack\.Screen\s+name="research"\s+options=\{\{\s*title: "Research",/);
  assert.doesNotMatch(layout, /headerLeft|headerBackVisible|headerBackTitle/);
  const screen = read('app/(app)/research.tsx');
  assert.doesNotMatch(screen, /headerLeft|router\.back|router\.replace|Stack\.Screen/);
});
