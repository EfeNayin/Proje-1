/**
 * Start Workout: the workout and program hub, and the screen the app opens on.
 *
 * From top to bottom: the one primary action (Start an Empty Workout, or Resume
 * workout while a session is active), Create program directly beneath it, then
 * My programs. Finished sessions live in the History tab; the Programs tab is
 * folded in here.
 *
 * Everything this screen does is an existing behaviour reached from a new place:
 *  - starting (and the optional readiness check-in) is src/workout/workoutStarter.ts,
 *    the logic the old Training screen had, unchanged;
 *  - creating a program is the /program/new screen (createProgramCreator, so the
 *    same validation and duplicate-submit protection);
 *  - a program card opens /program/[id], where activating, deleting, renaming and
 *    template editing already live. A tap on a card never changes which program
 *    is active.
 * Research, which used to be a row on the old Training screen, is a button in
 * the title bar so it stays one tap away however many programs the list holds.
 */

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as programsApi from "../../../src/api/programs";
import type { ProgramSummary } from "../../../src/api/programs";
import * as readinessApi from "../../../src/api/readiness";
import * as workoutsApi from "../../../src/api/workouts";
import { light } from "../../../src/lightTheme";
import { TabTopBar } from "../../../src/navigation/TabTopBar";
import { createProgramsHub } from "../../../src/programs/programsHub";
import { clearActiveWorkout, getActiveWorkout, setActiveWorkout } from "../../../src/workout/activeWorkout";
import { isReadinessCheckinEnabled } from "../../../src/workout/readinessPreference";
import { resolveActiveWorkoutId } from "../../../src/workout/resolveActiveWorkout";
import { createWorkoutStarter } from "../../../src/workout/workoutStarter";

const MIN_TOUCH = 44;

