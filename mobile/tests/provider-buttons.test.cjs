// Run with node --test tests/provider-buttons.test.cjs.
//
// The Google and Apple buttons on the sign-in screen. ProviderButtons.tsx is transpiled
// and run for real; react-native, the two native SDKs and the JSX runtime are small
// doubles that keep the elements as plain {type, props} objects, so the tests read what
// would be drawn (sizes, colors, labels) and call what a tap would call. How it looks on
// a phone is not something this can show: that is the TestFlight check.
/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const ts = require(require.resolve('typescript', { paths: [process.env.BODYTRACK_DEPENDENCIES || root] }));

const AppleButton = function AppleAuthenticationButton() {};
const element = (type, props) => ({ type, props: props ?? {} });
const runtime = {
  jsx: (type, props, key) => element(type, { ...props, key }),
  jsxs: (type, props, key) => element(type, { ...props, key }),
  Fragment: Symbol('Fragment'),
};
const View = 'View';
const Text = 'Text';
const Image = 'Image';
const Pressable = 'Pressable';

function load({ os = 'ios', appleModule = true, googleModule = true } = {}) {
  const file = path.join(root, 'src/social/ProviderButtons.tsx');
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module_ = { exports: {} };
  vm.runInNewContext(code, {
    module: module_, exports: module_.exports,
    require: (id) => {
      if (id === 'react/jsx-runtime') return runtime;
      if (id === 'react-native') {
        return {
          Platform: { OS: os }, Image, Pressable, Text, View,
          StyleSheet: { create: (styles) => styles },
        };
      }
      if (id === 'expo-apple-authentication') {
        if (!appleModule) throw new Error('module not in this build');
        return {
          AppleAuthenticationButton: AppleButton,
          AppleAuthenticationButtonType: { SIGN_IN: 0 },
          AppleAuthenticationButtonStyle: { WHITE_OUTLINE: 1 },
        };
      }
      if (id === '@react-native-google-signin/google-signin') {
        if (!googleModule) throw new Error('module not in this build');
        return {};
      }
      if (id.endsWith('google-g.png')) return { uri: 'google-g.png' };
      throw new Error(`Unexpected import: ${id}`);
    },
  }, { filename: file });
  return module_.exports;
}

// Every element in a returned tree, depth first (host and double components only).
function walk(node, found = []) {
  if (node === null || node === undefined || typeof node !== 'object') return found;
  if (Array.isArray(node)) { node.forEach((child) => walk(child, found)); return found; }
  found.push(node);
  walk(node.props.children, found);
  return found;
}
const flat = (style) => Object.assign({}, ...[style].flat(Infinity).filter((s) => s && typeof s === 'object'));
// The element whose own children (not deeper ones) include `child`.
const parentOf = (tree, child) => walk(tree).find((n) => [n.props.children].flat(Infinity).includes(child));
const byTestId = (tree, id) => walk(tree).find((n) => n.props.testID === id);

// The Google button is its own component: call it to get what it draws.
function drawn(tree) {
  const slot = walk(tree).find((n) => n.type && n.type.name === 'GoogleButton');
  return slot ? { slot, tree: slot.type(slot.props) } : null;
}

const both = { apple: true, google: true };

test('both buttons show when both providers are offered, Apple first', () => {
  const { ProviderButtons } = load();
  const tree = ProviderButtons({ offered: both, disabled: false, onPress() {} });
  const order = walk(tree).filter((n) => n.props.testID === 'login-apple' || (n.type && n.type.name === 'GoogleButton'));
  assert.equal(order.length, 2);
  assert.equal(order[0].props.testID, 'login-apple');
  assert.equal(order[1].type.name, 'GoogleButton');
});

test('each button shows only for an offered provider whose module is in the build', () => {
  const { ProviderButtons } = load();
  const only = (offered, options) => {
    const world = options ? load(options).ProviderButtons : ProviderButtons;
    const tree = world({ offered, disabled: false, onPress() {} });
    return tree ? { apple: !!byTestId(tree, 'login-apple'), google: !!drawn(tree) } : null;
  };
  assert.equal(JSON.stringify(only({ apple: true, google: false })), JSON.stringify({ apple: true, google: false }));
  assert.equal(JSON.stringify(only({ apple: false, google: true })), JSON.stringify({ apple: false, google: true }));
  assert.equal(only({ apple: false, google: false }), null);
  assert.equal(JSON.stringify(only(both, { appleModule: false })), JSON.stringify({ apple: false, google: true }));
  assert.equal(JSON.stringify(only(both, { googleModule: false })), JSON.stringify({ apple: true, google: false }));
  assert.equal(only(both, { appleModule: false, googleModule: false }), null);
});

test('nothing is drawn off iOS, whatever is offered', () => {
  for (const os of ['android', 'web']) {
    const { ProviderButtons } = load({ os });
    assert.equal(ProviderButtons({ offered: both, disabled: false, onPress() {} }), null, os);
  }
});

test('Apple\'s button is the native one, white with an outline, with its label and test id', () => {
  const { ProviderButtons, BUTTON_HEIGHT, BUTTON_RADIUS } = load();
  const tree = ProviderButtons({ offered: both, disabled: false, onPress() {} });
  const button = byTestId(tree, 'login-apple');
  assert.equal(button.type, AppleButton);
  assert.equal(button.props.accessibilityLabel, 'Sign in with Apple');
  assert.equal(button.props.buttonType, 0); // SIGN_IN
  assert.equal(button.props.buttonStyle, 1); // WHITE_OUTLINE
  assert.equal(button.props.cornerRadius, BUTTON_RADIUS);
  const style = flat(button.props.style);
  assert.equal(style.height, BUTTON_HEIGHT);
  assert.equal(style.width, '100%');
  // Apple's rules: the size comes from style, the fill and radius from its own props.
  assert.equal(style.backgroundColor, undefined);
  assert.equal(style.borderRadius, undefined);
});

