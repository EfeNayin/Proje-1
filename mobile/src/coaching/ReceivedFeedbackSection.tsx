import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import type { ReceivedFeedback } from "../api/coaching";
import { light } from "../lightTheme";
import { feedbackTimeLines } from "./feedbackDisplay";
import { personHandle, personName } from "./presentation";
import type { ReceivedFeedbackState } from "./receivedFeedback";
import { receivedFeedbackStore } from "./receivedFeedbackSession";
import { useReceivedFeedback } from "./useReceivedFeedback";

const MIN_TOUCH = 44;

/**
 * Coach feedback inside the athlete's own finished workout: who wrote it, when,
 * and the text. Clearly apart from the athlete's own sets and notes, and with
 * nothing to edit. Re-read whenever the workout screen comes into focus.
 */
export function ReceivedFeedbackSection({
  userId,
  workoutId,
}: {
  userId: string | null;
  workoutId: string;
}) {
  const state = useReceivedFeedback(userId, workoutId);

  useFocusEffect(
    useCallback(() => {
      if (userId) void receivedFeedbackStore.load({ userId, workoutId });
    }, [userId, workoutId]),
  );

  const retry = () => {
    if (userId) void receivedFeedbackStore.load({ userId, workoutId });
  };

  return <ReceivedFeedbackView state={state} onRetry={retry} />;
}

export function ReceivedFeedbackView({
  state,
  onRetry,
}: {
  state: ReceivedFeedbackState;
  onRetry: () => void;
}) {
  // Nothing at all until there is something to say: no empty "Coach feedback" box.
  if (!state.loaded && !state.error) {
    return state.loading ? (
      <ActivityIndicator color={light.textSecondary} accessibilityLabel="Loading coach feedback" />
    ) : null;
  }
  if (state.loaded && state.items.length === 0 && !state.error) return null;

  return (
    <View style={styles.section} testID="received-feedback-section">
      <Text accessibilityRole="header" style={styles.heading}>
        Coach feedback
      </Text>
      <Text style={styles.note}>
        Written by your coach. This is not part of your workout log.
      </Text>
      {state.error ? (
        <View style={styles.block}>
          <Text accessibilityRole="alert" style={styles.error}>
            {state.error}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try loading coach feedback again"
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
            onPress={onRetry}
          >
            <Text style={styles.actionText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
      {state.items.map((item) => (
        <Entry key={item.id} item={item} />
      ))}
    </View>
  );
}

function Entry({ item }: { item: ReceivedFeedback }) {
  const handle = personHandle(item.coach);
  const times = feedbackTimeLines(item.created_at, item.updated_at);
  return (
    <View
      accessible
      accessibilityLabel={`Feedback from ${personName(item.coach)}. ${item.body}. ${times.join(". ")}`}
      style={styles.entry}
    >
      <Text style={styles.author}>
        {personName(item.coach)}
        {handle ? <Text style={styles.handle}>{`  ${handle}`}</Text> : null}
      </Text>
      <Text selectable style={styles.body}>
        {item.body}
      </Text>
      {times.map((line) => (
        <Text key={line} style={styles.meta}>
          {line}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: light.surface,
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    marginBottom: 16,
    gap: 8,
  },
  heading: { color: light.text, fontSize: 17, fontWeight: "600", lineHeight: 22 },
  note: { color: light.textSecondary, fontSize: 13, lineHeight: 19 },
  block: { gap: 4 },
  entry: {
    gap: 4,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: light.separator,
  },
  author: { color: light.text, fontSize: 14, fontWeight: "600", lineHeight: 20 },
  handle: { color: light.textSecondary, fontSize: 12, fontWeight: "400" },
  body: { color: light.text, fontSize: 15, lineHeight: 22 },
  meta: { color: light.textSecondary, fontSize: 12, lineHeight: 18 },
  error: { color: light.danger, fontSize: 14, fontWeight: "500", lineHeight: 20 },
  action: { minHeight: MIN_TOUCH, justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: 4, borderRadius: 8 },
  actionText: { color: light.text, fontSize: 14, fontWeight: "600" },
  pressed: { backgroundColor: light.pressed },
});
