/**
 * Training home: resume or start a session, and browse past ones.
 */

import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as programsApi from "../../../src/api/programs";
import type { ProgramDetail } from "../../../src/api/programs";
import * as readinessApi from "../../../src/api/readiness";
import * as workoutsApi from "../../../src/api/workouts";
import type { WorkoutSummary } from "../../../src/api/workouts";
import { roman, useRomanFonts } from "../../../src/romanTheme";
import { clearActiveWorkout, getActiveWorkout, setActiveWorkout } from "../../../src/workout/activeWorkout";
import { isReadinessCheckinEnabled } from "../../../src/workout/readinessPreference";
import { resolveActiveWorkoutId } from "../../../src/workout/resolveActiveWorkout";
import { createWorkoutHistory } from "../../../src/workout/workoutHistory";

// Same bundled photo the sign-in screen uses; shown here darkened and faded.
const heroImage = require("../../../assets/images/login/hercules-bronze.jpg");

const MIN_TOUCH = 44;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * "Today" / "Yesterday" / a full date — grouping is by the device's LOCAL
 * calendar day, same reasoning as the server's per-user-timezone weekly
 * volume cutoff: a workout performed_at close to midnight UTC must land in
 * the day it actually happened in for the person doing it, not in UTC's.
 */
function sectionTitleFor(performedAt: string): string {
  const day = new Date(performedAt);
  const today = new Date();
  if (isSameLocalDay(day, today)) return "Today";

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (isSameLocalDay(day, yesterday)) return "Yesterday";

  return formatDate(performedAt);
}

