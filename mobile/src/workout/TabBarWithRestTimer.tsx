import { BottomTabBar, type BottomTabBarProps } from "expo-router/js-tabs";
import { View } from "react-native";

import { RestTimerStrip } from "./RestTimerPill";

/**
 * The ordinary tab bar with the rest-timer strip stacked on top of it. The
 * strip is part of the bar's own layout, so the screens above shrink by its
 * height while a countdown runs instead of being covered by it.
 */
export function TabBarWithRestTimer(props: BottomTabBarProps) {
  return (
    <View>
      <RestTimerStrip />
      <BottomTabBar {...props} />
    </View>
  );
}
