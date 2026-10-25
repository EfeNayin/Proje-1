/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

// Source-level guards for the Research presentation (the feed's behaviour is
// covered by research-feed.test.cjs); they pin decisions a restyle could drop.

const screen = () => read('app/(app)/research.tsx');

test('research: light theme and system font', () => {
  const source = screen();
  assert.match(source, /lightTheme/);
  assert.doesNotMatch(source, /romanTheme|romanFont|useRomanFonts|roman\./);
});

test('research: titles, journals, abstracts and the original-text note are never clipped', () => {
  const source = screen();
  assert.doesNotMatch(source, /numberOfLines|ellipsizeMode|adjustsFontSizeToFit/);
  assert.match(source, /\{publication\.title\}/);
  assert.match(source, /Original English text from PubMed\./);
  // Section text is passed through untouched.
  assert.match(source, /\{section\.text\}/);
});

test('research: missing metadata is left out, never invented', () => {
  const source = screen();
  assert.match(source, /publication\.year != null/);
  assert.match(source, /filter\(\(part\): part is string => !!part\)/);
  assert.match(source, /publication\.publication_types\.length > 0/);
});

test('research: no abstract, collapsed abstract and a failed request stay distinct', () => {
  const source = screen();
  assert.match(source, /PubMed has no abstract for this record\./);
  assert.match(source, /"Show abstract"/);
  assert.match(source, /"Hide abstract"/);
  assert.match(source, /Could not load publications\./);
});

test('research: a failed refresh is never shown as an empty result', () => {
  const source = screen();
  // The empty message is suppressed while an error is held ...
  assert.match(source, /error \? null : \(\s*<Text style=\{styles\.centeredText\}>PubMed returned no matching publications\./);
  // ... and the refresh banner no longer depends on already having items.
  assert.match(source, /error\?\.kind === "refresh" \? \(/);
  assert.doesNotMatch(source, /error\?\.kind === "refresh" && items\.length > 0/);
});

test('research: the source link keeps its PMID check and a 44 pt target; links are underlined', () => {
  const source = screen();
  assert.match(source, /pubmedLink\(publication\)/);
  assert.match(source, /openSource\(link\)/);
  assert.match(source, /accessibilityRole="link"/);
  assert.match(source, /MIN_TOUCH = 44/);
  assert.match(source, /minHeight: MIN_TOUCH/);
  assert.match(source, /textDecorationLine: "underline"/);
});

test('research: paging, refresh and retry still go through the feed', () => {
  const source = screen();
  assert.match(source, /createPublicationFeed\(researchApi\.fetchPublications\)/);
  assert.match(source, /feed\.loadMore\(true\)/);
  assert.match(source, /feed\.refresh\(\)/);
  assert.match(source, /feed\.ensureLoaded\(\)/);
  assert.match(source, /feed\.cancel\(\)/);
  assert.doesNotMatch(source, /fetchPublications\(/);
});
