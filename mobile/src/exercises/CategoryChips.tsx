/**
 * The category chips shared by the workout exercise picker and the Exercises tab.
 *
 * Tapping the already-selected chip clears it, same as the rating dots on the
 * check-in screen: there must be a way back to "browsing everything" without a
 * separate "All" chip taking up space of its own.
 */

import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

import type { Category } from "../api/exercises";
import { light } from "../lightTheme";
import { radius, spacing } from "../theme";
import { CATEGORIES } from "./categories";

export function CategoryChips({
  value,
  onChange,
}: {
  value: Category | null;
  onChange: (next: Category | null) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.categories}
      contentContainerStyle={styles.categoriesContent}
      keyboardShouldPersistTaps="handled"
    >
      {CATEGORIES.map(({ code, label }) => {
        const selected = value === code;
        return (
          <Pressable
            key={code}
            accessibilityRole="button"
            accessibilityLabel={`${label} category`}
            accessibilityState={{ selected }}
            onPress={() => onChange(selected ? null : code)}
            style={[styles.chip, selected && styles.chipActive]}
          >
            {/* The row has a fixed height (see styles); capping the scale keeps the label inside its chip. */}
            <Text
              maxFontSizeMultiplier={1.3}
              style={[styles.chipText, selected && styles.chipTextActive]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // A horizontal ScrollView has no intrinsic height of its own — without one
  // set here, its cross-axis size is ambiguous and each chip's rounded
  // background stretches to fill it (default cross-axis alignItems is
  // "stretch"), which is what made the pills render as a cut-off, ghosted
  // sliver instead of a clean rounded chip. A fixed height plus centering
  // the row's content removes that ambiguity.
  categories: { flexGrow: 0, height: 44, marginBottom: spacing.md },
  categoriesContent: { gap: spacing.sm, paddingRight: spacing.md, alignItems: "center" },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderColor: light.separator,
    borderWidth: 1,
    backgroundColor: light.surface,
    alignSelf: "center",
  },
  chipActive: { backgroundColor: light.primary, borderColor: light.primary },
  chipText: { color: light.textSecondary, fontSize: 14, fontWeight: "600" },
  chipTextActive: { color: light.onPrimary },
});
