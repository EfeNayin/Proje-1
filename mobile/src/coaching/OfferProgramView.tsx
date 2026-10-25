import { StyleSheet, Text, View } from "react-native";

import type { OfferProgram } from "../api/coaching";
import { roman, romanFont } from "../romanTheme";
import { exerciseCount, prescriptionText, summaryText } from "./offerDisplay";

/**
 * A program as it is offered: its days and every exercise's prescription,
 * read-only. Used for what a coach is about to send and for what an athlete is
 * about to accept, so both sides read the same thing.
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
                accessibilityLabel={`${exercise.exercise_name}, ${prescriptionText(exercise)}`}
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
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  title: { color: roman.text, fontFamily: romanFont.semibold, fontSize: 18, lineHeight: 24 },
  dayTitle: { color: roman.goldLight, fontFamily: romanFont.semibold, fontSize: 15, lineHeight: 21 },
  meta: { color: roman.textMuted, fontFamily: romanFont.regular, fontSize: 13, lineHeight: 19 },
  notes: { color: roman.textMuted, fontFamily: romanFont.regular, fontSize: 14, lineHeight: 20 },
  exercise: { gap: 2, paddingTop: 8, borderTopColor: roman.border, borderTopWidth: 1 },
  exerciseName: { color: roman.text, fontFamily: romanFont.medium, fontSize: 15, lineHeight: 21 },
  prescription: { color: roman.textMuted, fontFamily: romanFont.regular, fontSize: 14 },
});
