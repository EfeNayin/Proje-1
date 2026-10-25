/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

// Source-level guards for the sign-in / registration presentation. The submit
// rules themselves are covered by login-submit and register-submit tests.

const login = () => read('app/(auth)/login.tsx');
const register = () => read('app/(auth)/register.tsx');
const screens = { 'app/(auth)/login.tsx': login, 'app/(auth)/register.tsx': register };

test('auth screens: light theme, system font, no statue, gradient, Roman or gold', () => {
  for (const [file, get] of Object.entries(screens)) {
    const source = get();
    assert.match(source, /authStyles/, file);
    assert.match(source, /lightTheme/, file);
    assert.doesNotMatch(source, /romanTheme|romanFont|useRomanFonts|useFonts|roman\.|LinearGradient|expo-image|hercules|Cinzel|gold/i, file);
  }
  const styles = read('src/auth/authStyles.ts');
  assert.match(styles, /lightTheme/);
  assert.doesNotMatch(styles, /fontFamily|textTransform|letterSpacing|gold|position: "fixed"/);
});

test('sign-in: heading kept, the identifier is email, password manager props unchanged', () => {
  const source = login();
  assert.match(source, /Find your strength\./);
  assert.match(source, /accessibilityLabel="Email"/);
  assert.doesNotMatch(source, /Email or username|Username/);
  for (const prop of [
    'keyboardType="email-address"', 'textContentType="emailAddress"', 'autoComplete="email"',
    'textContentType="password"', 'autoComplete="current-password"', 'secureTextEntry={!showPassword}',
    'autoCapitalize="none"', 'autoCorrect={false}', 'returnKeyType="go"',
  ]) assert.ok(source.includes(prop), prop);
  assert.match(source, /createLoginSubmitter\(signIn,/);
  assert.match(source, /<Link href="\/register" asChild>/);
});

test('registration: same fields, optional one labelled, autofill props and payload unchanged', () => {
  const source = register();
  assert.match(source, /accessibilityLabel="Email"/);
  assert.match(source, /accessibilityLabel="Username"/);
  assert.match(source, /accessibilityLabel="First name, optional"/);
  assert.match(source, /accessibilityLabel="Password"/);
  assert.match(source, /\(optional\)/);
  for (const prop of [
    'autoComplete="username-new"', 'textContentType="username"', 'autoComplete="given-name"',
    'textContentType="givenName"', 'autoComplete="new-password"', 'textContentType="newPassword"',
    'placeholder="Letters, numbers, _"', 'placeholder="At least 8 characters"',
  ]) assert.ok(source.includes(prop), prop);
  assert.match(source, /createRegisterSubmitter\(signUp,/);
  assert.match(source, /email,\s*username,\s*password,\s*firstName,\s*timezone: Localization\.getCalendars\(\)\[0\]\?\.timeZone \?\? undefined/);
  assert.match(source, /<Link href="\/login" asChild>/);
  // Nothing the backend does not support.
  assert.doesNotMatch(source, /terms|account type|verif(y|ication)|Confirm password/i);
});

test('auth screens: errors stay near the form, values stay, duplicate submits are blocked', () => {
  for (const [file, get] of Object.entries(screens)) {
    const source = get();
    assert.match(source, /accessibilityRole="alert"/, file);
    assert.match(source, /disabled=\{busy\}/, file);
    assert.match(source, /accessibilityState=\{\{ busy, disabled: busy \}\}/, file);
    // Failure only sets the message and clears busy: no field is reset.
    assert.doesNotMatch(source, /setPassword\(""\)|setEmail\(""\)/, file);
  }
  // The error is rendered between the password field and the primary button.
  assert.ok(login().indexOf('styles.errorRow') < login().indexOf('accessibilityLabel="Sign in"'));
  assert.match(register(), /scrollRef\.current\?\.scrollToEnd/);
});

test('auth screens: the whole form scrolls above the keyboard and no action is pinned to the bottom', () => {
  for (const [file, get] of Object.entries(screens)) {
    const source = get();
    assert.match(source, /KeyboardAvoidingView/, file);
    assert.match(source, /<ScrollView/, file);
    assert.match(source, /keyboardShouldPersistTaps="handled"/, file);
    assert.doesNotMatch(source, /position: "absolute"|useWindowDimensions/, file);
  }
});

test('auth screens: password toggle and links have named 44 pt targets', () => {
  for (const [file, get] of Object.entries(screens)) {
    assert.match(get(), /"Hide password" : "Show password"/, file);
  }
  const styles = read('src/auth/authStyles.ts');
  assert.match(styles, /MIN_TOUCH = 44/);
  assert.match(styles, /eyeButton: \{[^}]*width: 52[^}]*minHeight: MIN_TOUCH/s);
  assert.match(styles, /linkButton: \{ minHeight: MIN_TOUCH/);
  assert.match(styles, /textDecorationLine: "underline"/);
});
