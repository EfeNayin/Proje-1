const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'app', '(app)', '(tabs)', '_layout.tsx'),
  'utf8',
);

// The five visible tabs share one light appearance. It lives in screenOptions only:
// a per-tab override would let one tab fall back to a different bar (the
// navigator applies the focused tab's options), which is what the redesign
// of the tabs consolidated away.
test('tab layout: the bar appearance is defined once for all five tabs', () => {
  const [, screenOptions] = /screenOptions=\{\{([\s\S]*?)\n {6}\}\}/.exec(source) ?? [];
  assert.ok(screenOptions, 'screenOptions block not found');
  for (const key of ['sceneStyle', 'tabBarActiveTintColor', 'tabBarInactiveTintColor']) {
    assert.match(screenOptions, new RegExp(`${key}:`), `${key} missing from screenOptions`);
  }
  assert.match(screenOptions, /headerShown: false/);
  // The full-width rectangular bar style is gone: the floating pill draws its own container.
  assert.doesNotMatch(source, /tabBarStyle/);

  for (const key of ['sceneStyle', 'tabBarActiveTintColor', 'tabBarInactiveTintColor']) {
    const occurrences = source.split(`${key}:`).length - 1;
    assert.equal(occurrences, 1, `${key} is overridden per tab`);
  }
});

test('tab layout: Volume, History, Workout, Exercises and Diet are the tabs, all light; Profile is a hidden route', () => {
  const screens = [...source.matchAll(/<Tabs\.Screen\s+name="([^"]+)"\s+options=\{\{([\s\S]*?)\}\}\s*\/>/g)];
  const names = screens.map((match) => match[1]);
  // Declared order is the visual order; the Profile and old Programs routes follow as hidden ones.
  assert.deepEqual(names, ['volume', 'history', 'index', 'exercises', 'diet', 'profile', 'programs']);

  const titles = Object.fromEntries(screens.map((match) => [match[1], /title: "([^"]+)"/.exec(match[2])?.[1]]));
  assert.deepEqual(
    ['volume', 'history', 'index', 'exercises', 'diet'].map((name) => titles[name]),
    ['Volume', 'History', 'Workout', 'Exercises', 'Diet'],
  );
  assert.doesNotMatch(source, /title: "(Training|Programs|Start Workout)"/);
  assert.doesNotMatch(source, /romanTheme|\.\.\/theme"/);
  assert.match(source, /lightTheme/);
});

test('tab layout: Profile stays a registered route but is not a tab, and is never redirected to Diet', () => {
  assert.match(source, /<Tabs\.Screen name="profile" options=\{\{ href: null \}\} \/>/);
  assert.doesNotMatch(source, /name="profile"[\s\S]{0,80}tabBarIcon/);
  assert.doesNotMatch(source, /Redirect/);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'app', '(app)', '(tabs)', 'profile.tsx')));
  const diet = fs.readFileSync(path.join(__dirname, '..', 'app', '(app)', '(tabs)', 'diet.tsx'), 'utf8');
  // Diet is a dashboard now (tests/diet-home.test.cjs); it still never redirects away.
  assert.match(diet, /<TabTopBar\s+title="Diet"/);
  assert.doesNotMatch(diet, /Redirect/);
});

test('tab layout: Programs has no button in the bar, and the middle tab is where the app opens', () => {
  const programs = /<Tabs\.Screen name="programs" options=\{\{ href: null \}\} \/>/.exec(source);
  assert.ok(programs, 'programs must be a hidden route, not a tab');
  assert.doesNotMatch(source, /name="programs"[\s\S]{0,80}tabBarIcon/);
  // Workout is the third of five visible tabs and is named as the anchor explicitly,
  // because a tab navigator would otherwise start on the first tab it lists (Volume).
  assert.match(source, /export const unstable_settings = \{\s*anchor: "index",?\s*\};/);
  const visible = [...source.matchAll(/<Tabs\.Screen\s+name="([^"]+)"\s+options=\{\{\s*title:/g)].map((match) => match[1]);
  assert.equal(visible.length, 5);
  assert.equal(visible[2], 'index');
});

