import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { roman, romanFont } from "../romanTheme";
import { feedbackTimeLines } from "./feedbackDisplay";
import { FEEDBACK_MAX_LENGTH } from "./workoutFeedback";
import type { WorkoutFeedbackState } from "./workoutFeedback";
import { workoutFeedbackStore } from "./workoutFeedbackSession";

const MIN_TOUCH = 44;

/**
 * The coach's feedback on this workout, below the athlete's read-only data.
 *
 * Only the coach's own text is editable here; the workout above it stays
 * read-only. Saving and deleting each ask first, and saving says plainly that
 * the athlete will be able to read the text.
 */
export function CoachFeedbackSection({
  state,
  athleteName,
}: {
  state: WorkoutFeedbackState;
  athleteName: string;
}) {
  const store = workoutFeedbackStore;
  const busy = state.saving || state.deleting;

  const confirmSave = () => {
    Alert.alert(
      "Save feedback?",
      `${athleteName} will be able to read this feedback in their own workout.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Save feedback", onPress: () => void store.save() },
      ],
    );
  };
  const confirmDelete = () => {
    Alert.alert(
      "Delete feedback?",
      `${athleteName} will no longer see it. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void store.remove() },
      ],
    );
  };

  return (
    <View style={styles.card} testID="coach-feedback-section">
      <Text accessibilityRole="header" style={styles.heading}>
        Your feedback
      </Text>
      <Text style={styles.note}>
        {athleteName} can see feedback you save here. The workout above stays read-only.
      </Text>
      <Body
        state={state}
        busy={busy}
        onEdit={() => store.startEditing()}
        onDelete={confirmDelete}
        onSave={confirmSave}
      />
    </View>
  );
}

function Body({
  state,
  busy,
  onEdit,
  onDelete,
  onSave,
}: {
  state: WorkoutFeedbackState;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onSave: () => void;
}) {
  const store = workoutFeedbackStore;

  if (state.unavailable) {
    return (
      <Text accessibilityRole="alert" style={styles.note}>
        Feedback is no longer available for this workout.
      </Text>
    );
  }
  if (!state.loaded) {
    return state.loadError ? (
      <View style={styles.block}>
        <Text accessibilityRole="alert" style={styles.error}>
          Could not load your feedback.
        </Text>
        <Action label="Try again" onPress={() => void store.retryLoad()} />
      </View>
    ) : (
      <ActivityIndicator color={roman.gold} accessibilityLabel="Loading your feedback" />
    );
  }

  if (state.conflict) {
    const { conflict } = state;
    return (
      <View style={styles.block}>
        <Text accessibilityRole="alert" style={styles.error}>
          This feedback changed since you opened it.
        </Text>
        {!conflict.loaded ? (
          <>
            <Text style={styles.note}>Could not load the latest version yet.</Text>
            <Action label="Try again" onPress={() => void store.retryConflict()} />
          </>
        ) : (
          <>
            <Text style={styles.label}>Latest version</Text>
            {conflict.latest ? (
              <>
                <Text style={styles.body}>{conflict.latest.body}</Text>
                {feedbackTimeLines(conflict.latest.created_at, conflict.latest.updated_at).map(
                  (line) => (
                    <Text key={line} style={styles.meta}>
                      {line}
                    </Text>
                  ),
                )}
              </>
            ) : (
              <Text style={styles.note}>This feedback was deleted.</Text>
            )}
            {conflict.action === "save" ? (
              <Action
                label="Keep my text and review"
                hint="Keeps your draft; you then save it again on purpose"
                onPress={() => store.keepMine()}
              />
            ) : null}
            <Action label="Use the latest" onPress={() => store.useLatest()} />
          </>
        )}
      </View>
    );
  }

  if (state.editing) {
    const length = state.draft.length;
    return (
      <View style={styles.block}>
        <TextInput
          accessibilityLabel="Feedback text"
          multiline
          value={state.draft}
          onChangeText={(text) => store.setDraft(text)}
          editable={!busy}
          maxLength={FEEDBACK_MAX_LENGTH}
          placeholder="What went well, what to change next time"
          placeholderTextColor={roman.placeholder}
          textAlignVertical="top"
          scrollEnabled={false}
          style={styles.input}
        />
        <Text
          accessibilityLabel={`${length} of ${FEEDBACK_MAX_LENGTH} characters`}
          style={[styles.meta, length >= FEEDBACK_MAX_LENGTH && styles.warn]}
        >
          {length}/{FEEDBACK_MAX_LENGTH}
        </Text>
        {state.error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {state.error}
          </Text>
        ) : null}
        <View style={styles.row}>
          <Action label="Cancel" onPress={() => store.cancelEditing()} disabled={busy} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={state.saving ? "Saving feedback" : "Save feedback"}
            accessibilityState={{ busy: state.saving, disabled: busy }}
            disabled={busy}
            style={({ pressed }) => [
              styles.primary,
              pressed && styles.primaryPressed,
              busy && styles.disabled,
            ]}
            onPress={onSave}
          >
            {state.saving ? (
              <ActivityIndicator color={roman.background} />
            ) : (
              <Text style={styles.primaryText}>Save</Text>
            )}
          </Pressable>
        </View>
      </View>
    );
  }

  if (state.saved) {
    return (
      <View style={styles.block}>
        <Text selectable style={styles.body}>
          {state.saved.body}
        </Text>
        {feedbackTimeLines(state.saved.created_at, state.saved.updated_at).map((line) => (
          <Text key={line} style={styles.meta}>
            {line}
          </Text>
        ))}
        {state.error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {state.error}
          </Text>
        ) : null}
        <View style={styles.row}>
          <Action label="Edit" onPress={onEdit} disabled={busy} />
          <Action
            label={state.deleting ? "Deleting…" : "Delete"}
            onPress={onDelete}
            disabled={busy}
            danger
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.block}>
      <Text style={styles.note}>You have not left feedback on this workout.</Text>
      <Action label="Write feedback" onPress={onEdit} />
    </View>
  );
}

