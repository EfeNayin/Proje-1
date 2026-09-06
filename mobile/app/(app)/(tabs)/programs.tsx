/**
 * Programs: a user's named collections of training-day templates.
 *
 * A dedicated tab rather than folded into Training: programs are something
 * you set up occasionally and refer back to, not something you touch every
 * session — closer in spirit to Volume than to the logging flow.
 */

import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import * as programsApi from "../../../src/api/programs";
import type { ProgramSummary } from "../../../src/api/programs";
import { colors, radius, spacing } from "../../../src/theme";

export default function ProgramsScreen() {
  const router = useRouter();
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPrograms(await programsApi.listPrograms());
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      load()
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [load]),
  );

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;

    setCreating(true);
    setError(null);
    try {
      const program = await programsApi.createProgram(name);
      setNewName("");
      router.push(`/program/${program.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the program");
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={programs}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={
        <View>
          <View style={styles.form}>
            <TextInput
              style={styles.input}
              value={newName}
              onChangeText={setNewName}
              placeholder="New program name"
              placeholderTextColor={colors.textMuted}
              returnKeyType="done"
              onSubmitEditing={() => void handleCreate()}
            />
            <Pressable style={styles.addButton} onPress={() => void handleCreate()} disabled={creating}>
              {creating ? (
                <ActivityIndicator color={colors.accentText} size="small" />
              ) : (
                <Text style={styles.addButtonText}>Create</Text>
              )}
            </Pressable>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.empty}>No programs yet. Create one to plan your training days.</Text>
      }
      renderItem={({ item }) => (
        <Pressable style={styles.card} onPress={() => router.push(`/program/${item.id}`)}>
          <Text style={styles.cardTitle}>{item.name}</Text>
          {item.is_active ? (
            <View style={styles.activeBadge}>
              <Text style={styles.activeBadgeText}>Active</Text>
            </View>
          ) : null}
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  form: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
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
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  addButtonText: { color: colors.accentText, fontSize: 15, fontWeight: "700" },
  error: { color: colors.danger, marginBottom: spacing.md },
  empty: { color: colors.textMuted, textAlign: "center", marginTop: spacing.lg },
  card: {
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
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
  activeBadge: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  activeBadgeText: { color: colors.accentText, fontSize: 11, fontWeight: "700" },
});
