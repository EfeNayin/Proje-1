/**
 * Weekly volume against hypertrophy landmarks.
 *
 * The screen the product exists for. Each muscle shows how many *direct* sets
 * it got that week and where that sits between MEV, MAV and MRV.
 *
 * All numbers come from the API as they are; src/volume holds the wording and
 * marker rules, and the loader that keeps late responses and failed refreshes
 * from putting the wrong data on screen.
 */

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as analyticsApi from "../../../src/api/analytics";
import type { MuscleWeeklyVolume } from "../../../src/api/analytics";
import { roman, useRomanFonts } from "../../../src/romanTheme";
import { statusColors } from "../../../src/theme";
import { createWeeklyVolumeLoader, initialVolumeState } from "../../../src/volume/weeklyVolumeLoader";
import {
  describeMuscle,
  formatWeekRange,
  formatWeekTitle,
  resolveOffset,
  stepWeek,
} from "../../../src/volume/volumePresentation";

const WEEKS_TO_LOAD = 8;
const MIN_TOUCH = 44;

const REGION_TITLES: Record<string, string> = {
  upper: "Upper body",
  lower: "Lower body",
  core: "Core",
};

type Fonts = ReturnType<typeof useRomanFonts>;

// Status colours are the app's existing semantic ones; a dim grey for "no sets"
// would fail contrast as text, so that one uses the muted silver. The label
// beside every colour carries the meaning.
function statusTextColor(status: MuscleWeeklyVolume["status"]): string {
  return status === "untrained" ? roman.textMuted : statusColors[status];
}

/**
 * Where the week's sets fall between the landmarks.
 *
 * Fill and marks share one real axis (see describeMuscle): sets over MRV run
 * past the MRV mark rather than being clipped, and nothing is drawn when the
 * API supplies no complete reference.
 */
function LandmarkBar({ muscle }: { muscle: MuscleWeeklyVolume }) {
  const { bar } = describeMuscle(muscle);
  if (!bar) return null;

  // React Native types percentages as the literal `${number}%`.
  const percent = (fraction: number): `${number}%` => `${fraction * 100}%`;

  return (
    <View style={styles.track} importantForAccessibility="no-hide-descendants">
      <View style={styles.trackBar}>
        <View
          style={[
            styles.fill,
            { width: percent(bar.fill), backgroundColor: statusColors[muscle.status] },
          ]}
        />
      </View>
      <View style={[styles.tick, { left: percent(bar.mev) }]} />
      <View style={[styles.tick, { left: percent(bar.mav) }]} />
      <View style={[styles.tick, { left: percent(bar.mrv) }]} />
    </View>
  );
}

