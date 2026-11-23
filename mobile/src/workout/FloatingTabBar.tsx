import type { BottomTabBarProps } from "expo-router/js-tabs";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { light } from "../lightTheme";

/**
 * The shared bottom navigation: ONE floating, fully rounded pill instead of the
 * full-width rectangular bar. It is still the navigator's tab bar (it receives the
 * same state, descriptors and navigation as the stock bar and is rendered by
 * TabBarWithRestTimer), so tab options in the layout (title, icon, label,
 * accessibility label, item style, tint colours) keep working.
 *
 * - It sits in the layout flow, below the screens, so it never covers their last
 *   row; the space around the pill is the screen background.
 * - The selected tab has a softly rounded highlight behind its icon AND label. The
 *   highlight is a single view that slides to the newly selected tab (or jumps there
 *   when the user prefers reduced motion).
 * - Every button gives pressed feedback and is at least 44 pt tall and wide.
 * - Press semantics are the stock bar's: tabPress is emitted (preventable) and only
 *   then, for a tab that is not already focused, the navigate action is dispatched;
 *   a long press emits tabLongPress.
 * - Routes hidden from the bar (href: null in the layout: Profile, Programs) are
 *   not drawn; while one of them is focused no tab is highlighted.
 */

const ICON_SIZE = 22;
const SLIDE_MS = 220;

type Layout = { x: number; width: number };

export function FloatingTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const [layouts, setLayouts] = useState<Record<string, Layout>>({});
  const reduceMotion = useReduceMotion();

  const visible = state.routes.filter((route) => {
    const flat = StyleSheet.flatten(descriptors[route.key].options.tabBarItemStyle);
    return flat?.display !== "none";
  });
  const focusedKey = state.routes[state.index]?.key;
  const activeLayout = visible.some((route) => route.key === focusedKey)
    ? layouts[focusedKey]
    : undefined;

  const [left] = useState(() => new Animated.Value(0));
  const [width] = useState(() => new Animated.Value(0));
  const placed = useRef(false);
  const target = activeLayout ? `${activeLayout.x}:${activeLayout.width}` : "";
  useEffect(() => {
    if (!activeLayout) return;
    if (!placed.current || reduceMotion) {
      // First placement (and reduced motion): no travel, the highlight is simply there.
      left.setValue(activeLayout.x);
      width.setValue(activeLayout.width);
      placed.current = true;
      return;
    }
    const slide = Animated.parallel(
      [left, width].map((value, i) =>
        Animated.timing(value, {
          toValue: i === 0 ? activeLayout.x : activeLayout.width,
          duration: SLIDE_MS,
          easing: Easing.out(Easing.cubic),
          // left/width are layout properties; the native driver cannot animate them.
          useNativeDriver: false,
        }),
      ),
    );
    slide.start();
    return () => slide.stop();
    // `target` carries the values of activeLayout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, reduceMotion, left, width]);

  const containerStyle = useMemo(
    () => ({
      marginHorizontal: 12 + Math.max(insets.left, insets.right),
      // The pill floats above the home indicator rather than sitting on the screen edge.
      marginBottom: Math.max(insets.bottom - 8, 12),
      marginTop: 8,
    }),
    [insets.bottom, insets.left, insets.right],
  );

  return (
    <View style={[styles.pill, containerStyle]}>
      <View role="tablist" accessibilityRole="tablist" style={styles.row}>
        {activeLayout ? (
          <Animated.View
            pointerEvents="none"
            testID="tab-selected-highlight"
            style={[styles.highlight, { left, width }]}
          />
        ) : null}
        {visible.map((route, index) => {
          const { options } = descriptors[route.key];
          const focused = route.key === focusedKey;
          const color = focused
            ? (options.tabBarActiveTintColor ?? light.text)
            : (options.tabBarInactiveTintColor ?? light.textSecondary);
          const title = options.title ?? route.name;

          const onPress = () => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              // The action CommonActions.navigate(name, params) builds. Expo Router does not
              // export CommonActions, and importing @react-navigation/native directly is
              // rejected by Metro since SDK 56.
              navigation.dispatch({
                type: "NAVIGATE",
                payload: { name: route.name, params: route.params },
                target: state.key,
              });
            }
          };
          const onLongPress = () => {
            navigation.emit({ type: "tabLongPress", target: route.key });
          };

          const label =
            typeof options.tabBarLabel === "function" ? (
              options.tabBarLabel({ focused, color, position: "below-icon", children: title })
            ) : (
              <Text
                allowFontScaling={options.tabBarAllowFontScaling ?? true}
                numberOfLines={1}
                style={[styles.label, { color }, options.tabBarLabelStyle]}
              >
                {options.tabBarLabel ?? title}
              </Text>
            );
          const accessibilityLabel =
            options.tabBarAccessibilityLabel ??
            (Platform.OS === "ios" ? `${title}, tab, ${index + 1} of ${visible.length}` : title);

          return (
            <Pressable
              key={route.key}
              role="tab"
              accessibilityRole="tab"
              aria-selected={focused}
              accessibilityState={{ selected: focused }}
              accessibilityLabel={accessibilityLabel}
              testID={options.tabBarButtonTestID}
              onPress={onPress}
              onLongPress={onLongPress}
              onLayout={(event) => {
                const { x, width: w } = event.nativeEvent.layout;
                setLayouts((previous) => {
                  const known = previous[route.key];
                  return known && known.x === x && known.width === w
                    ? previous
                    : { ...previous, [route.key]: { x, width: w } };
                });
              }}
              style={({ pressed }) => [
                styles.item,
                options.tabBarItemStyle,
                pressed && !focused && styles.itemPressed,
              ]}
            >
              {({ pressed }) => (
                <View style={[styles.content, pressed && styles.contentPressed]}>
                  {options.tabBarIcon?.({ focused, color, size: ICON_SIZE })}
                  {label}
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** The system "reduce motion" setting; the highlight then jumps instead of sliding. */
function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (active) setReduced(value);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

const styles = StyleSheet.create({
  pill: {
    padding: 4,
    borderRadius: 999,
    backgroundColor: light.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: light.separator,
    boxShadow: "0px 4px 16px rgba(0, 0, 0, 0.10)",
    elevation: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  highlight: {
    position: "absolute",
    top: 0,
    bottom: 0,
    borderRadius: 999,
    backgroundColor: light.separator,
  },
  item: {
    flex: 1,
    minHeight: 48,
    minWidth: 44,
    paddingHorizontal: 2,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  itemPressed: { backgroundColor: light.pressed },
  content: { alignItems: "center", justifyContent: "center", gap: 2 },
  contentPressed: { opacity: 0.55 },
  label: { fontSize: 10, fontWeight: "500", textAlign: "center" },
});
