/**
 * Program detail: rename, activate/delete, and manage its templates.
 *
 * Templates are the "days" of the program (Push A, Pull A...). Adding one
 * only asks for a name; targets are set afterward in the template editor,
 * where the exercise picker is available.
 */

import { Ionicons } from "@expo/vector-icons";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import * as programsApi from "../../../src/api/programs";
import type { ProgramDetail } from "../../../src/api/programs";
import { colors, radius, spacing } from "../../../src/theme";

/** The program's name, edited in place. Saved on blur, matching the workout title field. */
function NameField({ value, onSave }: { value: string; onSave: (name: string) => void }) {
  const [draft, setDraft] = useState(value);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "" || trimmed === value) return;
    onSave(trimmed);
  };

  return (
    <TextInput
      style={styles.nameInput}
      value={draft}
      onChangeText={setDraft}
      onBlur={commit}
      onSubmitEditing={commit}
      returnKeyType="done"
      maxLength={200}
    />
  );
}

export default function ProgramScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [program, setProgram] = useState<ProgramDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [addingTemplate, setAddingTemplate] = useState(false);
  const [activating, setActivating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setProgram(await programsApi.getProgram(id));
  }, [id]);

  // Re-run on every focus, not just on mount: returning from the template
  // editor after a save is how this screen learns the exercise counts
  // changed — that refresh IS the save's success confirmation.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      load()
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : "Could not load program");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [load]),
  );

  const handleSaveName = async (name: string) => {
    try {
      setProgram(await programsApi.updateProgram(id, { name }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename the program");
    }
  };

  const handleActivate = async () => {
    setActivating(true);
    try {
      setProgram(await programsApi.activateProgram(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not activate the program");
    } finally {
      setActivating(false);
    }
  };

  const handleDelete = () => {
    Alert.alert("Delete program?", "Its templates will be deleted too.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          setDeleting(true);
          programsApi
            .deleteProgram(id)
            .then(() => router.back())
            .catch((err) => {
              setDeleting(false);
              setError(err instanceof Error ? err.message : "Could not delete the program");
            });
        },
      },
    ]);
  };

  const handleAddTemplate = async () => {
    const name = newTemplateName.trim();
    if (!name || !program) return;

    setAddingTemplate(true);
    try {
      await programsApi.createTemplate(id, {
        name,
        day_order: program.templates.length,
      });
      setNewTemplateName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the template");
    } finally {
      setAddingTemplate(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!program) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error ?? "Program not found"}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen
        options={{
          title: program.name,
          headerRight: () => (
            <Pressable onPress={handleDelete} disabled={deleting} hitSlop={8}>
              {deleting ? (
                <ActivityIndicator size="small" color={colors.danger} />
              ) : (
                <Ionicons name="trash-outline" size={20} color={colors.danger} />
              )}
            </Pressable>
          ),
        }}
      />

      <NameField key={program.name} value={program.name} onSave={(name) => void handleSaveName(name)} />

      {program.is_active ? (
        <View style={styles.activeBadge}>
          <Text style={styles.activeBadgeText}>Active program</Text>
        </View>
      ) : (
        <Pressable style={styles.activateButton} onPress={() => void handleActivate()} disabled={activating}>
          {activating ? (
            <ActivityIndicator color={colors.accentText} size="small" />
          ) : (
            <Text style={styles.activateButtonText}>Make this the active program</Text>
          )}
        </Pressable>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.sectionTitle}>Templates</Text>

      {program.templates.map((template) => (
        <Pressable
          key={template.id}
          style={styles.templateCard}
          onPress={() => router.push(`/program/template/${template.id}`)}
        >
          <View style={styles.templateMain}>
            <Text style={styles.templateName}>{template.name}</Text>
            <Text style={styles.templateMeta}>
              {template.exercises.length} exercise{template.exercises.length === 1 ? "" : "s"}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Pressable>
      ))}

      {program.templates.length === 0 ? (
        <Text style={styles.empty}>No templates yet. Add a training day below.</Text>
      ) : null}

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          value={newTemplateName}
          onChangeText={setNewTemplateName}
          placeholder="e.g. Push A"
          placeholderTextColor={colors.textMuted}
          returnKeyType="done"
          onSubmitEditing={() => void handleAddTemplate()}
        />
        <Pressable style={styles.addButton} onPress={() => void handleAddTemplate()} disabled={addingTemplate}>
          {addingTemplate ? (
            <ActivityIndicator color={colors.accentText} size="small" />
          ) : (
            <Ionicons name="add" size={20} color={colors.accentText} />
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  nameInput: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    paddingVertical: spacing.sm,
  },
  activeBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginBottom: spacing.md,
  },
  activeBadgeText: { color: colors.accentText, fontSize: 12, fontWeight: "700" },
  activateButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.sm,
    alignItems: "center",
    marginBottom: spacing.md,
  },
  activateButtonText: { color: colors.accent, fontSize: 14, fontWeight: "600" },
  error: { color: colors.danger, marginBottom: spacing.md },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  templateCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  templateMain: { flex: 1 },
  templateName: { color: colors.text, fontSize: 16, fontWeight: "600" },
  templateMeta: { color: colors.textMuted, fontSize: 13 },
  empty: { color: colors.textMuted, marginBottom: spacing.md },
  form: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  addButton: {
    width: 44,
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
});
