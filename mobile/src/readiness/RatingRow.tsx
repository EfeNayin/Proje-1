import { Pressable, StyleSheet, Text, View } from "react-native";

import { light } from "../lightTheme";

/** A 1-5 choice. Tapping the selected value clears it: every field is optional. */
export function RatingRow({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.ratingRow}>
      <Text style={styles.ratingLabel}>{label}</Text>
      <View style={styles.ratingOptions}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            accessibilityRole="button"
            accessibilityLabel={`${label}, ${n} of 5`}
            accessibilityState={{ selected: value === n, disabled }}
            disabled={disabled}
            style={[styles.ratingDot, value === n && styles.ratingDotActive]}
            onPress={() => onChange(value === n ? null : n)}
          >
            <Text style={[styles.ratingDotText, value === n && styles.ratingDotTextActive]}>{n}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The label sits above its five choices so long names and larger text wrap
  // instead of squeezing the buttons.
  ratingRow: { marginBottom: 20 },
  ratingLabel: { color: light.text, fontSize: 15, lineHeight: 20, marginBottom: 8 },
  ratingOptions: { flexDirection: "row", gap: 8 },
  ratingDot: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: light.surface,
    borderColor: light.separator,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  ratingDotActive: { backgroundColor: light.primary, borderColor: light.primary },
  ratingDotText: { color: light.text, fontSize: 15, fontWeight: "600" },
  ratingDotTextActive: { color: light.onPrimary },
});
