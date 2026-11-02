/**
 * Program management: the programs a coach is preparing for ONE athlete. A preparation is
 * a private draft the coach edits like any program, then publishes as numbered versions
 * the athlete reviews and accepts. Nothing here touches the coach's own programs or
 * their active program, and nothing reaches the athlete until a version is published.
 */

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { LineageSummary } from "../../../../../../src/api/coaching";
import { listPrograms } from "../../../../../../src/api/programs";
import type { ProgramSummary } from "../../../../../../src/api/programs";
import { useAuth } from "../../../../../../src/auth/AuthContext";
import { coachingStore } from "../../../../../../src/coaching/coachingSession";
import { lineageStatusText } from "../../../../../../src/coaching/offerDisplay";
import { personName } from "../../../../../../src/coaching/presentation";
import { programPreparationStore } from "../../../../../../src/coaching/programPreparationSession";
import { RecipientBanner } from "../../../../../../src/coaching/RecipientBanner";
import { useCoaching } from "../../../../../../src/coaching/useCoaching";
import { useProgramPreparation } from "../../../../../../src/coaching/useProgramPreparation";
import { light } from "../../../../../../src/lightTheme";

const MIN_TOUCH = 44;

export default function ProgramManagementScreen() {
  const { linkId } = useLocalSearchParams<{ linkId: string }>();
  const { user } = useAuth();
  // Keyed by account and athlete: a different one remounts the body, so a typed name or a
  // result from another athlete cannot carry over.
  return (
    <ProgramManagement
      key={`${user?.id ?? "signed-out"}:${linkId}`}
      userId={user?.id ?? null}
      linkId={linkId}
    />
  );
}