/** For a session still in progress, shown instead of a duration it doesn't have yet. */
function formatTimeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Fixed session length, for a finished workout only — nothing to show for one still in progress. */
function formatCardDuration(performedAt: string, finishedAt: string): string {
  const seconds = Math.max(
    0,
    Math.floor((new Date(finishedAt).getTime() - new Date(performedAt).getTime()) / 1000),
  );
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * The line under a card's title. The day is already the section header above;
 * each row adds what the header can't — its duration once finished, or its
 * start time while it's the one still in progress.
 */
function cardMetaFor(item: WorkoutSummary): { icon: "timer-outline" | "time-outline" | "information-circle-outline"; text: string } {
  if (!item.finished_at) return { icon: "time-outline", text: formatTimeOfDay(item.performed_at) };
  if (item.finished_automatically === false) {
    return { icon: "timer-outline", text: formatCardDuration(item.performed_at, item.finished_at) };
  }
  return {
    icon: "information-circle-outline",
    text: item.finished_automatically ? "Auto-closed · duration unknown" : "Duration unavailable",
  };
}

type HistorySection = { title: string; data: WorkoutSummary[] };

/**
 * Workouts already arrive most-recent-first from the server, so grouping is
 * a single linear pass — no re-sorting, no bucketing into a map first.
 */
function groupByDay(workouts: WorkoutSummary[]): HistorySection[] {
  const sections: HistorySection[] = [];
  let currentDay: string | null = null;

  for (const workout of workouts) {
    const day = new Date(workout.performed_at);
    const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
    if (key !== currentDay) {
      sections.push({ title: sectionTitleFor(workout.performed_at), data: [] });
      currentDay = key;
    }
    sections[sections.length - 1].data.push(workout);
  }

  return sections;
}

export default function TrainingHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const font = useRomanFonts();
  const [history] = useState(() => createWorkoutHistory(workoutsApi.listWorkouts));
  const { items: workouts, loading, loadingMore, hasMore, error } = useSyncExternalStore(
    history.subscribe, history.getSnapshot,
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeProgram, setActiveProgram] = useState<ProgramDetail | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [starting, setStarting] = useState(false);
  // State only updates on the next render, so a fast double tap could pass a
  // `starting` check twice. The refs close that gap.
  const startingRef = useRef(false);
  const navigatingRef = useRef(false);

  /** Navigates at most once per visit to this screen: a double tap must not stack two copies. */
  const go = (navigate: () => void) => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    navigate();
  };

  const load = useCallback(async () => {
    // See src/workout/resolveActiveWorkout.ts for what this reconciles and
    // why (Adım 20, PROJE_1_CODEX_INCELEME.md, Bölüm 8 madde H3): the local
    // pointer is a device key, so a stale one — left by a workout finished
    // elsewhere, deleted, or belonging to a different account previously
    // signed in on this device — must not be taken at face value.
    setActiveId(
      await resolveActiveWorkoutId({
        getActiveWorkout,
        setActiveWorkout,
        clearActiveWorkout,
        getWorkout: workoutsApi.getWorkout,
        getServerActiveWorkout: workoutsApi.getActiveWorkout,
      }),
    );

    // The active program offers a quick way to start a planned session.
    // Isolated in its own try/catch: a programs-API hiccup must not take
    // down the workout history this screen exists to show.
    try {
      const programs = await programsApi.listPrograms();
      const active = programs.find((program) => program.is_active);
      setActiveProgram(active ? await programsApi.getProgram(active.id) : null);
    } catch {
      setActiveProgram(null);
    }
  }, []);

  // Re-run on every focus so finishing a workout is reflected on return.
  useFocusEffect(
    useCallback(() => {
      navigatingRef.current = false;
      void history.refresh();
      void load().catch(() => undefined);
      return () => {
        history.cancel();
      };
    }, [history, load]),
  );

  const handleRefresh = () => {
    void history.refresh();
    void load().catch(() => undefined);
  };

  /** templateId omitted starts a free session; given, starts from that template. */
  const handleStart = async (templateId?: string) => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    try {
      let showCheckin = false;
      try {
        if (await isReadinessCheckinEnabled()) {
          const today = await readinessApi.getTodayReadiness();
          showCheckin = today.id === null;
        }
      } catch {
        // Fail open: a flaky check on whether today is already logged must
        // never be the reason a workout cannot be started.
        showCheckin = false;
      }

      if (showCheckin) {
        router.push({
          pathname: "/workout/checkin",
          params: templateId ? { templateId } : {},
        });
        return;
      }

      const workoutId = templateId
        ? (await programsApi.startWorkoutFromTemplate(templateId)).workout_id
        : (await workoutsApi.startWorkout()).id;
      await setActiveWorkout(workoutId);
      router.push(`/workout/${workoutId}`);
    } catch {
      // Errors surface on the workout screen itself; nothing useful to show
      // here beyond letting the user tap again.
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  };

  const topBar = (
    <View style={[styles.topBar, { paddingTop: insets.top }]}>
      <View style={styles.topBarRow}>
        <Text accessibilityRole="header" style={[styles.topBarTitle, font.title]}>
          Training
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open profile"
          hitSlop={4}
          onPress={() => go(() => router.navigate("/profile"))}
          style={styles.profileButton}
        >
          <View style={styles.profileDot}>
            <Ionicons name="person" size={18} color={roman.background} />
          </View>
        </Pressable>
      </View>
    </View>
  );

  if (loading && workouts.length === 0) {
    return (
      <View style={styles.screen}>
        {topBar}
        <View style={styles.centered}>
          <ActivityIndicator color={roman.gold} />
        </View>
      </View>
    );
  }

  const sections = groupByDay(workouts);
  // The statue sits behind the first screenful and is gone by the time the
  // history starts; the start button clears the face on short screens too.
  const heroHeight = 380;
  const heroInset = Math.min(150, Math.round(windowHeight * 0.17));

  return (
    <View style={styles.screen}>
      {topBar}
      <SectionList
        style={styles.list}
        contentContainerStyle={styles.content}
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        onEndReached={() => { void history.loadMore(); }}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={handleRefresh} tintColor={roman.gold} />
        }
        ListHeaderComponent={
          <View>
            {/* Decorative: no touches, hidden from screen readers. */}
            <View
              pointerEvents="none"
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.hero, { height: heroHeight }]}
            >
              <Image
                source={heroImage}
                style={[StyleSheet.absoluteFill, styles.heroImage]}
                contentFit="cover"
                contentPosition="top"
                accessible={false}
              />
              <LinearGradient
                colors={[roman.backgroundClear, "rgba(9, 9, 11, 0.7)", roman.background]}
                locations={[0.15, 0.65, 1]}
                style={StyleSheet.absoluteFill}
              />
            </View>

            <View style={{ paddingTop: heroInset }}>
              {activeId ? (
                <View>
                  <View style={styles.progressRow}>
                    <View style={styles.progressDot} />
                    <Text style={[styles.progressLabel, font.semibold]}>Workout in progress</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Resume workout"
                    style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
                    onPress={() => go(() => router.push(`/workout/${activeId}`))}
                  >
                    <Ionicons name="play" size={18} color={roman.background} />
                    <Text style={[styles.primaryText, font.semibold]}>Resume workout</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Start workout"
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
                      <ActivityIndicator color={roman.background} />
                    ) : (
                      <>
                        <Ionicons name="add-circle-outline" size={20} color={roman.background} />
                        <Text style={[styles.primaryText, font.semibold]}>Start workout</Text>
                      </>
                    )}
                  </Pressable>

                  {activeProgram ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityHint="Choose a template to start from"
                      style={styles.programChip}
                      onPress={() => setSheetVisible(true)}
                      disabled={starting}
                    >
                      <Ionicons name="clipboard-outline" size={16} color={roman.gold} />
                      <Text style={[styles.programChipText, font.medium]}>{activeProgram.name}</Text>
                      <Ionicons name="chevron-down" size={16} color={roman.textMuted} />
                    </Pressable>
                  ) : null}
                </>
              )}

              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.researchCard, pressed && styles.cardPressed]}
                onPress={() => go(() => router.push("/research"))}
              >
                <View style={styles.researchIcon}>
                  <Ionicons name="book-outline" size={22} color={roman.gold} />
                </View>
                <View style={styles.researchText}>
                  <Text style={[styles.researchTitle, font.title]}>Research</Text>
                  <Text style={[styles.cardMeta, font.regular]}>Explore training research</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={roman.textMuted} />
              </Pressable>

              <Text accessibilityRole="header" style={[styles.sectionTitle, font.title]}>
                Recent workouts
              </Text>

              {error === "refresh" ? (
                <View style={styles.errorBanner}>
                  <Text accessibilityRole="alert" style={[styles.errorText, font.medium]}>
                    Could not refresh your history.
                  </Text>
                  <Pressable accessibilityRole="button" style={styles.retry} onPress={handleRefresh}>
                    <Text style={[styles.retryText, font.semibold]}>Try again</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </View>
        }
        ListEmptyComponent={
          !error ? (
            <View style={styles.emptyCard}>
              <Ionicons name="barbell-outline" size={26} color={roman.gold} />
              <Text style={[styles.emptyTitle, font.title]}>No workouts yet</Text>
              <Text style={[styles.emptyText, font.regular]}>
                No workouts yet. Start one and it will show up here.
              </Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          <View style={styles.historyFooter}>
            {error === "more" ? (
              <>
                <Text style={[styles.errorText, font.medium]}>Could not load older workouts.</Text>
                <Pressable accessibilityRole="button" style={styles.retry}
                  onPress={() => { void history.loadMore(true); }}>
                  <Text style={[styles.retryText, font.semibold]}>Try again</Text>
                </Pressable>
              </>
            ) : loadingMore ? (
              <ActivityIndicator color={roman.gold} />
            ) : !error && !loading && hasMore ? (
              <Pressable accessibilityRole="button" style={styles.retry}
                onPress={() => { void history.loadMore(); }}>
                <Text style={[styles.retryText, font.semibold]}>Load older workouts</Text>
              </Pressable>
            ) : !error && !loading && workouts.length > 0 ? (
              <Text style={[styles.cardMeta, font.regular]}>All workouts loaded</Text>
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text style={[styles.dayHeader, font.semibold]}>{section.title}</Text>
        )}
        renderItem={({ item }) => {
          const meta = cardMetaFor(item);
          const title = item.title ?? "Workout";
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${title}, ${meta.text}, ${item.total_sets} sets`}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              onPress={() => go(() => router.push(`/workout/${item.id}`))}
            >
              <View style={styles.cardMain}>
                <Text style={[styles.cardTitle, font.title]}>{title}</Text>
                <View style={styles.cardMetaRow}>
                  <Ionicons name={meta.icon} size={15} color={roman.gold} />
                  <Text style={[styles.cardMetaText, font.regular]}>{meta.text}</Text>
                </View>
              </View>
              <View style={styles.cardStats}>
                {/* Sets as the API counts them, not tonnage: tonnage is
                    dominated by whichever muscles happen to move the most
                    weight, so a leg day always dwarfs an arm day regardless
                    of how good either was. */}
                <Text style={[styles.cardSets, font.semibold]}>{item.total_sets}</Text>
                <Text style={[styles.cardMeta, font.regular]}>sets</Text>
              </View>
            </Pressable>
          );
        }}
      />

      <Modal
        visible={sheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetVisible(false)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setSheetVisible(false)}>
          {/* A Pressable with its own onPress, even a no-op, is what keeps a
              tap inside the sheet from also being read as a tap on the
              backdrop behind it. */}
          <Pressable
            accessibilityViewIsModal
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}
            onPress={() => {}}
          >
            <Text style={[styles.sheetTitle, font.semibold]}>{activeProgram?.name}</Text>
            {activeProgram?.templates.map((template) => (
              <Pressable
                key={template.id}
                accessibilityRole="button"
                style={({ pressed }) => [styles.sheetRow, pressed && styles.sheetRowPressed]}
                onPress={() => {
                  setSheetVisible(false);
                  void handleStart(template.id);
                }}
              >
                <Text style={[styles.sheetRowText, font.semibold]}>{template.name}</Text>
                <Ionicons name="chevron-forward" size={18} color={roman.textMuted} />
              </Pressable>
            ))}
            {activeProgram?.templates.length === 0 ? (
              <Text style={[styles.sheetEmpty, font.regular]}>No templates in this program yet.</Text>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: roman.background },
  list: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },

  topBar: { backgroundColor: roman.background, paddingHorizontal: 16 },
  topBarRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  topBarTitle: {
    flexShrink: 1,
    color: roman.gold,
    fontSize: 22,
    fontWeight: "600",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  profileButton: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    alignItems: "center",
    justifyContent: "center",
  },
  profileDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: roman.gold,
    alignItems: "center",
    justifyContent: "center",
  },

  // Full-bleed behind the header: the list pads its content by 16 each side.
  hero: { position: "absolute", top: 0, left: -16, right: -16 },
  heroImage: { opacity: 0.5 },

  primary: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: roman.gold,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  primaryPressed: { backgroundColor: roman.goldPressed },
  primaryBusy: { opacity: 0.6 },
  primaryText: {
    flexShrink: 1,
    color: roman.background,
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  progressDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: roman.gold },
  progressLabel: {
    flexShrink: 1,
    color: roman.goldLight,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 1,
    textTransform: "uppercase",
  },

  programChip: {
    minHeight: MIN_TOUCH,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    maxWidth: "100%",
    gap: 8,
    marginTop: 10,
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  programChipText: { flexShrink: 1, color: roman.text, fontSize: 14, fontWeight: "500" },

  researchCard: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: 20,
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  researchIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: roman.background,
    alignItems: "center",
    justifyContent: "center",
  },
  researchText: { flex: 1 },
  researchTitle: { color: roman.text, fontSize: 16, fontWeight: "600", letterSpacing: 1 },
  cardPressed: { backgroundColor: "#1F1F22" },

  sectionTitle: {
    color: roman.text,
    fontSize: 20,
    fontWeight: "600",
    letterSpacing: 0.5,
    marginTop: 28,
    marginBottom: 4,
  },
  dayHeader: {
    color: roman.textMuted,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 14,
    marginBottom: 8,
  },
  card: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    // Gold edge marks each session as a record.
    borderLeftColor: roman.gold,
    borderLeftWidth: 3,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  cardMain: { flex: 1 },
  cardTitle: { color: roman.text, fontSize: 17, fontWeight: "600", letterSpacing: 0.5 },
  cardMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  cardMetaText: { flexShrink: 1, color: roman.textMuted, fontSize: 13 },
  cardMeta: { color: roman.textMuted, fontSize: 13 },
  cardStats: { alignItems: "flex-end", marginLeft: 12 },
  cardSets: { color: roman.goldLight, fontSize: 22, fontWeight: "600" },

  emptyCard: {
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 24,
  },
  emptyTitle: { color: roman.text, fontSize: 18, fontWeight: "600" },
  emptyText: { color: roman.textMuted, fontSize: 14, textAlign: "center" },

  errorBanner: {
    alignItems: "flex-start",
    gap: 8,
    marginTop: 8,
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  errorText: { color: roman.danger, fontSize: 14, textAlign: "center" },
  historyFooter: { alignItems: "center", paddingVertical: 24, gap: 8 },
  retry: {
    minHeight: MIN_TOUCH,
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
  },
  retryText: { color: roman.goldLight, fontSize: 14, fontWeight: "600" },

  sheetBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.6)",
  },
  sheet: {
    backgroundColor: roman.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopColor: roman.gold,
    borderTopWidth: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  sheetTitle: {
    color: roman.textMuted,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  sheetRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 12,
    borderBottomColor: roman.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetRowPressed: { opacity: 0.6 },
  sheetRowText: { flex: 1, color: roman.text, fontSize: 16, fontWeight: "600" },
  sheetEmpty: { color: roman.textMuted, paddingVertical: 16 },
});
