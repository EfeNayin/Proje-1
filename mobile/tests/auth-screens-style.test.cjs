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

test('registration: heading and button read "Create Account", fields, autofill props and payload', () => {
  const source = register();
  assert.match(source, /accessibilityLabel="Email"/);
  assert.match(source, /accessibilityLabel="Username"/);
  assert.match(source, /accessibilityLabel="First name, optional"/);
  assert.match(source, /accessibilityLabel="Phone number, optional"/);
  assert.match(source, /accessibilityLabel="Password"/);
  assert.match(source, /\(optional\)/);
  for (const prop of [
    'autoComplete="username-new"', 'textContentType="username"', 'autoComplete="given-name"',
    'textContentType="givenName"', 'autoComplete="new-password"', 'textContentType="newPassword"',
    'autoComplete="tel"', 'textContentType="telephoneNumber"', 'keyboardType="phone-pad"',
    'placeholder="At least 8 characters"',
  ]) assert.ok(source.includes(prop), prop);
  assert.match(source, /createRegisterSubmitter\(signUp,/);
  assert.match(
    source,
    /email,\s*username,\s*password,\s*firstName,\s*phoneNumber,\s*timezone: Localization\.getCalendars\(\)\[0\]\?\.timeZone \?\? undefined/,
  );
  assert.match(source, /<Link href="\/login" asChild>/);
  // Nothing the backend does not support.
  assert.doesNotMatch(source, /terms|account type|verif(y|ication)|Confirm password/i);
});

test('registration: "Create Account" is the heading, the visible button text and its accessibility label', () => {
  const source = register();
  assert.match(source, /accessibilityRole="header" style=\{styles\.title\}>\s*Create Account\s*<\/Text>/);
  assert.match(source, /accessibilityLabel="Create Account"/);
  assert.match(source, /<Text style=\{styles\.buttonText\}>Create Account<\/Text>/);
  assert.doesNotMatch(source, /Create account/);
});

test('registration: the username field has a label but no placeholder', () => {
  const source = register();
  const username = source.slice(source.indexOf('accessibilityLabel="Username"'));
  const field = username.slice(0, username.indexOf('/>'));
  assert.doesNotMatch(field, /placeholder/);
  assert.doesNotMatch(source, /Letters, numbers, _/);
  assert.match(source, /<Text style=\{styles\.label\}>Username<\/Text>/);
});

test('registration: the phone field sits between first name and password, and stays out of the way', () => {
  const source = register();
  const at = (needle) => source.indexOf(needle);
  assert.ok(at('accessibilityLabel="First name, optional"') < at('accessibilityLabel="Phone number, optional"'));
  assert.ok(at('accessibilityLabel="Phone number, optional"') < at('accessibilityLabel="Password"'));
  assert.match(source, /Phone number <Text style=\{styles\.optional\}>\(optional\)<\/Text>/);
  // Focus chain: first name -> phone -> password.
  assert.match(source, /phoneRef\.current\?\.focus\(\)/);
  assert.match(source, /passwordRef\.current\?\.focus\(\)/);
  // No placeholder that would suggest a country.
  const phone = source.slice(at('accessibilityLabel="Phone number, optional"'));
  assert.doesNotMatch(phone.slice(0, phone.indexOf('/>')), /placeholder/);
});

test('registration: stable test ids for native flows, so no flow depends on placeholder text', () => {
  const source = register();
  for (const id of [
    'register-email', 'register-username', 'register-first-name', 'register-phone',
    'register-password', 'register-submit',
  ]) assert.ok(source.includes(`testID="${id}"`), id);
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

test('registration: on iOS a scroll keeps the keyboard open so Create Account can be reached', () => {
  const source = register();
  // "on-drag" would close the keyboard as soon as the form is dragged.
  assert.match(
    source,
    /keyboardDismissMode=\{Platform\.OS === "ios" \? "interactive" : "on-drag"\}/,
  );
  // Android ("interactive" acts like "none" there) and web keep the previous mode, and the
  // form never opts out of dismissing entirely.
  assert.doesNotMatch(source, /keyboardDismissMode="on-drag"|keyboardDismissMode="none"/);
  // The keyboard still never swallows the first tap on the button.
  assert.match(source, /keyboardShouldPersistTaps="handled"/);
  // One mechanism for lifting the form above the keyboard: adding automatic insets on top of
  // KeyboardAvoidingView padding would count the keyboard twice.
  assert.match(source, /behavior=\{Platform\.OS === "ios" \? "padding" : undefined\}/);
  assert.doesNotMatch(source, /automaticallyAdjustKeyboardInsets/);
});

test('registration: the Go key and the button share one handler, in the same field order', () => {
  const source = register();
  assert.equal(source.match(/createRegisterSubmitter\(/g).length, 1);
  assert.match(source, /returnKeyType="go"\n\s+onSubmitEditing=\{handleSubmit\}/);
  assert.match(source, /onPress=\{handleSubmit\}\n\s+disabled=\{busy\}/);
  // Focus order: email > username > first name > phone > password.
  const order = ['usernameRef', 'firstNameRef', 'phoneRef', 'passwordRef'];
  const positions = order.map((name) => source.indexOf(`onSubmitEditing={() => ${name}.current?.focus()}`));
  assert.ok(positions.every((position) => position > 0), 'every field hands focus to the next');
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
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