function Action({
  label,
  hint,
  onPress,
  disabled = false,
  danger = false,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={({ pressed }) => [styles.action, pressed && styles.pressed, disabled && styles.disabled]}
      onPress={onPress}
    >
      <Text style={[styles.actionText, danger && styles.dangerText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: roman.surface,
    borderColor: roman.goldLight,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    gap: 8,
  },
  heading: { color: roman.text, fontFamily: romanFont.semibold, fontSize: 16, lineHeight: 22 },
  block: { gap: 8 },
  note: { color: roman.textMuted, fontFamily: romanFont.regular, fontSize: 13, lineHeight: 19 },
  label: { color: roman.goldLight, fontFamily: romanFont.medium, fontSize: 12 },
  body: { color: roman.text, fontFamily: romanFont.regular, fontSize: 15, lineHeight: 22 },
  meta: { color: roman.textMuted, fontFamily: romanFont.regular, fontSize: 12, lineHeight: 18 },
  warn: { color: roman.goldLight },
  error: { color: roman.danger, fontFamily: romanFont.medium, fontSize: 14, lineHeight: 20 },
  input: {
    minHeight: 120,
    color: roman.text,
    fontFamily: romanFont.regular,
    fontSize: 15,
    lineHeight: 22,
    backgroundColor: roman.background,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 },
  action: {
    minHeight: MIN_TOUCH,
    justifyContent: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  actionText: { color: roman.goldLight, fontFamily: romanFont.semibold, fontSize: 14 },
  dangerText: { color: roman.danger },
  pressed: { backgroundColor: roman.surfaceRaised },
  disabled: { opacity: 0.5 },
  primary: {
    minHeight: MIN_TOUCH,
    minWidth: 96,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: roman.gold,
    borderRadius: 10,
    paddingHorizontal: 20,
  },
  primaryPressed: { backgroundColor: roman.goldPressed },
  primaryText: {
    color: roman.background,
    fontFamily: romanFont.semibold,
    fontSize: 14,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
});
