/**
 * Programs: a user's named collections of training-day templates.
 *
 * A dedicated tab rather than folded into Training: programs are something
 * you set up occasionally and refer back to, not something you touch every
 * session — closer in spirit to Volume than to the logging flow.
 *
 * Tapping a card only opens the program. Making a program active stays on the
 * detail screen, so a stray tap in the list can never change which program is
 * active.
 */

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as programsApi from "../../../src/api/programs";
import type { ProgramSummary } from "../../../src/api/programs";
import { light } from "../../../src/lightTheme";
import { createProgramCreator } from "../../../src/programs/programActions";

const MIN_TOUCH = 44;

export default function ProgramsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // null until the first load settles, so "not loaded yet" and "no programs"
  // are never confused.
  const [programs, setPrograms] = useState<ProgramSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const latestLoad = useRef(0);

  const submitCreate = useMemo(() => createProgramCreator(programsApi.createProgram), []);

  // A failed refresh keeps the list it already has and only reports the
  // problem; a failed first load reports it instead of looking like an empty
  // list. Only the newest request may apply its result.
  const load = useCallback(async (isCancelled: () => boolean = () => false) => {
    const mine = ++latestLoad.current;
    try {
      const list = await programsApi.listPrograms();
      if (isCancelled() || mine !== latestLoad.current) return;
      setPrograms(list);
      setLoadError(null);
    } catch (err) {
      if (isCancelled() || mine !== latestLoad.current) return;
      setLoadError(err instanceof Error ? err.message : "Could not load your programs");
    }
  }, []);

  // Every focus, so a program created, renamed, activated or deleted on its
  // detail screen shows up here on return. Silent when data is already on
  // screen: no spinner, no list unmount.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void load(() => cancelled);
      return () => {
        cancelled = true;
      };
    }, [load]),
  );

  const refresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const handleCreate = async () => {
    setCreateError(null);
    const outcome = await submitCreate(newName, () => setCreating(true));
    if (outcome.kind === "ignored") return; // the running request owns the busy state
    setCreating(false);
    if (outcome.kind === "invalid" || outcome.kind === "failed") {
      // The typed name stays, so retrying is one tap.
      setCreateError(outcome.message);
      return;
    }
    setNewName("");
    router.push(`/program/${outcome.value.id}`);
  };

  const initialLoading = programs === null && loadError === null;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      // iOS pushes content up; Android already resizes the window.
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.topBar, { paddingTop: insets.top }]}>
        <View style={styles.topBarRow}>
          <Text accessibilityRole="header" style={styles.topBarTitle}>
            Programs
          </Text>
        </View>
      </View>

      {initialLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={light.textSecondary} />
        </View>
      ) : (
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.content}
          data={programs ?? []}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refresh()}
              tintColor={light.textSecondary}
              colors={[light.textSecondary]}
              progressBackgroundColor={light.surface}
            />
          }
          ListHeaderComponent={
            <View>
              <View style={styles.createCard}>
                <Text style={styles.createLabel}>New program</Text>
                <TextInput
                  style={styles.input}
                  accessibilityLabel="New program name"
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="Program name (e.g. Push Pull Legs)"
                  placeholderTextColor={light.textSecondary}
                  selectionColor={light.text}
                  returnKeyType="done"
                  maxLength={200}
                  onSubmitEditing={() => void handleCreate()}
                />
                {createError ? (
                  <Text
                    accessibilityRole="alert"
                    accessibilityLiveRegion="polite"
                    style={styles.error}
                  >
                    {createError}
                  </Text>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Create program"
                  accessibilityState={{ busy: creating, disabled: creating }}
                  disabled={creating}
                  style={({ pressed }) => [
                    styles.createButton,
                    pressed && styles.createButtonPressed,
                    creating && styles.createButtonBusy,
                  ]}
                  onPress={() => void handleCreate()}
                >
                  {creating ? (
                    <ActivityIndicator color={light.onPrimary} size="small" />
                  ) : (
                    <>
                      <Ionicons name="add" size={18} color={light.onPrimary} />
                      <Text style={styles.createButtonText}>Create</Text>
                    </>
                  )}
                </Pressable>
              </View>

              {loadError ? (
                <View style={styles.loadError}>
                  <Text
                    accessibilityRole="alert"
                    accessibilityLiveRegion="polite"
                    style={styles.loadErrorText}
                  >
                    {programs === null ? loadError : `Could not refresh: ${loadError}`}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Try loading programs again"
                    disabled={refreshing}
                    style={styles.retryButton}
                    onPress={() => void refresh()}
                  >
                    {refreshing ? (
                      <ActivityIndicator color={light.text} size="small" />
                    ) : (
                      <Text style={styles.retryText}>Try again</Text>
                    )}
                  </Pressable>
                </View>
              ) : null}

              {programs !== null && programs.length > 0 ? (
                <Text accessibilityRole="header" style={styles.sectionLabel}>
                  Your programs
                </Text>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            programs !== null ? (
              <Text style={styles.empty}>
                No programs yet. Create one to plan your training days.
              </Text>
            ) : null
          }
          renderItem={({ item, index }) => (
            <ProgramRow
              program={item}
              first={index === 0}
              last={index === (programs?.length ?? 0) - 1}
              onOpen={() => router.push(`/program/${item.id}`)}
            />
          )}
        />
      )}
    </KeyboardAvoidingView>
  );
}

