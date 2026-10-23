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
import { createProgramCreator } from "../../../src/programs/programActions";
import { roman, useRomanFonts } from "../../../src/romanTheme";

const MIN_TOUCH = 44;

export default function ProgramsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const font = useRomanFonts();

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
          <Text accessibilityRole="header" style={[styles.topBarTitle, font.title]}>
            Programs
          </Text>
        </View>
      </View>

      {initialLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={roman.gold} />
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
              tintColor={roman.gold}
              colors={[roman.gold]}
              progressBackgroundColor={roman.surface}
            />
          }
          ListHeaderComponent={
            <View>
              <View style={styles.createCard}>
                <View style={styles.createHeading}>
                  <Ionicons name="add-circle-outline" size={18} color={roman.gold} />
                  <Text style={[styles.createLabel, font.semibold]}>New program</Text>
                </View>
                <TextInput
                  style={[styles.input, font.regular]}
                  accessibilityLabel="New program name"
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="Program name (e.g. Push Pull Legs)"
                  placeholderTextColor={roman.placeholder}
                  selectionColor={roman.gold}
                  returnKeyType="done"
                  maxLength={200}
                  onSubmitEditing={() => void handleCreate()}
                />
                {createError ? (
                  <Text
                    accessibilityRole="alert"
                    accessibilityLiveRegion="polite"
                    style={[styles.error, font.medium]}
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
                    <ActivityIndicator color={roman.background} size="small" />
                  ) : (
                    <>
                      <Ionicons name="add" size={18} color={roman.background} />
                      <Text style={[styles.createButtonText, font.semibold]}>Create</Text>
                    </>
                  )}
                </Pressable>
              </View>

              {loadError ? (
                <View style={styles.loadError}>
                  <Text
                    accessibilityRole="alert"
                    accessibilityLiveRegion="polite"
                    style={[styles.loadErrorText, font.medium]}
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
                      <ActivityIndicator color={roman.goldLight} size="small" />
                    ) : (
                      <Text style={[styles.retryText, font.semibold]}>Try again</Text>
                    )}
                  </Pressable>
                </View>
              ) : null}

              {programs !== null && programs.length > 0 ? (
                <Text accessibilityRole="header" style={[styles.sectionLabel, font.semibold]}>
                  Your programs
                </Text>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            programs !== null ? (
              <Text style={[styles.empty, font.regular]}>
                No programs yet. Create one to plan your training days.
              </Text>
            ) : null
          }
          renderItem={({ item }) => (
            <ProgramCard
              program={item}
              onOpen={() => router.push(`/program/${item.id}`)}
              font={font}
            />
          )}
        />
      )}
    </KeyboardAvoidingView>
  );
}

function ProgramCard({
  program,
  onOpen,
  font,
}: {
  program: ProgramSummary;
  onOpen: () => void;
  font: ReturnType<typeof useRomanFonts>;
}) {
  const active = program.is_active;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={active ? `${program.name}, active program` : program.name}
      accessibilityHint="Opens the program"
      style={({ pressed }) => [
        styles.card,
        active ? styles.cardActive : styles.cardIdle,
        pressed && styles.cardPressed,
      ]}
      onPress={onOpen}
    >
      <View style={styles.cardMain}>
        {/* The label, not the colour alone, says which program is active. */}
        {active ? (
          <View style={styles.activePill}>
            <View style={styles.activeDot} />
            <Text style={[styles.activePillText, font.semibold]}>Active program</Text>
          </View>
        ) : null}
        <Text style={[active ? styles.cardTitleActive : styles.cardTitle, font.semibold]}>
          {program.name}
        </Text>
      </View>
      <View style={styles.chevron}>
        <Ionicons
          name="chevron-forward"
          size={20}
          color={active ? roman.gold : roman.textMuted}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: roman.background },
  list: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },

  topBar: { backgroundColor: roman.background, paddingHorizontal: 16 },
  topBarRow: { minHeight: 56, flexDirection: "row", alignItems: "center" },
  topBarTitle: {
    flexShrink: 1,
    color: roman.gold,
    fontSize: 22,
    fontWeight: "600",
    letterSpacing: 2,
    textTransform: "uppercase",
  },

  createCard: {
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    marginBottom: 24,
  },
  createHeading: { flexDirection: "row", alignItems: "center", columnGap: 8, marginBottom: 12 },
  createLabel: {
    flexShrink: 1,
    color: roman.textMuted,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  input: {
    minHeight: 52,
    backgroundColor: roman.background,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    color: roman.text,
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  error: { color: roman.danger, fontSize: 14, marginTop: 10 },
  createButton: {
    minHeight: 52,
    flexDirection: "row",
    columnGap: 8,
    marginTop: 12,
    backgroundColor: roman.gold,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  createButtonPressed: { backgroundColor: roman.goldPressed },
  createButtonBusy: { opacity: 0.6 },
  createButtonText: {
    color: roman.background,
    fontSize: 14,
    letterSpacing: 1,
    textTransform: "uppercase",
  },

  loadError: {
    backgroundColor: roman.surface,
    borderColor: roman.danger,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    rowGap: 4,
  },
  loadErrorText: { color: roman.danger, fontSize: 14 },
  retryButton: {
    minHeight: MIN_TOUCH,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingRight: 12,
  },
  retryText: { color: roman.goldLight, fontSize: 14 },

  sectionLabel: {
    color: roman.textMuted,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  empty: { color: roman.textMuted, fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 8 },

  card: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 8,
    borderWidth: 1,
    borderLeftWidth: 4,
    borderRadius: 12,
    paddingVertical: 14,
    paddingLeft: 14,
    paddingRight: 4,
    marginBottom: 12,
  },
  cardActive: { backgroundColor: roman.surface, borderColor: roman.gold },
  // Calmer than the active card: no gold, same shape, so the list stays aligned.
  cardIdle: { backgroundColor: roman.surface, borderColor: roman.border },
  cardPressed: { backgroundColor: roman.surfaceRaised },
  cardMain: { flex: 1, rowGap: 8, alignItems: "flex-start" },
  cardTitleActive: { color: roman.text, fontSize: 18, lineHeight: 24, flexShrink: 1 },
  cardTitle: { color: roman.text, fontSize: 16, lineHeight: 22, flexShrink: 1 },
  activePill: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: 6,
    backgroundColor: roman.goldTint,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: roman.gold },
  activePillText: {
    color: roman.gold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  chevron: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    alignItems: "center",
    justifyContent: "center",
  },
});
