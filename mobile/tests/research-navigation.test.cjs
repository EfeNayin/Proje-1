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

test('back control is the native arrow only: no title text, no custom replacement', () => {
  const layout = read('app/(app)/_layout.tsx');
  assert.match(layout, /headerBackButtonDisplayMode: "minimal"/);
  // Header colours come from the stack's defaults; the three Research screens are
  // titled here and nothing draws a back control of its own.
  assert.match(layout, /<Stack\.Screen name="research\/index" options=\{\{ title: "Araştırma" \}\} \/>/);
  assert.match(layout, /<Stack\.Screen name="research\/\[id\]" options=\{\{ title: "Konu" \}\} \/>/);
  assert.match(layout, /<Stack\.Screen name="research\/pubmed" options=\{\{ title: "PubMed yayınları" \}\} \/>/);
  assert.doesNotMatch(layout, /headerLeft|headerBackVisible|headerBackTitle/);
  for (const file of ['app/(app)/research/index.tsx', 'app/(app)/research/pubmed.tsx']) {
    assert.doesNotMatch(read(file), /headerLeft|router\.back|router\.replace|Stack\.Screen/, file);
  }
});

test('the library opens the PubMed feed and each topic with push, so back returns to the library', () => {
  const library = read('app/(app)/research/index.tsx');
  assert.match(library, /router\.push\("\/research\/pubmed"\)/);
  assert.match(library, /router\.push\(\{ pathname: "\/research\/\[id\]"/);
  assert.doesNotMatch(library, /router\.(replace|navigate)\(/);
});

test('a topic that does not exist falls back to the list instead of a dead end', () => {
  const detail = read('app/(app)/research/[id].tsx');
  assert.match(detail, /router\.canGoBack\(\) \? router\.back\(\) : router\.replace\("\/research"\)/);
  // The only back handling in the detail screen is that fallback; the header arrow does the rest.
  assert.equal((detail.match(/router\.(back|replace|push|navigate)\(/g) ?? []).length, 2);
});