function MuscleRow({ muscle, font }: { muscle: MuscleWeeklyVolume; font: Fonts }) {
  const view = describeMuscle(muscle);
  const color = statusTextColor(muscle.status);

  return (
    // One element for screen readers: the full sentence also carries the
    // marker values the bar can only show visually.
    <View accessible accessibilityLabel={view.accessibilityLabel} style={styles.muscle}>
      <View style={styles.muscleHeader}>
        <Text style={[styles.muscleName, font.semibold]}>{view.name}</Text>
        <View style={styles.count}>
          <Text style={[styles.setCount, font.semibold]}>{view.directSets}</Text>
          <Text style={[styles.setUnit, font.regular]}>
            {view.directSets === 1 ? "direct set" : "direct sets"}
          </Text>
        </View>
      </View>

      <Text style={[styles.statusText, font.semibold, { color }]}>{view.statusLabel}</Text>

      <LandmarkBar muscle={muscle} />

      {view.references.length > 0 ? (
        <View style={styles.references}>
          {view.references.map((reference) => (
            <Text key={reference} style={[styles.referenceText, font.medium]}>
              {reference}
            </Text>
          ))}
        </View>
      ) : null}

      {view.indirectSets > 0 || view.effectiveness !== null ? (
        <View style={styles.muscleMeta}>
          {/* Sets the muscle only assisted on: shown so a user does not "fix"
              low direct volume that pressing already covers, never counted. */}
          {view.indirectSets > 0 ? (
            <Text style={[styles.metaText, font.regular]}>+{view.indirectSets} indirect</Text>
          ) : null}
          {view.effectiveness !== null ? (
            <View style={styles.quality}>
              <Ionicons name="star" size={11} color={roman.textMuted} />
              <Text style={[styles.metaText, font.regular]}>{view.effectiveness.toFixed(1)}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function ErrorBlock({
  message,
  busy,
  onRetry,
  prefix,
  font,
}: {
  message: string;
  busy: boolean;
  onRetry: () => void;
  prefix?: string;
  font: Fonts;
}) {
  return (
    <View style={styles.errorBlock}>
      <Text
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.errorText, font.medium]}
      >
        {prefix ? `${prefix} ${message}` : message}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Try loading volume again"
        disabled={busy}
        style={styles.retryButton}
        onPress={onRetry}
      >
        {busy ? (
          <ActivityIndicator color={roman.goldLight} size="small" />
        ) : (
          <Text style={[styles.retryText, font.semibold]}>Try again</Text>
        )}
      </Pressable>
    </View>
  );
}

export default function VolumeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const font = useRomanFonts();

  const [state, setState] = useState(initialVolumeState);
  const [loader] = useState(() =>
    createWeeklyVolumeLoader(() => analyticsApi.fetchWeeklyVolume(WEEKS_TO_LOAD), setState),
  );
  // The chosen week is kept by its start date, so a reload can never leave the
  // selection pointing at a different week.
  const [selectedStart, setSelectedStart] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);

  // Reload on focus so sets logged a moment ago are already reflected.
  useFocusEffect(
    useCallback(() => {
      void loader.load();
      return () => loader.invalidate();
    }, [loader]),
  );

  const handleRefresh = async () => {
    setPulling(true);
    try {
      await loader.load();
    } finally {
      setPulling(false);
    }
  };

  const weeks = useMemo(() => state.data?.weeks ?? [], [state.data]);
  const offset = resolveOffset(weeks, selectedStart);
  const week = weeks[offset];

  const byRegion = useMemo(() => {
    if (!week) return [];
    const order: MuscleWeeklyVolume["region"][] = ["upper", "lower", "core"];
    return order
      .map((region) => ({
        region,
        muscles: week.muscles.filter((muscle) => muscle.region === region),
      }))
      .filter((group) => group.muscles.length > 0);
  }, [week]);

  const topBar = (
    <View style={[styles.topBar, { paddingTop: insets.top }]}>
      <View style={styles.topBarRow}>
        <Text accessibilityRole="header" style={[styles.topBarTitle, font.title]}>
          Volume
        </Text>
      </View>
    </View>
  );

  if (state.loading) {
    return (
      <View style={styles.screen}>
        {topBar}
        <View style={styles.centered}>
          <ActivityIndicator color={roman.gold} />
        </View>
      </View>
    );
  }

  if (!week) {
    return (
      <View style={styles.screen}>
        {topBar}
        <View style={styles.centered}>
          {state.error ? (
            <ErrorBlock
              message={state.error}
              busy={state.refreshing}
              onRetry={() => void loader.load()}
              font={font}
            />
          ) : (
            <Text style={[styles.emptyText, font.regular]}>No weekly data yet.</Text>
          )}
        </View>
      </View>
    );
  }

  const trainedCount = week.muscles.filter((muscle) => muscle.direct_sets > 0).length;
  // Indirect-only work is still a record of the week, so it keeps the list.
  const hasRecords = week.muscles.some((muscle) => muscle.direct_sets > 0 || muscle.involved_sets > 0);
  const olderDisabled = offset >= weeks.length - 1;
  const newerDisabled = offset === 0;
  const range = formatWeekRange(week.week_start);
  const title = formatWeekTitle(week.week_start, offset);

  return (
    <View style={styles.screen}>
      {topBar}
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={() => void handleRefresh()}
            tintColor={roman.gold}
            colors={[roman.gold]}
            progressBackgroundColor={roman.surface}
          />
        }
      >
        <Pressable
          accessibilityRole="button"
          accessibilityHint="Opens the training review"
          style={({ pressed }) => [styles.diagnosisEntry, pressed && styles.pressed]}
          onPress={() => router.push("/diagnosis")}
        >
          <View style={styles.diagnosisEntryText}>
            <Text style={[styles.diagnosisEntryTitle, font.semibold]}>Why am I not growing?</Text>
            <Text style={[styles.diagnosisEntrySubtitle, font.regular]}>
              Volume, recovery and weight trend, combined
            </Text>
          </View>
          <View style={styles.chevron}>
            <Ionicons name="chevron-forward" size={20} color={roman.gold} />
          </View>
        </Pressable>

        <View style={styles.weekBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Earlier week"
            accessibilityState={{ disabled: olderDisabled }}
            disabled={olderDisabled}
            style={styles.iconButton}
            onPress={() => setSelectedStart(stepWeek(weeks, selectedStart, 1))}
          >
            <Ionicons
              name="chevron-back"
              size={22}
              color={olderDisabled ? roman.border : roman.text}
            />
          </Pressable>

          <View style={styles.weekLabel}>
            <Text accessibilityRole="header" style={[styles.weekTitle, font.semibold]}>
              {title}
            </Text>
            {title !== range ? (
              <Text style={[styles.weekRange, font.regular]}>{range}</Text>
            ) : null}
            <Text style={[styles.weekSubtitle, font.regular]}>
              {trainedCount === 0
                ? "No direct sets recorded"
                : `${trainedCount} muscle${trainedCount === 1 ? "" : "s"} with direct sets`}
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Later week"
            accessibilityState={{ disabled: newerDisabled }}
            disabled={newerDisabled}
            style={styles.iconButton}
            onPress={() => setSelectedStart(stepWeek(weeks, selectedStart, -1))}
          >
            <Ionicons
              name="chevron-forward"
              size={22}
              color={newerDisabled ? roman.border : roman.text}
            />
          </Pressable>
        </View>

        {offset > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to this week"
            style={styles.thisWeekButton}
            onPress={() => setSelectedStart(weeks[0].week_start)}
          >
            <Ionicons name="return-down-back" size={16} color={roman.goldLight} />
            <Text style={[styles.thisWeekText, font.semibold]}>Back to this week</Text>
          </Pressable>
        ) : null}

        {state.error ? (
          <ErrorBlock
            message={state.error}
            busy={state.refreshing}
            onRetry={() => void loader.load()}
            prefix="Showing the last loaded data. Could not refresh:"
            font={font}
          />
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: explainOpen }}
          style={({ pressed }) => [styles.explainHeader, pressed && styles.pressed]}
          onPress={() => setExplainOpen((open) => !open)}
        >
          <Ionicons name="information-circle-outline" size={20} color={roman.gold} />
          <Text style={[styles.explainTitle, font.semibold]}>How volume is counted</Text>
          <Ionicons
            name={explainOpen ? "chevron-up" : "chevron-down"}
            size={18}
            color={roman.textMuted}
          />
        </Pressable>
        {explainOpen ? (
          <View style={styles.explainBody}>
            <Text style={[styles.explainText, font.regular]}>
              Each number is the working sets in the week where the exercise lists the muscle as a
              primary target (direct sets). Warm-up sets and sets with 0 reps are not counted.
            </Text>
            <Text style={[styles.explainText, font.regular]}>
              Sets where a muscle only assists are shown as “+N indirect” and are not added to the
              count, because MEV, MAV and MRV already allow for that work.
            </Text>
            <Text style={[styles.explainText, font.regular]}>
              MEV, MAV and MRV are the reference values stored for each muscle, not personal
              targets. Weeks start on Monday in your timezone.
            </Text>
          </View>
        ) : null}

        {!hasRecords ? (
          <View style={styles.emptyWeek}>
            <Text style={[styles.emptyWeekTitle, font.semibold]}>No direct sets recorded</Text>
            <Text style={[styles.emptyText, font.regular]}>
              Sets logged in Training appear here once they are recorded for this week.
            </Text>
          </View>
        ) : (
          byRegion.map((group) => (
            <View key={group.region} style={styles.region}>
              <Text accessibilityRole="header" style={[styles.regionTitle, font.semibold]}>
                {REGION_TITLES[group.region] ?? group.region}
              </Text>
              {group.muscles.map((muscle) => (
                <MuscleRow key={muscle.muscle_group_id} muscle={muscle} font={font} />
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: roman.background },
  flex: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  pressed: { backgroundColor: roman.surfaceRaised },

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

  diagnosisEntry: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: roman.surface,
    borderColor: roman.gold,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingLeft: 16,
    paddingRight: 4,
    marginTop: 8,
    marginBottom: 16,
  },
  diagnosisEntryText: { flex: 1, rowGap: 2 },
  diagnosisEntryTitle: { color: roman.text, fontSize: 16, lineHeight: 22 },
  diagnosisEntrySubtitle: { color: roman.textMuted, fontSize: 13, lineHeight: 18 },
  chevron: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: "center", justifyContent: "center" },

  weekBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginBottom: 12,
  },
  iconButton: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    alignItems: "center",
    justifyContent: "center",
  },
  weekLabel: { flex: 1, alignItems: "center", rowGap: 2, paddingVertical: 4 },
  weekTitle: { color: roman.text, fontSize: 16, lineHeight: 22, textAlign: "center" },
  weekRange: { color: roman.textMuted, fontSize: 13, textAlign: "center" },
  weekSubtitle: { color: roman.gold, fontSize: 12, textAlign: "center" },
  thisWeekButton: {
    minHeight: MIN_TOUCH,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    columnGap: 6,
    paddingHorizontal: 12,
  },
  thisWeekText: { color: roman.goldLight, fontSize: 14 },

  errorBlock: {
    backgroundColor: roman.surface,
    borderColor: roman.danger,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    rowGap: 4,
  },
  errorText: { color: roman.danger, fontSize: 14, lineHeight: 20 },
  retryButton: {
    minHeight: MIN_TOUCH,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingRight: 12,
  },
  retryText: { color: roman.goldLight, fontSize: 14 },

  explainHeader: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 10,
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 16,
  },
  explainTitle: {
    flex: 1,
    color: roman.text,
    fontSize: 13,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  explainBody: {
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    rowGap: 10,
    marginTop: -8,
    marginBottom: 16,
  },
  explainText: { color: roman.textMuted, fontSize: 14, lineHeight: 20 },

  emptyWeek: {
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    rowGap: 6,
  },
  emptyWeekTitle: { color: roman.text, fontSize: 16, lineHeight: 22 },
  emptyText: { color: roman.textMuted, fontSize: 14, lineHeight: 20, textAlign: "center" },

  region: { marginBottom: 16 },
  regionTitle: {
    color: roman.gold,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 12,
  },

  muscle: {
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    rowGap: 6,
  },
  muscleHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    columnGap: 12,
  },
  muscleName: { flex: 1, color: roman.text, fontSize: 16, lineHeight: 22 },
  count: { flexDirection: "row", alignItems: "baseline", columnGap: 6, flexShrink: 0 },
  setCount: { color: roman.text, fontSize: 22, lineHeight: 28 },
  setUnit: { color: roman.textMuted, fontSize: 12 },
  statusText: { fontSize: 13, lineHeight: 18 },

  track: { height: 14, marginTop: 4, position: "relative" },
  trackBar: {
    position: "absolute",
    top: 3,
    left: 0,
    right: 0,
    height: 8,
    borderRadius: 4,
    backgroundColor: roman.background,
    borderColor: roman.border,
    borderWidth: 1,
    overflow: "hidden",
  },
  fill: { height: "100%" },
  tick: {
    position: "absolute",
    top: 0,
    height: 14,
    width: 2,
    marginLeft: -1,
    backgroundColor: roman.textMuted,
  },
  references: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 14,
    rowGap: 2,
  },
  referenceText: { color: roman.textMuted, fontSize: 12, lineHeight: 16 },

  muscleMeta: { flexDirection: "row", alignItems: "center", columnGap: 12 },
  metaText: { color: roman.textMuted, fontSize: 12 },
  quality: { flexDirection: "row", alignItems: "center", columnGap: 3 },
});
