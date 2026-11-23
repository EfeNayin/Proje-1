import type { BottomTabBarProps } from "expo-router/js-tabs";
import { StyleSheet, View } from "react-native";

import { light } from "../lightTheme";
import { FloatingTabBar } from "./FloatingTabBar";
import { RestTimerStrip } from "./RestTimerPill";

/**
 * The floating pill tab bar with the rest-timer strip stacked on top of it. The
 * strip is part of the bar's own layout, so the screens above shrink by its
 * height while a countdown runs instead of being covered by it. The wrapper
 * paints the screen background, so the space around the pill is not see-through.
 */
export function TabBarWithRestTimer(props: BottomTabBarProps) {
  return (
    <View style={styles.wrapper}>
      <RestTimerStrip />
      <FloatingTabBar {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { backgroundColor: light.background },
});