test('Google\'s button matches Apple\'s size and radius, is white with a thin outline, and has no shadow', () => {
  const { ProviderButtons, BUTTON_HEIGHT, BUTTON_RADIUS } = load();
  const tree = ProviderButtons({ offered: both, disabled: false, onPress() {} });
  const apple = flat(byTestId(tree, 'login-apple').props.style);
  const { tree: google } = drawn(tree);
  const style = flat(google.props.style({ pressed: false }));
  assert.equal(google.type, Pressable);
  assert.equal(style.height, apple.height);
  assert.equal(style.height, BUTTON_HEIGHT);
  assert.equal(style.width, apple.width);
  assert.equal(style.borderRadius, BUTTON_RADIUS);
  assert.equal(style.backgroundColor, '#FFFFFF');
  assert.equal(style.borderWidth, 1);
  assert.equal(style.borderColor, '#747775');
  for (const key of ['shadowColor', 'shadowOpacity', 'shadowRadius', 'shadowOffset', 'elevation']) {
    assert.equal(style[key], undefined, key);
  }
});

test('Google\'s button follows the light-theme spec: the unmodified G at its own ratio, the label, the iOS padding', () => {
  const { ProviderButtons } = load();
  const { tree } = drawn(ProviderButtons({ offered: both, disabled: false, onPress() {} }));
  const [logo, label] = tree.props.children;
  assert.equal(logo.type, Image);
  assert.equal(logo.props.source.uri, 'google-g.png');
  const { width, height, marginRight } = flat(logo.props.style);
  assert.ok(Math.abs(width / height - 200 / 204) < 1e-9, 'the G keeps its 200 x 204 proportions');
  assert.equal(marginRight, 12);
  assert.equal(flat(tree.props.style({ pressed: false })).paddingHorizontal, 16);
  assert.equal(label.props.children, 'Sign in with Google');
  const text = flat(label.props.style);
  assert.equal(text.color, '#1F1F1F');
  assert.equal(text.fontSize, 14);
  assert.equal(text.lineHeight, 20);
  assert.equal(text.fontWeight, '500');
  // The G is part of the button, not a second thing to focus.
  assert.equal(logo.props.accessible, false);
});

test('Google\'s pressed state stays flat: only the fill changes', () => {
  const { ProviderButtons } = load();
  const { tree } = drawn(ProviderButtons({ offered: both, disabled: false, onPress() {} }));
  const rest = flat(tree.props.style({ pressed: false }));
  const pressed = flat(tree.props.style({ pressed: true }));
  assert.notEqual(pressed.backgroundColor, rest.backgroundColor);
  assert.equal(pressed.borderColor, rest.borderColor);
  assert.equal(pressed.shadowOpacity, undefined);
});

test('a tap on each button asks for that provider, and only that one', () => {
  const { ProviderButtons } = load();
  const taps = [];
  const tree = ProviderButtons({ offered: both, disabled: false, onPress: (p) => taps.push(p) });
  byTestId(tree, 'login-apple').props.onPress();
  assert.deepEqual(taps, ['apple']);
  drawn(tree).tree.props.onPress();
  assert.deepEqual(taps, ['apple', 'google']);
});

test('while an attempt runs both buttons look inactive and do not take taps', () => {
  const { ProviderButtons } = load();
  const tree = ProviderButtons({ offered: both, disabled: true, onPress() {} });

  // Google: a disabled Pressable, announced as disabled, dimmed by its slot.
  const { slot, tree: google } = drawn(tree);
  assert.equal(google.props.disabled, true);
  assert.equal(google.props.accessibilityState.disabled, true);
  const googleSlot = parentOf(tree, slot);
  assert.equal(flat(googleSlot.props.style).opacity, 0.5);

  // Apple: no disabled prop exists, so its slot swallows touches and is dimmed.
  const appleSlot = parentOf(tree, byTestId(tree, 'login-apple'));
  assert.equal(appleSlot.props.pointerEvents, 'none');
  assert.equal(flat(appleSlot.props.style).opacity, 0.5);
});

test('with no attempt running both buttons are live and at full strength', () => {
  const { ProviderButtons } = load();
  const tree = ProviderButtons({ offered: both, disabled: false, onPress() {} });
  const { tree: google } = drawn(tree);
  assert.equal(google.props.disabled, false);
  assert.equal(google.props.accessibilityState.disabled, false);
  assert.equal(google.props.accessibilityLabel, 'Sign in with Google');
  assert.equal(google.props.accessibilityRole, 'button');
  const appleSlot = parentOf(tree, byTestId(tree, 'login-apple'));
  assert.equal(appleSlot.props.pointerEvents, 'auto');
  assert.equal(flat(appleSlot.props.style).opacity, undefined);
});

test('the buttons are as tall and wide as the email Sign in button above them', () => {
  const { BUTTON_HEIGHT, BUTTON_RADIUS } = load();
  const source = readFileSync(path.join(root, 'src/auth/authStyles.ts'), 'utf8');
  assert.match(source, new RegExp(`button: \\{\\s*minHeight: ${BUTTON_HEIGHT},[^}]*borderRadius: ${BUTTON_RADIUS},`));
});
