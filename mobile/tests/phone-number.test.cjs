// Run with node --test tests/phone-number.test.cjs. Pure logic, no I/O.
//
// The cases are the shared contract with the backend (backend/tests/test_phone_number.py,
// NORMALIZATION and REJECTED): the same input must give the same result on both sides.
/* global __dirname */
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const mobileRoot = path.resolve(__dirname, '..');
const ts = require(require.resolve('typescript', {
  paths: [process.env.BODYTRACK_DEPENDENCIES || mobileRoot],
}));

const code = ts.transpileModule(readFileSync(path.join(mobileRoot, 'src/account/phoneNumber.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module_ = { exports: {} };
vm.runInNewContext(code, { module: module_, exports: module_.exports });
const { parsePhoneNumber, phoneNumberError, phoneNumberForRequest, PHONE_COUNTRY_CODE_HINT, PHONE_INPUT_MAX_LENGTH } =
  module_.exports;

const NORMALIZATION = [
  ['+905321234567', '+905321234567'],
  ['+90 532 123 45 67', '+905321234567'],
  ['+90 (532) 123-45-67', '+905321234567'],
  ['+90.532.123.45.67', '+905321234567'],
  ['  +90 532 123 45 67  ', '+905321234567'],
  ['00905321234567', '+905321234567'],
  ['0090 532 123 45 67', '+905321234567'],
  ['+1 (415) 555-0132', '+14155550132'],
  ['+44 7911 123456', '+447911123456'],
  ['+49 151 23456789', '+4915123456789'],
  ['+12345678', '+12345678'],
  ['+123456789012345', '+123456789012345'],
];

const REJECTED = [
  '05321234567',
  '532 123 45 67',
  '90 532 123 45 67',
  '+',
  '+ - ( )',
  '+0 532 123 45 67',
  '+0905321234567',
  '+9053212',
  '+1234567890123456',
  '+90 532 abc 45 67',
  '+90 532 123 45 67 ext 5',
  '+90 532 123 45 67 #',
  '+٩٠٥٣٢١٢٣٤٥٦٧',
  '+90²5321234567',
  '++905321234567',
  '+90+5321234567',
  '+90 532 123 45 67\n+90 532 123 45 68',
];

test('normalizes to E.164, the same as the backend', () => {
  for (const [typed, stored] of NORMALIZATION) {
    assert.deepEqual({ ...parsePhoneNumber(typed) }, { kind: 'valid', value: stored }, typed);
    assert.equal(phoneNumberError(typed), null, typed);
    assert.equal(phoneNumberForRequest(typed), stored, typed);
  }
});

test('blank is valid and means "none"', () => {
  for (const typed of ['', '   ', '\t']) {
    assert.equal(parsePhoneNumber(typed).kind, 'empty');
    assert.equal(phoneNumberError(typed), null);
    assert.equal(phoneNumberForRequest(typed), undefined);
  }
});

test('refuses what the backend refuses, and never repeats the input in the message', () => {
  for (const typed of REJECTED) {
    const parsed = parsePhoneNumber(typed);
    assert.equal(parsed.kind, 'invalid', JSON.stringify(typed));
    assert.equal(phoneNumberForRequest(typed), undefined, typed);
    const message = parsed.message.replace(PHONE_COUNTRY_CODE_HINT, '');
    if (/[0-9]/.test(typed)) assert.ok(!message.includes(typed.trim()), typed);
  }
});

test('no country is assumed: a national number is asked for its country code', () => {
  const parsed = parsePhoneNumber('0532 123 45 67');
  assert.equal(parsed.kind, 'invalid');
  assert.match(parsed.message, /country code/);
  assert.match(parsed.message, /\+90 532 123 45 67/); // an example, not a default
});

test('an overlong entry is refused with its own message', () => {
  assert.equal(phoneNumberError(`+${'1'.repeat(PHONE_INPUT_MAX_LENGTH)}`), `Phone number must be at most ${PHONE_INPUT_MAX_LENGTH} characters.`);
});

const backendSchemas = path.join(mobileRoot, '../backend/app/domains/auth/schemas.py');

// The mobile package can be tested on its own (without the backend checked out beside it).
test('the messages are word for word the backend ones', { skip: !existsSync(backendSchemas) && 'backend source not present' }, () => {
  const backend = readFileSync(backendSchemas, 'utf8');
  for (const sentence of [
    'Phone number needs an explicit country code.',
    'Phone number may contain only digits after the +.',
    'A country code never starts with 0.',
    'including the country code.',
    'Start with the country code, for example +90 532 123 45 67.',
    'Spaces, hyphens, dots and parentheses are allowed.',
  ]) assert.ok(backend.includes(sentence), `backend: ${sentence}`);
  const source = readFileSync(path.join(mobileRoot, 'src/account/phoneNumber.ts'), 'utf8');
  for (const sentence of [
    'Phone number needs an explicit country code.',
    'Phone number may contain only digits after the +.',
    'A country code never starts with 0.',
    'including the country code.',
    'Start with the country code, for example +90 532 123 45 67.',
    'Spaces, hyphens, dots and parentheses are allowed.',
  ]) assert.ok(source.includes(sentence), `mobile: ${sentence}`);
});

const personalDetails = () => readFileSync(path.join(mobileRoot, 'app/(app)/profile/personal-details.tsx'), 'utf8');

test('Personal Details: the owner can view, correct and clear the number', () => {
  const source = personalDetails();
  assert.match(source, /label="Phone number"/);
  assert.match(source, /value=\{user\.phone_number \?\? "—"\}/);
  // Seeded from the stored value, checked with the shared rule, sent normalized.
  assert.match(source, /setPhoneDraft\(user\.phone_number \?\? ""\)/);
  assert.match(source, /phoneNumberError\(phoneDraft\)/);
  // Blank clears with an explicit null (omitting the field would leave it unchanged).
  assert.match(source, /phone_number: parsed\.kind === "valid" \? parsed\.value : null/);
  assert.match(source, /keyboardType="phone-pad"/);
  // The error is shown next to the field being edited, not only at the top of a long screen.
  assert.match(source, /error && editing !== "phone"/);
});

test('Personal Details: the phone row stays above the keyboard on a small screen', () => {
  const source = personalDetails();
  // Found on an iPhone SE simulator: the last row's input, buttons and error were covered.
  assert.match(source, /automaticallyAdjustKeyboardInsets/);
  assert.match(source, /scrollRef\.current\?\.scrollToEnd/);
  assert.match(source, /Keyboard\.addListener\("keyboardDidShow", reveal\)/);
  assert.match(source, /\[editing, error\]/);
  // Found on the same simulator: long helper text widened the wrapping row beyond the card, so
  // the input and the save/cancel buttons were pushed off screen.
  assert.match(source, /fieldHint: \{ width: "100%"/);
  assert.match(source, /rowError: \{ width: "100%"/);
  assert.match(source, /styles\.inlineForm, styles\.fullWidth/);
  // Hooks before the early return, in the same order on every render.
  assert.ok(source.indexOf('const scrollRef = useRef') < source.indexOf('if (!user) return null;'));
});

test('the number is never shown anywhere but the owner\'s own screens', () => {
  // Coaching and athlete screens read other people through coaching APIs, which do not carry
  // the field; the client must not reference it there either.
  const { readdirSync, statSync } = require('node:fs');
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
  const users = walk(path.join(mobileRoot, 'app')).concat(walk(path.join(mobileRoot, 'src')))
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .filter((file) => readFileSync(file, 'utf8').includes('phone_number'))
    .map((file) => path.relative(mobileRoot, file).split(path.sep).join('/'))
    .sort();
  assert.deepEqual(users, [
    'app/(app)/profile/personal-details.tsx',
    'src/account/phoneNumber.ts',
    'src/api/auth.ts',
    'src/auth/registerSubmit.ts',
  ]);
});