/** One program in a single grouped list: the first row rounds the top, the last the bottom. */
function ProgramRow({
  program,
  first,
  last,
  onOpen,
}: {
  program: ProgramSummary;
  first: boolean;
  last: boolean;
  onOpen: () => void;
}) {
  const active = program.is_active;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={active ? `${program.name}, active program` : program.name}
      accessibilityHint="Opens the program"
      style={({ pressed }) => [
        styles.row,
        first && styles.rowFirst,
        last && styles.rowLast,
        !last && styles.rowDivider,
        pressed && styles.rowPressed,
      ]}
      onPress={onOpen}
    >
      <View style={styles.rowMain}>
        {/* The word, not the dot alone, says which program is active. */}
        {active ? (
          <View style={styles.activeRow}>
            <View style={styles.activeDot} />
            <Text style={styles.activeText}>Active program</Text>
          </View>
        ) : null}
        <Text numberOfLines={2} style={styles.rowTitle}>
          {program.name}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={light.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background },
  list: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },

  topBar: { backgroundColor: light.background, paddingHorizontal: 16 },
  topBarRow: { minHeight: 56, flexDirection: "row", alignItems: "center" },
  topBarTitle: { flexShrink: 1, color: light.text, fontSize: 28, fontWeight: "700" },

  createCard: {
    backgroundColor: light.surface,
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    marginBottom: 24,
  },
  createLabel: { color: light.text, fontSize: 17, fontWeight: "600", marginBottom: 12 },
  input: {
    minHeight: 48,
    backgroundColor: light.background,
    borderRadius: 10,
    color: light.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  error: { color: light.danger, fontSize: 14, fontWeight: "500", marginTop: 10 },
  createButton: {
    minHeight: 52,
    flexDirection: "row",
    columnGap: 8,
    marginTop: 12,
    backgroundColor: light.primary,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  createButtonPressed: { backgroundColor: light.primaryPressed },
  createButtonBusy: { opacity: 0.6 },
  createButtonText: { color: light.onPrimary, fontSize: 17, fontWeight: "600" },

  loadError: {
    backgroundColor: light.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    rowGap: 4,
  },
  loadErrorText: { color: light.danger, fontSize: 14, fontWeight: "500", lineHeight: 20 },
  retryButton: {
    minHeight: MIN_TOUCH,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingRight: 12,
  },
  retryText: { color: light.text, fontSize: 15, fontWeight: "600" },

  sectionLabel: { color: light.textSecondary, fontSize: 13, marginBottom: 8, marginLeft: 4 },
  empty: { color: light.textSecondary, fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 8 },

  row: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 8,
    backgroundColor: light.surface,
    paddingVertical: 12,
    paddingLeft: 16,
    paddingRight: 14,
  },
  rowFirst: { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  rowLast: { borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
  rowDivider: { borderBottomColor: light.separator, borderBottomWidth: StyleSheet.hairlineWidth },
  rowPressed: { backgroundColor: light.pressed },
  rowMain: { flex: 1, minWidth: 0, rowGap: 4 },
  rowTitle: { color: light.text, fontSize: 17, fontWeight: "600" },
  activeRow: { flexDirection: "row", alignItems: "center", columnGap: 6 },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: light.positive },
  activeText: { color: light.positive, fontSize: 13, fontWeight: "600" },
});
