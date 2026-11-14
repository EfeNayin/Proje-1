/**
 * The title bar the tabs draw for themselves (the tab navigator's own header is
 * off, see app/(app)/(tabs)/_layout.tsx). Same look as the bars the Volume and
 * Profile tabs already had: the page colour, a large bold title, and the top
 * safe-area inset so it clears the notch / Dynamic Island.
 *
 * The title shrinks and wraps rather than clipping at larger text sizes, and a
 * trailing control keeps its 44pt touch target.
 */

import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { light } from "../lightTheme";

export function TabTopBar({ title, trailing }: { title: string; trailing?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top }]}>
      <View style={styles.row}>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {trailing}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: light.background, paddingHorizontal: 16 },
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: 12,
  },
  title: { flexShrink: 1, color: light.text, fontSize: 28, fontWeight: "700" },
});