function ProgramManagement({ userId, linkId }: { userId: string | null; linkId: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const coaching = useCoaching(userId);
  const view = useProgramPreparation(userId, linkId);
  const link = coaching.athletes.items.find((item) => item.id === linkId);
  const name = link ? personName(link.person) : "this athlete";
  const ended =
    view.list.unavailable || (!link && coaching.athletes.loaded && !coaching.athletes.error);

  const [title, setTitle] = useState("");
  const [copying, setCopying] = useState(false);
  const [programs, setPrograms] = useState<ProgramSummary[] | null>(null);
  const [programsError, setProgramsError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const latestPrograms = useRef(0);

  useFocusEffect(
    useCallback(() => {
      coachingStore.bind(userId);
      programPreparationStore.bind(userId);
      programPreparationStore.bindLink(linkId);
      void coachingStore.load("coach");
      void programPreparationStore.refreshList();
      return () => {
        latestPrograms.current += 1;
      };
    }, [userId, linkId]),
  );

  const openCopyChooser = async () => {
    setCopying(true);
    setProgramsError(null);
    const mine = ++latestPrograms.current;
    try {
      const list = await listPrograms();
      if (mine !== latestPrograms.current) return;
      setPrograms(list);
    } catch (error) {
      if (mine !== latestPrograms.current) return;
      setProgramsError(error instanceof Error ? error.message : "Could not load your programs");
    }
  };

  const start = async (input: { name?: string; from_program_id?: string }) => {
    setNotice(null);
    const outcome = await programPreparationStore.create(input);
    if (outcome.kind === "ignored" || outcome.kind === "stale") return;
    if (outcome.kind === "done") {
      setTitle("");
      setCopying(false);
      router.push(`/coaching/athlete/${linkId}/programs/${outcome.lineage.id}`);
      return;
    }
    setNotice(outcome.message);
  };

  const padding = { paddingBottom: Math.max(insets.bottom, 16) + 24 };

  if (ended) {
    return (
      <View style={[styles.screen, styles.content, padding]}>
        <Text accessibilityRole="alert" style={styles.empty}>
          This connection has ended, so programs can no longer be prepared for this athlete.
        </Text>
      </View>
    );
  }

  const { list, creating } = view;
  const trimmed = title.trim();

  const header = (
    <View style={styles.headerGap}>
      {link ? <RecipientBanner athlete={link.person} /> : null}
      <Text style={styles.intro}>
        Prepare a program just for {name}. You edit a private draft; {name} only sees a version
        once you publish it, and decides whether to add it as their own copy. Your own programs
        and your active program are not touched.
      </Text>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.cardTitle}>
          New preparation for {name}
        </Text>
        <TextInput
          style={styles.input}
          accessibilityLabel="Program name"
          placeholder="Program name"
          placeholderTextColor={light.textSecondary}
          value={title}
          onChangeText={setTitle}
          maxLength={100}
          returnKeyType="done"
          selectionColor={light.text}
          editable={!creating}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Create an empty program for ${name}`}
          accessibilityState={{ busy: creating, disabled: creating || trimmed.length === 0 }}
          disabled={creating || trimmed.length === 0}
          style={({ pressed }) => [
            styles.primary,
            pressed && styles.primaryPressed,
            (creating || trimmed.length === 0) && styles.busy,
          ]}
          onPress={() => void start({ name: trimmed })}
        >
          {creating && !copying ? (
            <ActivityIndicator color={light.onPrimary} />
          ) : (
            <Text style={styles.primaryText}>Create from scratch</Text>
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start from one of my programs"
          accessibilityHint="Makes an independent copy for this athlete; the original is not changed"
          accessibilityState={{ disabled: creating }}
          disabled={creating}
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          onPress={() => (copying ? setCopying(false) : void openCopyChooser())}
        >
          <Text style={styles.secondaryText}>
            {copying ? "Hide my programs" : "Start from one of my programs"}
          </Text>
        </Pressable>
        {copying ? (
          programsError ? (
            <View style={styles.banner}>
              <Text accessibilityRole="alert" style={styles.error}>
                {programsError}
              </Text>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
                onPress={() => void openCopyChooser()}
              >
                <Text style={styles.secondaryText}>Try again</Text>
              </Pressable>
            </View>
          ) : programs === null ? (
            <ActivityIndicator color={light.textSecondary} accessibilityLabel="Loading your programs" />
          ) : programs.length === 0 ? (
            <Text style={styles.meta}>You have no programs to copy yet.</Text>
          ) : (
            <View style={styles.chooser}>
              <Text style={styles.meta}>
                Choose a program. An independent copy is made for {name}; editing it never
                changes the original. The name above is used if you typed one.
              </Text>
              {programs.map((program) => (
                <Pressable
                  key={program.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Copy ${program.name} for ${name}`}
                  accessibilityState={{ disabled: creating }}
                  disabled={creating}
                  style={({ pressed }) => [styles.choice, pressed && styles.pressed, creating && styles.busy]}
                  onPress={() =>
                    void start({
                      from_program_id: program.id,
                      ...(trimmed ? { name: trimmed } : {}),
                    })
                  }
                >
                  <Text style={styles.choiceTitle}>{program.name}</Text>
                  <Ionicons name="copy-outline" size={18} color={light.textSecondary} />
                </Pressable>
              ))}
            </View>
          )
        ) : null}
        {notice ? (
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>
            {notice}
          </Text>
        ) : null}
      </View>

      <Text accessibilityRole="header" style={styles.sectionLabel}>
        Prepared for {name}
      </Text>
      {list.error ? (
        <View style={styles.banner}>
          <Text accessibilityRole="alert" style={styles.error}>
            {list.loaded ? "Could not refresh." : "Could not load preparations."} {list.error}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            onPress={() => void programPreparationStore.refreshList()}
          >
            <Text style={styles.secondaryText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={[styles.content, padding]}
      data={list.items}
      keyExtractor={(item) => item.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={header}
      ListEmptyComponent={
        !list.loaded && list.loading ? (
          <ActivityIndicator color={list.error ? light.danger : light.textSecondary} accessibilityLabel="Loading preparations" />
        ) : list.error && !list.loaded ? null : (
          <Text style={styles.empty}>Nothing prepared for {name} yet.</Text>
        )
      }
      refreshControl={
        <RefreshControl
          refreshing={list.loading && list.loaded}
          onRefresh={() => void programPreparationStore.refreshList()}
          tintColor={light.textSecondary}
        />
      }
      renderItem={({ item }) => (
        <LineageRow
          item={item}
          onOpen={() => router.push(`/coaching/athlete/${linkId}/programs/${item.id}`)}
        />
      )}
    />
  );
}

function LineageRow({ item, onOpen }: { item: LineageSummary; onOpen: () => void }) {
  const status = lineageStatusText(item.latest_version, item.latest_status);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${status}`}
      accessibilityHint="Opens this preparation"
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={onOpen}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{item.name}</Text>
        <Text style={styles.meta}>{status}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={light.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background },
  content: { paddingHorizontal: 16, paddingTop: 8 },
  headerGap: { gap: 12, marginBottom: 12 },
  intro: { color: light.textSecondary, fontSize: 14, lineHeight: 21 },
  card: { backgroundColor: light.surface, borderRadius: 12, padding: 16, gap: 10 },
  cardTitle: { color: light.text, fontSize: 17, fontWeight: "600", lineHeight: 22 },
  input: {
    minHeight: 48,
    color: light.text,
    fontSize: 16,
    backgroundColor: light.background,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  sectionLabel: { color: light.textSecondary, fontSize: 13, fontWeight: "600", marginLeft: 4, marginTop: 8 },
  meta: { color: light.textSecondary, fontSize: 13, lineHeight: 19 },
  error: { color: light.danger, fontSize: 14, lineHeight: 20 },
  banner: { backgroundColor: light.surface, borderRadius: 12, padding: 16, gap: 8 },
  empty: {
    color: light.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    paddingVertical: 16,
  },
  chooser: { gap: 8 },
  choice: {
    minHeight: MIN_TOUCH + 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    backgroundColor: light.background,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  choiceTitle: { flex: 1, color: light.text, fontSize: 15, fontWeight: "600" },
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: light.surface,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: light.text, fontSize: 16, fontWeight: "600", lineHeight: 22 },
  primary: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: light.primary,
    borderRadius: 14,
    paddingHorizontal: 16,
  },
  primaryPressed: { backgroundColor: light.primaryPressed },
  primaryText: { color: light.onPrimary, fontSize: 16, fontWeight: "600", textAlign: "center" },
  secondary: {
    minHeight: MIN_TOUCH,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  secondaryText: { color: light.text, fontSize: 15, fontWeight: "600", textDecorationLine: "underline" },
  pressed: { backgroundColor: light.pressed },
  busy: { opacity: 0.6 },
});
