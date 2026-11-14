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
import { light, lightStatus } from "../../../src/lightTheme";
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
            { width: percent(bar.fill), backgroundColor: lightStatus[muscle.status].fill },
          ]}
        />
      </View>
      <View style={[styles.tick, { left: percent(bar.mev) }]} />
      <View style={[styles.tick, { left: percent(bar.mav) }]} />
      <View style={[styles.tick, { left: percent(bar.mrv) }]} />
    </View>
  );
}

function MuscleRow({ muscle, divider }: { muscle: MuscleWeeklyVolume; divider: boolean }) {
  const view = describeMuscle(muscle);
  const color = lightStatus[muscle.status].text;

  return (
    // One element for screen readers: the full sentence also carries the
    // marker values the bar can only show visually.
    <View accessible accessibilityLabel={view.accessibilityLabel} style={[styles.muscle, divider && styles.muscleDivider]}>
      <View style={styles.muscleHeader}>
        <Text style={styles.muscleName}>{view.name}</Text>
        <View style={styles.count}>
          <Text style={styles.setCount}>{view.directSets}</Text>
          <Text style={styles.setUnit}>
            {view.directSets === 1 ? "direct set" : "direct sets"}
          </Text>
        </View>
      </View>

      <Text style={[styles.statusText, { color }]}>{view.statusLabel}</Text>

      <LandmarkBar muscle={muscle} />

      {view.references.length > 0 ? (
        <View style={styles.references}>
          {view.references.map((reference) => (
            <Text key={reference} style={styles.referenceText}>
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
            <Text style={styles.metaText}>+{view.indirectSets} indirect</Text>
          ) : null}
          {view.effectiveness !== null ? (
            <View style={styles.quality}>
              <Ionicons name="star" size={11} color={light.textSecondary} />
              <Text style={styles.metaText}>{view.effectiveness.toFixed(1)}</Text>
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
}: {
  message: string;
  busy: boolean;
  onRetry: () => void;
  prefix?: string;
}) {
  return (
    <View style={styles.errorBlock}>
      <Text
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={styles.errorText}
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
          <ActivityIndicator color={light.text} size="small" />
        ) : (
          <Text style={styles.retryText}>Try again</Text>
        )}
      </Pressable>
    </View>
  );
}

export default function VolumeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

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
        <Text accessibilityRole="header" style={styles.topBarTitle}>
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
          <ActivityIndicator color={light.textSecondary} />
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
            />
          ) : (
            <Text style={styles.emptyText}>No weekly data yet.</Text>
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
            tintColor={light.textSecondary}
            colors={[light.textSecondary]}
            progressBackgroundColor={light.surface}
          />
        }
      >
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
              color={olderDisabled ? light.separator : light.text}
            />
          </Pressable>

          <View style={styles.weekLabel}>
            <Text accessibilityRole="header" style={styles.weekTitle}>
              {title}
            </Text>
            {title !== range ? (
              <Text style={styles.weekRange}>{range}</Text>
            ) : null}
            <Text style={styles.weekSubtitle}>
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
              color={newerDisabled ? light.separator : light.text}
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
            <Ionicons name="return-down-back" size={16} color={light.text} />
            <Text style={styles.thisWeekText}>Back to this week</Text>
          </Pressable>
        ) : null}

        {state.error ? (
          <ErrorBlock
            message={state.error}
            busy={state.refreshing}
            onRetry={() => void loader.load()}
            prefix="Showing the last loaded data. Could not refresh:"
          />
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: explainOpen }}
          style={({ pressed }) => [styles.explainHeader, pressed && styles.pressed]}
          onPress={() => setExplainOpen((open) => !open)}
        >
          <Ionicons name="information-circle-outline" size={20} color={light.textSecondary} />
          <Text style={styles.explainTitle}>How volume is counted</Text>
          <Ionicons
            name={explainOpen ? "chevron-up" : "chevron-down"}
            size={18}
            color={light.textSecondary}
          />
        </Pressable>
        {explainOpen ? (
          <View style={styles.explainBody}>
            <Text style={styles.explainText}>
              Each number is the working sets in the week where the exercise lists the muscle as a
              primary target (direct sets). Warm-up sets and sets with 0 reps are not counted.
            </Text>
            <Text style={styles.explainText}>
              Sets where a muscle only assists are shown as “+N indirect” and are not added to the
              count, because MEV, MAV and MRV already allow for that work.
            </Text>
            <Text style={styles.explainText}>
              MEV, MAV and MRV are the reference values stored for each muscle, not personal
              targets. Weeks start on Monday in your timezone.
            </Text>
          </View>
        ) : null}

        {!hasRecords ? (
          <View style={styles.emptyWeek}>
            <Text style={styles.emptyWeekTitle}>No direct sets recorded</Text>
            <Text style={styles.emptyText}>
              Sets logged in Training appear here once they are recorded for this week.
            </Text>
          </View>
        ) : (
          byRegion.map((group) => (
            <View key={group.region} style={styles.region}>
              <Text accessibilityRole="header" style={styles.regionTitle}>
                {REGION_TITLES[group.region] ?? group.region}
              </Text>
              <View style={styles.regionGroup}>
                {group.muscles.map((muscle, index) => (
                  <MuscleRow
                    key={muscle.muscle_group_id}
                    muscle={muscle}
                    divider={index < group.muscles.length - 1}
                  />
                ))}
              </View>
            </View>
          ))
        )}

        {/* A way on to the review, deliberately quieter than the week's data. */}
        <Pressable
          accessibilityRole="button"
          accessibilityHint="Opens the training review"
          style={({ pressed }) => [styles.diagnosisEntry, pressed && styles.pressed]}
          onPress={() => router.push("/diagnosis")}
        >
          <View style={styles.diagnosisEntryText}>
            <Text style={styles.diagnosisEntryTitle}>Why am I not growing?</Text>
            <Text style={styles.diagnosisEntrySubtitle}>
              Volume, recovery and weight trend, combined
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={light.textSecondary} />
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background },
  flex: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  pressed: { backgroundColor: light.pressed },

  topBar: { backgroundColor: light.background, paddingHorizontal: 16 },
  topBarRow: { minHeight: 56, flexDirection: "row", alignItems: "center" },
  topBarTitle: { flexShrink: 1, color: light.text, fontSize: 28, fontWeight: "700" },

  weekBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: light.surface,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginTop: 4,
    marginBottom: 12,
  },
  iconButton: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    alignItems: "center",
    justifyContent: "center",
  },
  weekLabel: { flex: 1, minWidth: 0, alignItems: "center", rowGap: 2, paddingVertical: 4 },
  weekTitle: { color: light.text, fontSize: 17, fontWeight: "600", textAlign: "center" },
  weekRange: { color: light.textSecondary, fontSize: 13, textAlign: "center" },
  weekSubtitle: { color: light.textSecondary, fontSize: 13, textAlign: "center" },
  thisWeekButton: {
    minHeight: MIN_TOUCH,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    columnGap: 6,
    paddingHorizontal: 12,
  },
  thisWeekText: { color: light.text, fontSize: 15, fontWeight: "600" },

  errorBlock: {
    backgroundColor: light.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    rowGap: 4,
  },
  errorText: { color: light.danger, fontSize: 14, fontWeight: "500", lineHeight: 20 },
  retryButton: {
    minHeight: MIN_TOUCH,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingRight: 12,
  },
  retryText: { color: light.text, fontSize: 15, fontWeight: "600" },

  explainHeader: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 10,
    backgroundColor: light.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 16,
  },
  explainTitle: { flex: 1, color: light.text, fontSize: 15, fontWeight: "600" },
  explainBody: {
    backgroundColor: light.surface,
    borderRadius: 12,
    padding: 14,
    rowGap: 10,
    marginTop: -8,
    marginBottom: 16,
  },
  explainText: { color: light.textSecondary, fontSize: 14, lineHeight: 20 },

  emptyWeek: {
    backgroundColor: light.surface,
    borderRadius: 12,
    padding: 16,
    rowGap: 6,
  },
  emptyWeekTitle: { color: light.text, fontSize: 17, fontWeight: "600" },
  emptyText: { color: light.textSecondary, fontSize: 14, lineHeight: 20, textAlign: "center" },

  region: { marginBottom: 16 },
  regionTitle: { color: light.textSecondary, fontSize: 13, fontWeight: "600", marginBottom: 8, marginLeft: 4 },
  // One grouped surface per region; rows are separated by hairlines.
  regionGroup: { backgroundColor: light.surface, borderRadius: 12, overflow: "hidden" },

  muscle: {
    padding: 16,
    rowGap: 6,
  },
  muscleDivider: { borderBottomColor: light.separator, borderBottomWidth: StyleSheet.hairlineWidth },
  muscleHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    columnGap: 12,
  },
  muscleName: { flex: 1, minWidth: 0, color: light.text, fontSize: 17, fontWeight: "600" },
  count: { flexDirection: "row", alignItems: "baseline", columnGap: 6, flexShrink: 0 },
  setCount: { color: light.text, fontSize: 22, fontWeight: "600", fontVariant: ["tabular-nums"] },
  setUnit: { color: light.textSecondary, fontSize: 13 },
  statusText: { fontSize: 14, fontWeight: "600", lineHeight: 18 },

  track: { height: 14, marginTop: 4, position: "relative" },
  trackBar: {
    position: "absolute",
    top: 3,
    left: 0,
    right: 0,
    height: 8,
    borderRadius: 4,
    backgroundColor: light.pressed,
    overflow: "hidden",
  },
  fill: { height: "100%" },
  tick: {
    position: "absolute",
    top: 0,
    height: 14,
    width: 2,
    marginLeft: -1,
    backgroundColor: light.textSecondary,
  },
  references: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 14,
    rowGap: 2,
  },
  referenceText: { color: light.textSecondary, fontSize: 13, lineHeight: 18, fontVariant: ["tabular-nums"] },

  muscleMeta: { flexDirection: "row", alignItems: "center", columnGap: 12 },
  metaText: { color: light.textSecondary, fontSize: 13 },
  quality: { flexDirection: "row", alignItems: "center", columnGap: 3 },

  diagnosisEntry: {
    minHeight: MIN_TOUCH + 8,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 8,
    backgroundColor: light.surface,
    borderRadius: 12,
    paddingVertical: 10,
    paddingLeft: 16,
    paddingRight: 14,
    marginTop: 8,
  },
  diagnosisEntryText: { flex: 1, minWidth: 0, rowGap: 2 },
  diagnosisEntryTitle: { color: light.text, fontSize: 16, fontWeight: "600" },
  diagnosisEntrySubtitle: { color: light.textSecondary, fontSize: 13, lineHeight: 18 },
});
