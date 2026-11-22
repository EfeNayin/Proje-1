import { type ColorValue, StyleSheet, Text } from "react-native";

/**
 * "Start Workout" on ONE line under the middle icon, at the same size and weight as the
 * other tab labels (font size 10, medium, no Dynamic Type scaling).
 *
 * The longest label is the only one that is wider than a fifth of a small iPhone, so
 * this tab alone gets the room (see the middle tab's tabBarItemStyle in the layout: no
 * side padding and a larger share of the bar). If a device or font is still a little
 * too narrow, adjustsFontSizeToFit shrinks the text just enough to stay on one line,
 * rather than clipping it or ending it with an ellipsis; at 10 it is left untouched.
 *
 * The tab's spoken name is set separately (tabBarAccessibilityLabel).
 */
export function StartWorkoutTabLabel({ color }: { color: ColorValue }) {
  return (
    <Text
      allowFontScaling={false}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.8}
      style={[styles.label, { color }]}
    >
      Start Workout
    </Text>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 10, fontWeight: "500", textAlign: "center" },
});
