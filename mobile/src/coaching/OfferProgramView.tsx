import { StyleSheet, Text, View } from "react-native";

import type { OfferProgram } from "../api/coaching";
import { light } from "../lightTheme";
import { exerciseCount, prescriptionText, summaryText } from "./offerDisplay";

/**
 * A program as it is offered: its days and every exercise's prescription,
 * read-only. Used for what a coach is about to send and for what an athlete is
 * about to accept, so both sides read the same thing.
 *
 * Nothing here is shortened: names wrap and notes are shown whole, because a
 * prescription or note cut off at the end of a line is a different instruction.
 */
export function OfferProgramView({ program }: { program: OfferProgram }) {
  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.title}>
          {program.name}
        </Text>
        <Text style={styles.meta}>
          {summaryText(program.templates.length, exerciseCount(program))}
        </Text>
        {program.notes ? <Text style={styles.notes}>{program.notes}</Text> : null}
      </View>

      {program.templates.map((template, index) => (
        <View key={`${index}:${template.name}`} style={styles.card}>
          <Text accessibilityRole="header" style={styles.dayTitle}>
            {template.name}
          </Text>
          {template.notes ? <Text style={styles.notes}>{template.notes}</Text> : null}
          {template.exercises.length === 0 ? (
            <Text style={styles.meta}>No exercises in this day.</Text>
          ) : (
            template.exercises.map((exercise, position) => (
              <View
                key={`${position}:${exercise.exercise_id}`}
                style={styles.exercise}
                accessible
                accessibilityLabel={`${exercise.exercise_name}, ${prescriptionText(exercise)}${
                  exercise.notes ? `. ${exercise.notes}` : ""
                }`}
              >
                <Text style={styles.exerciseName}>{exercise.exercise_name}</Text>
                <Text style={styles.prescription}>{prescriptionText(exercise)}</Text>
                {exercise.notes ? <Text style={styles.notes}>{exercise.notes}</Text> : null}
              </View>
            ))
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  card: {
    backgroundColor: light.surface,
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  title: { color: light.text, fontSize: 22, fontWeight: "700", lineHeight: 28 },
  dayTitle: { color: light.text, fontSize: 17, fontWeight: "600", lineHeight: 22 },
  meta: { color: light.textSecondary, fontSize: 13, lineHeight: 19 },
  notes: { color: light.textSecondary, fontSize: 14, lineHeight: 20 },
  exercise: {
    gap: 2,
    paddingTop: 10,
    borderTopColor: light.separator,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  exerciseName: { color: light.text, fontSize: 16, fontWeight: "500", lineHeight: 22 },
  prescription: { color: light.text, fontSize: 14, lineHeight: 20, fontVariant: ["tabular-nums"] },
});