test('tab layout: labels keep one size and one line in the stock-height bar; all five tabs are equal width', () => {
  const [, screenOptions] = /screenOptions=\{\{([\s\S]*?)\n {6}\}\}/.exec(source) ?? [];
  assert.match(screenOptions, /tabBarAllowFontScaling: false/);
  assert.match(screenOptions, /tabBarLabelStyle: \{ fontSize: 10 \}/);
  // A one-line label needs no taller bar: the library's own height and safe-area handling stay.
  assert.doesNotMatch(screenOptions, /height:/);
  assert.doesNotMatch(source, /useSafeAreaInsets/);

  const [, middle] = /name="index"\s+options=\{\{([\s\S]*?)\}\}\s*\/>/.exec(source) ?? [];
  assert.ok(middle, 'index tab not found');
  // The short title is the visible label (the bar draws it on one line at size 10) and the spoken name.
  assert.match(middle, /title: "Workout"/);
  assert.match(middle, /tabBarAccessibilityLabel: "Workout"/);
  assert.match(middle, /tabBarButtonTestID: "tab-workout"/);
  // No special label component and no width bias: every tab is the same flex-1 item.
  assert.doesNotMatch(source, /tabBarLabel:|tabBarItemStyle:|TabLabel/);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'workout', 'StartWorkoutTabLabel.tsx')), false);
});

test('tab layout: the Workout home heading is "Workout" while the actions keep their wording', () => {
  const home = fs.readFileSync(path.join(__dirname, '..', 'app', '(app)', '(tabs)', 'index.tsx'), 'utf8');
  assert.match(home, /<TabTopBar title="Workout"/);
  assert.doesNotMatch(home, /title="Start Workout"/);
  assert.match(home, /Start an Empty Workout/);
  assert.match(home, /Resume workout/);
});

// ------------------------------------------------------------ the floating pill

const h = require('./support/screen-harness.cjs');