export default function StartWorkoutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [hub] = useState(() =>
    createProgramsHub({ listPrograms: programsApi.listPrograms, getProgram: programsApi.getProgram }),
  );
  const { programs, activeProgram, error: programsError, loading: programsLoading } = useSyncExternalStore(
    hub.subscribe,
    hub.getSnapshot,
  );
  const [starter] = useState(() =>
    createWorkoutStarter({
      isCheckinEnabled: isReadinessCheckinEnabled,
      getTodayReadiness: readinessApi.getTodayReadiness,
      startEmptyWorkout: () => workoutsApi.startWorkout(),
      startFromTemplate: programsApi.startWorkoutFromTemplate,
      setActiveWorkout,
    }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // State only updates on the next render, so a fast double tap could stack two
  // copies of a screen; the ref closes that gap. (Starting has its own guard.)
  const navigatingRef = useRef(false);

  /** Navigates at most once per visit to this screen. */
  const go = (navigate: () => void) => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    navigate();
  };

  // Re-run on every focus so a workout finished or a program changed elsewhere
  // is reflected on return.
  useFocusEffect(
    useCallback(() => {
      navigatingRef.current = false;
      let cancelled = false;
      void hub.refresh();
      // See src/workout/resolveActiveWorkout.ts for what this reconciles and why
      // (Adım 20): the local pointer is a device key, so a stale one — left by a
      // workout finished elsewhere, deleted, or belonging to a different account
      // previously signed in on this device — must not be taken at face value.
      resolveActiveWorkoutId({
        getActiveWorkout,
        setActiveWorkout,
        clearActiveWorkout,
        getWorkout: workoutsApi.getWorkout,
        getServerActiveWorkout: workoutsApi.getActiveWorkout,
      })
        .then((id) => {
          if (!cancelled) setActiveId(id);
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
        hub.cancel();
      };
    }, [hub]),
  );

  /** templateId omitted starts a free session; given, starts from that template. */
  const handleStart = async (templateId?: string) => {
    setStartError(null);
    const outcome = await starter(templateId, () => setStarting(true));
    if (outcome.kind === "ignored") return; // the running start owns the busy state
    setStarting(false);
    if (outcome.kind === "checkin") {
      router.push({
        pathname: "/workout/checkin",
        params: outcome.templateId ? { templateId: outcome.templateId } : {},
      });
    } else if (outcome.kind === "started") {
      router.push(`/workout/${outcome.workoutId}`);
    } else {
      setStartError(outcome.message);
    }
  };

  const researchButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Research, explore training research"
      style={({ pressed }) => [styles.researchButton, pressed && styles.rowPressed]}
      onPress={() => go(() => router.push("/research"))}
    >
      <Ionicons name="library-outline" size={18} color={light.text} />
      <Text style={styles.researchButtonText}>Research</Text>
    </Pressable>
  );

  const listHeader = (
    <View>
      {activeId ? (
        <View>
          <View style={styles.progressRow}>
            <View style={styles.progressDot} />
            <Text style={styles.progressLabel}>Workout in progress</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Resume workout"
            style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
            onPress={() => go(() => router.push(`/workout/${activeId}`))}
          >
            <Ionicons name="play" size={16} color={light.onPrimary} />
            <Text style={styles.primaryText}>Resume workout</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start an Empty Workout"
          accessibilityState={{ busy: starting, disabled: starting }}
          style={({ pressed }) => [
            styles.primary,
            pressed && styles.primaryPressed,
            starting && styles.primaryBusy,
          ]}
          onPress={() => void handleStart()}
          disabled={starting}
        >
          {starting ? (
            <ActivityIndicator color={light.onPrimary} />
          ) : (
            <Text style={styles.primaryText}>Start an Empty Workout</Text>
          )}
        </Pressable>
      )}

      {startError ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.errorText}>
          {startError}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Create program"
        accessibilityHint="Opens a form to name a new program"
        style={({ pressed }) => [styles.secondary, pressed && styles.rowPressed]}
        onPress={() => go(() => router.push("/program/new"))}
      >
        <Ionicons name="add" size={20} color={light.text} />
        <Text style={styles.secondaryText}>Create program</Text>
      </Pressable>

      <Text accessibilityRole="header" style={styles.sectionTitle}>
        My programs
      </Text>

      {/* Hidden while a session is active, as before: a second session is not offered from here. */}
      {!activeId && activeProgram ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Start from a template in ${activeProgram.name}`}
          accessibilityHint="Choose a template to start from"
          accessibilityState={{ disabled: starting }}
          style={({ pressed }) => [
            styles.templateRow,
            pressed && styles.rowPressed,
            starting && styles.primaryBusy,
          ]}
          onPress={() => setSheetVisible(true)}
          disabled={starting}
        >
          <View style={styles.templateText}>
            <Text style={styles.caption}>Start from a template</Text>
            <Text numberOfLines={2} style={styles.templateName}>
              {activeProgram.name}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={light.textSecondary} />
        </Pressable>
      ) : null}

      {programsError ? (
        <View style={styles.errorBanner}>
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.errorBannerText}>
            {programs === null ? programsError : `Could not refresh: ${programsError}`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try loading programs again"
            disabled={programsLoading}
            style={styles.retry}
            onPress={() => void hub.refresh()}
          >
            {programsLoading ? (
              <ActivityIndicator color={light.text} size="small" />
            ) : (
              <Text style={styles.retryText}>Try again</Text>
            )}
          </Pressable>
        </View>
      ) : null}

      {programs === null && !programsError ? (
        <ActivityIndicator
          color={light.textSecondary}
          accessibilityLabel="Loading programs"
          style={styles.loading}
        />
      ) : null}
    </View>
  );

  return (
    <View style={styles.screen}>
      <TabTopBar title="Start Workout" trailing={researchButton} />

      <FlatList
        style={styles.list}
        contentContainerStyle={styles.content}
        data={programs ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            // Only a pull shows the spinner; the focus reload is silent.
            refreshing={false}
            onRefresh={() => void hub.refresh()}
            tintColor={light.textSecondary}
          />
        }
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          programs !== null && !programsError ? (
            <Text style={styles.empty}>No programs yet. Create one to plan your training days.</Text>
          ) : null
        }
        renderItem={({ item, index }) => (
          <ProgramRow
            program={item}
            first={index === 0}
            last={index === (programs?.length ?? 0) - 1}
            onOpen={() => go(() => router.push(`/program/${item.id}`))}
          />
        )}
      />

      <Modal
        visible={sheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetVisible(false)}
      >
        {/* Neither Pressable is an accessibility element itself: an accessible parent
            swallows its children on iOS, which turned the whole sheet into one element
            ("Start from a template, <program>, <template>") with no template to choose. */}
        <Pressable accessible={false} style={styles.sheetBackdrop} onPress={() => setSheetVisible(false)}>
          {/* A Pressable with its own onPress, even a no-op, is what keeps a
              tap inside the sheet from also being read as a tap on the
              backdrop behind it. */}
          <Pressable
            accessible={false}
            accessibilityViewIsModal
            onAccessibilityEscape={() => setSheetVisible(false)}
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}
            onPress={() => {}}
          >
            <Text style={styles.caption}>Start from a template</Text>
            <Text accessibilityRole="header" style={styles.sheetTitle}>
              {activeProgram?.name}
            </Text>
            {activeProgram?.templates.map((template) => (
              <Pressable
                key={template.id}
                accessibilityRole="button"
                accessibilityLabel={template.name}
                style={({ pressed }) => [styles.sheetRow, pressed && styles.sheetRowPressed]}
                onPress={() => {
                  setSheetVisible(false);
                  void handleStart(template.id);
                }}
              >
                <Text style={styles.sheetRowText}>{template.name}</Text>
                <Ionicons name="chevron-forward" size={18} color={light.textSecondary} />
              </Pressable>
            ))}
            {activeProgram?.templates.length === 0 ? (
              <Text style={styles.sheetEmpty}>No templates in this program yet.</Text>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
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

  researchButton: {
    minHeight: MIN_TOUCH,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 6,
    paddingHorizontal: 12,
    borderRadius: MIN_TOUCH / 2,
    backgroundColor: light.surface,
  },
  researchButtonText: { color: light.text, fontSize: 15, fontWeight: "600" },

  primary: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: light.primary,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  primaryPressed: { backgroundColor: light.primaryPressed },
  primaryBusy: { opacity: 0.6 },
  primaryText: { flexShrink: 1, color: light.onPrimary, fontSize: 17, fontWeight: "600" },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  progressDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: light.positive },
  progressLabel: { flexShrink: 1, color: light.positive, fontSize: 13, fontWeight: "600" },

  // Directly beneath the primary action; quieter than it so there is still one obvious next step.
  secondary: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 10,
    backgroundColor: light.surface,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryText: { flexShrink: 1, color: light.text, fontSize: 17, fontWeight: "600" },

  sectionTitle: { color: light.text, fontSize: 20, fontWeight: "700", marginTop: 28, marginBottom: 8 },
  caption: { color: light.textSecondary, fontSize: 13 },
  rowPressed: { backgroundColor: light.pressed },

  templateRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
    backgroundColor: light.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  templateText: { flex: 1, gap: 2 },
  templateName: { color: light.text, fontSize: 16, fontWeight: "600" },

  loading: { marginTop: 16 },
  empty: { color: light.textSecondary, fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 8 },
  errorText: { color: light.danger, fontSize: 14, fontWeight: "500", marginTop: 10 },
  errorBanner: {
    backgroundColor: light.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    rowGap: 4,
  },
  errorBannerText: { color: light.danger, fontSize: 14, fontWeight: "500", lineHeight: 20 },
  retry: {
    minHeight: MIN_TOUCH,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingRight: 12,
  },
  retryText: { color: light.text, fontSize: 15, fontWeight: "600" },

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
  rowMain: { flex: 1, minWidth: 0, rowGap: 4 },
  rowTitle: { color: light.text, fontSize: 17, fontWeight: "600" },
  activeRow: { flexDirection: "row", alignItems: "center", columnGap: 6 },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: light.positive },
  activeText: { color: light.positive, fontSize: 13, fontWeight: "600" },

  sheetBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: light.scrim },
  sheet: {
    backgroundColor: light.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  sheetTitle: { color: light.text, fontSize: 20, fontWeight: "700", marginTop: 2, marginBottom: 8 },
  sheetRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 12,
    borderBottomColor: light.separator,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetRowPressed: { opacity: 0.6 },
  sheetRowText: { flex: 1, color: light.text, fontSize: 16, fontWeight: "500" },
  sheetEmpty: { color: light.textSecondary, paddingVertical: 16 },
});
