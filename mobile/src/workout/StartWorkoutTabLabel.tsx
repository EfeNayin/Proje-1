import { type ColorValue, StyleSheet, Text, View } from "react-native";

/**
 * Height of the tab bar above the bottom safe area. The stock bar is 49 pt, which
 * holds an icon and ONE line of label; the middle tab spells "Start Workout" on
 * two lines, so the bar gets the extra room instead of the label getting a smaller
 * font. The safe-area inset is added on top of this by the layout.
 */
export const TAB_BAR_CONTENT_HEIGHT = 64;

/**
 * "Start" over "Workout", under the middle icon. One line of "Start Workout" does
 * not fit a fifth of a 320 pt screen at font size 10 and would be cut with an
 * ellipsis; two short lines always fit. Same size and weight as the other labels
 * (font size 10, no Dynamic Type scaling, as in the layout's screenOptions).
 *
 * The tab's spoken name stays "Start Workout" (tabBarAccessibilityLabel), so the
 * two lines are one label for a screen reader, not two words read apart.
 */
export function StartWorkoutTabLabel({ color }: { color: ColorValue }) {
  return (
    <View style={styles.stack}>
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.line, { color }]}>
        Start
      </Text>
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.line, { color }]}>
        Workout
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { alignItems: "center" },
  line: { fontSize: 10, lineHeight: 12, fontWeight: "500", textAlign: "center" },
});
