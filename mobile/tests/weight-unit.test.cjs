/* global __dirname */
// Unit tests for src/units/weight.ts — the kg<->lb conversion layer added
// because `users.weight_unit` used to be a saved-but-unused preference (see
// PROJE_1_CODEX_INCELEME.md, Bölüm 8 madde G1). Every screen that displays
// or accepts a weight now goes through this module instead of hardcoding
// "kg"; these tests pin the conversion math and rounding so that contract
// doesn't quietly drift.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const ts = require(require.resolve('typescript', { paths: [process.env.BODYTRACK_DEPENDENCIES || root] }));
const code = ts.transpileModule(readFileSync(path.join(root, 'src/units/weight.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
vm.runInNewContext(code, { module: loaded, exports: loaded.exports });
const {
  kgToLb,
  lbToKg,
  toDisplayWeight,
  fromDisplayWeight,
  formatWeight,
  formatWeightValue,
  parseWeightInput,
  bodyWeightRangeLabel,
  BODY_WEIGHT_MIN_KG,
  BODY_WEIGHT_MAX_KG,
} = loaded.exports;

test('kg and lb convert through the exact pound definition', () => {
  assert.ok(Math.abs(kgToLb(1) - 2.2046226218) < 1e-6);
  assert.ok(Math.abs(lbToKg(1) - 0.45359237) < 1e-9);
  // Round trip stays within display precision, not exact — floating point.
  assert.ok(Math.abs(lbToKg(kgToLb(82.5)) - 82.5) < 1e-9);
});

test('toDisplayWeight and fromDisplayWeight are inverses, kg is identity', () => {
  assert.equal(toDisplayWeight(82.5, 'kg'), 82.5);
  assert.equal(fromDisplayWeight(82.5, 'kg'), 82.5);
  const asLb = toDisplayWeight(100, 'lb');
  assert.ok(Math.abs(fromDisplayWeight(asLb, 'lb') - 100) < 1e-9);
});

test('formatWeight rounds to one decimal and never shows floating-point noise', () => {
  assert.equal(formatWeight(82.5, 'kg'), '82.5 kg');
  assert.equal(formatWeight(100, 'kg'), '100 kg');
  // 82.5 kg is ~181.9 lb, not 181.89999999999998 lb.
  assert.equal(formatWeight(82.5, 'lb'), '181.9 lb');
  assert.equal(formatWeight(0, 'kg'), '0 kg');
});

test('formatWeightValue omits the unit suffix for prefilling a bare input', () => {
  assert.equal(formatWeightValue(60, 'kg'), '60');
  assert.equal(formatWeightValue(60, 'lb'), formatWeight(60, 'lb').replace(' lb', ''));
});

test('parseWeightInput converts what the user typed in their unit back to kg', () => {
  assert.equal(parseWeightInput('82.5', 'kg'), 82.5);
  assert.ok(Math.abs(parseWeightInput('225', 'lb') - lbToKg(225)) < 1e-9);
  // Same comma-decimal leniency every weight field already had.
  assert.equal(parseWeightInput('82,5', 'kg'), 82.5);
});

test('parseWeightInput returns null instead of NaN for unparseable text', () => {
  assert.equal(parseWeightInput('abc', 'kg'), null);
  assert.equal(parseWeightInput('', 'kg'), 0); // matches the pre-existing
  // behaviour of Number("") === 0, which callers already guarded against
  // with a `< BODY_WEIGHT_MIN_KG` bounds check rather than a null check.
});

test('a value entered in lb is validated against the same kg bounds as kg input', () => {
  // 45 kg is comfortably inside [20, 400] kg; the lb figure for the same
  // physical weight must land in the same place after conversion.
  const kgFromLb = parseWeightInput(String(kgToLb(45)), 'lb');
  assert.ok(kgFromLb >= BODY_WEIGHT_MIN_KG && kgFromLb <= BODY_WEIGHT_MAX_KG);
  assert.ok(Math.abs(kgFromLb - 45) < 1e-6);
});

test('bodyWeightRangeLabel converts the fixed kg bounds, not the other way around', () => {
  assert.equal(bodyWeightRangeLabel('kg'), '20–400 kg');
  const lbLabel = bodyWeightRangeLabel('lb');
  assert.match(lbLabel, /^\d+(\.\d)?–\d+(\.\d)? lb$/);
  assert.ok(lbLabel.startsWith(String(Math.round(kgToLb(20) * 10) / 10).replace(/\.0$/, '')));
});
