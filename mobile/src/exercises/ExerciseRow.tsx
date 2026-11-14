/**
 * One catalogue row, shared by the Exercises tab and the exercise picker.
 *
 * Two separate controls side by side, never one inside the other:
 *  - the row itself (thumbnail, name, primary muscles). What it does is the
 *    host's decision: open the details when browsing, choose when selecting.
 *  - the information button, which always opens the details and never chooses.
 */

import { Image } from "expo-image";
import type { ImageSource } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ExerciseSummary } from "../api/exercises";
import { light } from "../lightTheme";
import { primaryMuscleLabel } from "./exerciseFilters";

const MIN_TOUCH = 44;
const THUMBNAIL = 48;

/**
 * The picture slot. Decorative: the row's label already names the exercise, so
 * it is hidden from screen readers. Without a source it is a neutral box of the
 * same size, so rows line up whether or not an exercise has media.
 */
export function ExerciseThumbnail({ source }: { source?: ImageSource | number | null }) {
  return (
    <View
      testID="exercise-thumbnail"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.thumbnail}
    >
      {source ? <Image source={source} contentFit="contain" style={styles.thumbnailImage} /> : null}
    </View>
  );
}

export function ExerciseRow({
  exercise,
  mode,
  first,
  last,
  onPress,
  onInfo,
}: {
  exercise: ExerciseSummary;
  mode: "browse" | "select";
  first: boolean;
  last: boolean;
  onPress: () => void;
  onInfo: () => void;
}) {
  const muscles = primaryMuscleLabel(exercise);
  return (
    <View
      style={[
        styles.row,
        first && styles.rowFirst,
        last ? styles.rowLast : styles.rowDivider,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={muscles ? `${exercise.name}, ${muscles}` : exercise.name}
        accessibilityHint={mode === "select" ? "Adds this exercise" : "Opens the exercise details"}
        style={({ pressed }) => [styles.main, first && styles.mainFirst, last && styles.mainLast, pressed && styles.pressed]}
        onPress={onPress}
      >
        {/* No verified exercise media is bundled yet: every row shows the neutral slot. */}
        <ExerciseThumbnail source={null} />
        <View style={styles.text}>
          <Text numberOfLines={2} style={styles.title}>
            {exercise.name}
          </Text>
          {muscles ? <Text style={styles.muscles}>{muscles}</Text> : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`How to perform ${exercise.name}`}
        hitSlop={4}
        style={styles.info}
        onPress={onInfo}
      >
        {/* The control is named by its label; the glyph is decoration. */}
        <View accessible={false} style={styles.infoBadge}>
          <Text accessible={false} maxFontSizeMultiplier={1.3} style={styles.infoGlyph}>
            i
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "stretch", backgroundColor: light.surface },
  rowFirst: { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  rowLast: { borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
  rowDivider: { borderBottomColor: light.separator, borderBottomWidth: StyleSheet.hairlineWidth },
  main: {
    flex: 1,
    minWidth: 0,
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 12,
    paddingVertical: 8,
    paddingLeft: 12,
    paddingRight: 4,
  },
  mainFirst: { borderTopLeftRadius: 12 },
  mainLast: { borderBottomLeftRadius: 12 },
  pressed: { backgroundColor: light.pressed },
  thumbnail: {
    width: THUMBNAIL,
    height: THUMBNAIL,
    borderRadius: 8,
    backgroundColor: light.background,
    overflow: "hidden",
  },
  thumbnailImage: { width: THUMBNAIL, height: THUMBNAIL },
  text: { flex: 1, minWidth: 0, rowGap: 2 },
  title: { color: light.text, fontSize: 16, fontWeight: "600" },
  muscles: { color: light.textSecondary, fontSize: 13 },
  info: { minWidth: MIN_TOUCH + 8, minHeight: MIN_TOUCH, alignItems: "center", justifyContent: "center" },
  infoBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderColor: light.textSecondary,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  infoGlyph: { color: light.textSecondary, fontSize: 14, fontWeight: "700", fontStyle: "italic" },
});