test('floating bar: one fully rounded pill with side margins, a border, a shadow, and safe-area spacing', () => {
  const bar = h.read('src/workout/FloatingTabBar.tsx');
  const pill = /pill: \{[\s\S]*?\n {2}\},/.exec(bar)?.[0];
  assert.ok(pill, 'pill style not found');
  assert.match(pill, /borderRadius: 999/);
  assert.match(pill, /backgroundColor: light\.surface/);
  assert.match(pill, /borderWidth: StyleSheet\.hairlineWidth/);
  assert.match(pill, /borderColor: light\.separator/);
  assert.match(pill, /boxShadow:/);
  assert.match(pill, /elevation:/);
  assert.match(bar, /marginHorizontal: 12 \+ Math\.max\(insets\.left, insets\.right\)/);
  assert.match(bar, /marginBottom: Math\.max\(insets\.bottom - 8, 12\)/);
  // Light palette tokens only: no literal hex colours and no dark mode.
  assert.doesNotMatch(bar, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(bar, /useColorScheme|dark/i);
  // No separate '+' action and no new dependency.
  assert.doesNotMatch(bar, /name="add|"\+"|>\+</);
  assert.doesNotMatch(bar, /reanimated|expo-blur|expo-haptics/);
});

test('floating bar: the selected highlight is rounded, sits behind icon and label, and pressed buttons change', () => {
  const bar = h.read('src/workout/FloatingTabBar.tsx');
  const highlight = /highlight: \{[\s\S]*?\},/.exec(bar)[0];
  assert.match(highlight, /position: "absolute"/);
  assert.match(highlight, /borderRadius: 999/);
  assert.match(highlight, /backgroundColor: light\.separator/);
  // Drawn before the items in the row, so it is behind both the icon and the label.
  assert.ok(bar.indexOf('styles.highlight') < bar.indexOf('visible.map'));
  assert.match(bar, /itemPressed: \{ backgroundColor: light\.pressed \}/);
  assert.match(bar, /contentPressed: \{ opacity: [\d.]+ \}/);
  assert.match(bar, /minHeight: 48/);
  assert.match(bar, /minWidth: 44/);
});

function renderBar({ index = 2, focusedHidden = false, prevent = false } = {}) {
  const calls = [];
  const names = ['volume', 'history', 'index', 'exercises', 'diet', 'profile', 'programs'];
  const routes = names.map((name) => ({ key: `${name}-key`, name }));
  const titles = { volume: 'Volume', history: 'History', index: 'Workout', exercises: 'Exercises', diet: 'Diet' };
  const descriptors = Object.fromEntries(routes.map((route) => [route.key, {
    options: {
      title: titles[route.name],
      tabBarIcon: ({ color }) => h.createElement('Icon', { name: route.name, color }),
      tabBarAccessibilityLabel: route.name === 'index' ? 'Workout' : undefined,
      tabBarActiveTintColor: 'ACTIVE',
      tabBarInactiveTintColor: 'INACTIVE',
      tabBarItemStyle: titles[route.name] ? undefined : { display: 'none' },
    },
  }]));
  const hooks = h.createHooks();
  const animations = [];
  class Value { constructor(v) { this.v = v; } setValue(v) { this.v = v; } }
  const bar = h.loadFile('src/workout/FloatingTabBar.tsx', {
    globals: { React: { createElement: h.createElement } },
    modules: {
      react: hooks.hooks,
      '../lightTheme': { light: { surface: 'S', separator: 'SEP', pressed: 'P', text: 'T', textSecondary: 'TS' } },
      'react-native': h.reactNative({
        StyleSheet: { create: (x) => x, hairlineWidth: 1, flatten: (x) => x },
        Easing: { out: (f) => f, cubic: 'cubic' },
        Animated: {
          Value,
          View: 'AnimatedView',
          parallel: (list) => ({ start: () => animations.push(list), stop() {} }),
          timing: (value, config) => ({ value, config }),
        },
        AccessibilityInfo: { isReduceMotionEnabled: () => Promise.resolve(false), addEventListener: () => ({ remove() {} }) },
      }),
    },
  }).FloatingTabBar;
  const props = {
    state: { key: 'tabs', index: focusedHidden ? 5 : index, routes },
    descriptors,
    insets: { top: 0, bottom: 34, left: 0, right: 0 },
    navigation: {
      emit: (event) => { calls.push(['emit', event.type, event.target]); return { defaultPrevented: prevent }; },
      dispatch: (action) => { calls.push(['dispatch', action.payload.name, action.target]); },
    },
  };
  const render = () => hooks.render(bar, props);
  return { render, calls, animations, routes, props };
}

// A Pressable's children are a render function (the pressed state) wrapped in the children array.
const renderItem = (node, state) => node.props.children[0](state);
const pressables = (tree) => h.nodes(tree).filter((node) => node.type === 'Pressable');

test('floating bar: shows the five tabs in order, with selected state, labels and the one-line Workout label', () => {
  const world = renderBar();
  const tree = world.render();
  const items = pressables(tree);
  assert.deepEqual(items.map((node) => node.props.testID), [undefined, undefined, undefined, undefined, undefined]);
  assert.equal(items.length, 5); // Profile and Programs are not drawn
  assert.deepEqual(items.map((node) => node.props.accessibilityState.selected), [false, false, true, false, false]);
  assert.ok(items.every((node) => node.props.accessibilityRole === 'tab'));
  assert.deepEqual(items.map((node) => node.props['aria-selected']), [false, false, true, false, false]);
  assert.deepEqual(
    items.map((node) => node.props.accessibilityLabel),
    ['Volume, tab, 1 of 5', 'History, tab, 2 of 5', 'Workout', 'Exercises, tab, 4 of 5', 'Diet, tab, 5 of 5'],
  );
  // Every tab, the middle one included, draws its title as one plain Text label.
  const contents = items.map((node) => renderItem(node, { pressed: false }));
  assert.deepEqual(contents.flatMap((content) => h.texts(content)), ['Volume', 'History', 'Workout', 'Exercises', 'Diet']);
  assert.ok(h.nodes(tree).some((node) => node.props?.role === 'tablist'));
});

test('floating bar: tabPress is emitted, a preventDefault stops the navigation, the focused tab is not re-navigated', () => {
  const world = renderBar();
  const items = pressables(world.render());
  items[0].props.onPress();
  assert.deepEqual(world.calls, [['emit', 'tabPress', 'volume-key'], ['dispatch', 'volume', 'tabs']]);

  world.calls.length = 0;
  items[2].props.onPress(); // already focused
  assert.deepEqual(world.calls, [['emit', 'tabPress', 'index-key']]);

  world.calls.length = 0;
  items[4].props.onLongPress();
  assert.deepEqual(world.calls, [['emit', 'tabLongPress', 'diet-key']]);

  const prevented = renderBar({ prevent: true });
  pressables(prevented.render())[1].props.onPress();
  assert.deepEqual(prevented.calls, [['emit', 'tabPress', 'history-key']]);
});

test('floating bar: pressed feedback applies to the button and its content', () => {
  const world = renderBar();
  const [volume, , middle] = pressables(world.render());
  const idle = volume.props.style({ pressed: false }).filter(Boolean);
  const pressed = volume.props.style({ pressed: true }).filter(Boolean);
  assert.equal(pressed.length, idle.length + 1);
  assert.deepEqual(h.plain(pressed[pressed.length - 1]), { backgroundColor: 'P' });
  // The selected tab keeps its highlight while pressed (no background swap), but its content still dims.
  assert.equal(middle.props.style({ pressed: true }).filter(Boolean).length, middle.props.style({ pressed: false }).filter(Boolean).length);
  const content = (node, p) => renderItem(node, p).props.style.filter(Boolean);
  assert.equal(content(volume, { pressed: true }).length, content(volume, { pressed: false }).length + 1);
});

test('floating bar: the highlight appears once the focused tab is measured, follows the selection, and is hidden on a hidden route', () => {
  const world = renderBar({ index: 0 });
  let tree = world.render();
  const highlightOf = (t) => h.nodes(t).find((node) => node.props?.testID === 'tab-selected-highlight');
  assert.equal(highlightOf(tree), undefined); // nothing measured yet
  pressables(tree).forEach((node, i) => node.props.onLayout({ nativeEvent: { layout: { x: i * 50, width: 50 } } }));
  tree = world.render();
  assert.ok(highlightOf(tree), 'highlight drawn for the focused tab');
  assert.equal(world.animations.length, 0); // first placement is immediate

  // Selecting another tab slides the same highlight there (left and width both animate).
  world.props.state.index = 3;
  tree = world.render();
  assert.ok(highlightOf(tree));
  assert.equal(world.animations.length, 1);
  assert.deepEqual(h.plain(world.animations[0].map((a) => [a.config.toValue, a.config.useNativeDriver])), [[150, false], [50, false]]);

  const hidden = renderBar({ focusedHidden: true });
  let t3 = hidden.render();
  pressables(t3).forEach((node, i) => node.props.onLayout({ nativeEvent: { layout: { x: i * 50, width: 50 } } }));
  t3 = hidden.render();
  assert.equal(highlightOf(t3), undefined);
});

test('floating bar: the pill rides above the home indicator and beside the screen edges', () => {
  const world = renderBar();
  const pill = h.nodes(world.render())[0];
  const [, container] = pill.props.style;
  assert.deepEqual(h.plain(container), { marginHorizontal: 12, marginBottom: 26, marginTop: 8 });
});
