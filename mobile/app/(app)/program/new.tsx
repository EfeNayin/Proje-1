/**
 * New program: the creation form that used to be the top card of the Programs tab.
 *
 * A screen of its own, reached from "Create program" on Start Workout and from
 * "Create a program" in the workout's Save as template sheet. A pushed screen
 * (rather than a form inside a tab) means Back always returns to whoever opened
 * it — including an unfinished workout — and the keyboard never has to share a
 * tab with the rest-timer strip.
 *
 * createProgramCreator is the same action the Programs tab used: the name is
 * trimmed, an empty one is not sent, and a second submit while one is running
 * (keyboard Done followed by the button) is ignored. On success the new
 * program's own screen replaces this one, so Back from it skips this form.
 */

import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import * as programsApi from "../../../src/api/programs";
import { light } from "../../../src/lightTheme";
import { createProgramCreator } from "../../../src/programs/programActions";

export default function NewProgramScreen() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitCreate = useMemo(() => createProgramCreator(programsApi.createProgram), []);

  const handleCreate = async () => {
    setError(null);
    const outcome = await submitCreate(name, () => setCreating(true));
    if (outcome.kind === "ignored") return; // the running request owns the busy state
    setCreating(false);
    if (outcome.kind === "invalid" || outcome.kind === "failed") {
      // The typed name stays, so retrying is one tap.
      setError(outcome.message);
      return;
    }
    router.replace(`/program/${outcome.value.id}`);
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      // iOS pushes content up; Android already resizes the window.
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Program name</Text>
        <TextInput
          style={styles.input}
          accessibilityLabel="New program name"
          value={name}
          onChangeText={setName}
          placeholder="Program name (e.g. Push Pull Legs)"
          placeholderTextColor={light.textSecondary}
          selectionColor={light.text}
          returnKeyType="done"
          maxLength={200}
          autoFocus
          editable={!creating}
          onSubmitEditing={() => void handleCreate()}
        />
        <Text style={styles.hint}>
          You will add training days (templates) and their exercises on the next screen.
        </Text>
        {error ? (
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>
            {error}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create this program"
          accessibilityState={{ busy: creating, disabled: creating }}
          disabled={creating}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            creating && styles.buttonBusy,
          ]}
          onPress={() => void handleCreate()}
        >
          {creating ? (
            <ActivityIndicator color={light.onPrimary} size="small" />
          ) : (
            <View style={styles.buttonRow}>
              <Ionicons name="add" size={18} color={light.onPrimary} />
              <Text style={styles.buttonText}>Create</Text>
            </View>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background },
  content: { padding: 16 },
  label: { color: light.text, fontSize: 17, fontWeight: "600", marginBottom: 12 },
  input: {
    minHeight: 48,
    backgroundColor: light.surface,
    borderRadius: 10,
    color: light.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  hint: { color: light.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 10 },
  error: { color: light.danger, fontSize: 14, fontWeight: "500", marginTop: 10 },
  button: {
    minHeight: 52,
    marginTop: 16,
    backgroundColor: light.primary,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonPressed: { backgroundColor: light.primaryPressed },
  buttonBusy: { opacity: 0.6 },
  buttonRow: { flexDirection: "row", alignItems: "center", columnGap: 8 },
  buttonText: { color: light.onPrimary, fontSize: 17, fontWeight: "600" },
});
