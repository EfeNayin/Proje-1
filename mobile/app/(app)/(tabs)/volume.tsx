/**
 * Weekly volume against hypertrophy landmarks.
 *
 * The screen the product exists for. Each muscle shows how many *direct* sets
 * it got that week and where that sits between MEV, MAV and MRV.
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

import * as analyticsApi from "../../../src/api/analytics";
import type { MuscleWeeklyVolume, WeeklyVolume } from "../../../src/api/analytics";
import { colors, radius, spacing, statusColors, statusLabels } from "../../../src/theme";

const WEEKS_TO_LOAD = 8;

const REGION_TITLES: Record<string, string> = {
  upper: "Upper body",
  lower: "Lower body",
  core: "Core",
};

/**
 * `muscle.name` is the backend's machine code (e.g. "front_delts"), not a
 * display string — every other piece of English copy on this screen is
 * already a real title ("Upper body", "Not trained", ...). Splits on "_"
 * and title-cases each word: "front_delts" -> "Front Delts", "biceps" ->
 * "Biceps". Covers all 17 muscle codes in the catalogue without a lookup
 * table, so a new one added later does not need this list updated.
 */
function formatMuscleName(name: string): string {
  return name
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatWeek(weekStart: string, offset: number): string {
  if (offset === 0) return "This week";
  if (offset === 1) return "Last week";

  const start = new Date(`${weekStart}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  const format = (date: Date) =>
    date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${format(start)} – ${format(end)}`;
}

/**
 * A bar showing where the week's sets fall between the landmarks.
 *
 * The track runs to MRV, with ticks at MEV and MAV, so the shape of the bar
 * answers "am I doing enough" without reading any numbers. Sets past MRV
 * simply fill the track — the colour carries that message.
 */
function LandmarkBar({ muscle }: { muscle: MuscleWeeklyVolume }) {
  const { direct_sets: sets, mev, mav, mrv, status } = muscle;

  if (mev === null || mav === null || mrv === null) {
    return null;
  }

  // React Native types percentages as the literal `${number}%`, so a plain
  // string will not do here.
  const percent = (value: number): `${number}%` =>
    `${Math.min(100, (value / mrv) * 100)}%`;

  return (
    <View style={styles.track}>
      <View
        style={[styles.fill, { width: percent(sets), backgroundColor: statusColors[status] }]}
      />
      <View style={[styles.tick, { left: percent(mev) }]} />
      <View style={[styles.tick, { left: percent(mav) }]} />
    </View>
  );
}

function MuscleRow({ muscle }: { muscle: MuscleWeeklyVolume }) {
  const untrained = muscle.status === "untrained";
  // Sets the muscle only assisted on. Worth surfacing so a user does not
  // "fix" low direct triceps volume that pressing is already covering.
  const assisted = muscle.involved_sets - muscle.direct_sets;

  return (
    <View style={[styles.muscle, untrained && styles.muscleDim]}>
      <View style={styles.muscleHeader}>
        <Text style={styles.muscleName}>{formatMuscleName(muscle.name)}</Text>
        <View style={styles.muscleNumbers}>
          <Text style={[styles.setCount, { color: statusColors[muscle.status] }]}>
            {muscle.direct_sets}
          </Text>
          {muscle.mav !== null ? <Text style={styles.setTarget}> / {muscle.mav}</Text> : null}
        </View>
      </View>

      <LandmarkBar muscle={muscle} />

      <View style={styles.muscleFooter}>
        <Text style={[styles.statusText, { color: statusColors[muscle.status] }]}>
          {statusLabels[muscle.status]}
        </Text>
        <View style={styles.muscleMeta}>
          {assisted > 0 ? <Text style={styles.metaText}>+{assisted} indirect</Text> : null}
          {muscle.avg_effectiveness !== null ? (
            <View style={styles.quality}>
              <Ionicons name="star" size={11} color={colors.textMuted} />
              <Text style={styles.metaText}>{muscle.avg_effectiveness.toFixed(1)}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

export default function VolumeScreen() {
  const router = useRouter();
  const [weeks, setWeeks] = useState<WeeklyVolume[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await analyticsApi.fetchWeeklyVolume(WEEKS_TO_LOAD);
    setWeeks(data.weeks);
  }, []);

  // Reload on focus so sets logged a moment ago are already reflected.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      load()
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : "Could not load volume");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [load]),
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await load().catch(() => undefined);
    setRefreshing(false);
  };

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

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!week) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error ?? "No data yet."}</Text>
      </View>
    );
  }

  const trainedCount = week.muscles.filter((muscle) => muscle.direct_sets > 0).length;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} />
      }
    >
      <Pressable style={styles.diagnosisEntry} onPress={() => router.push("/diagnosis")}>
        <View style={styles.diagnosisEntryText}>
          <Text style={styles.diagnosisEntryTitle}>Why am I not growing?</Text>
          <Text style={styles.diagnosisEntrySubtitle}>
            Volume, recovery and weight trend, combined
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </Pressable>

      <View style={styles.weekBar}>
        <Pressable
          onPress={() => setOffset((value) => Math.min(weeks.length - 1, value + 1))}
          disabled={offset >= weeks.length - 1}
          hitSlop={12}
        >
          <Ionicons
            name="chevron-back"
            size={22}
            color={offset >= weeks.length - 1 ? colors.border : colors.text}
          />
        </Pressable>

        <View style={styles.weekLabel}>
          <Text style={styles.weekTitle}>{formatWeek(week.week_start, offset)}</Text>
          <Text style={styles.weekSubtitle}>{trainedCount} muscles trained</Text>
        </View>

        <Pressable
          onPress={() => setOffset((value) => Math.max(0, value - 1))}
          disabled={offset === 0}
          hitSlop={12}
        >
          <Ionicons name="chevron-forward" size={22} color={offset === 0 ? colors.border : colors.text} />
        </Pressable>
      </View>

      {byRegion.map((group) => (
        <View key={group.region} style={styles.region}>
          <Text style={styles.regionTitle}>{REGION_TITLES[group.region] ?? group.region}</Text>
          {group.muscles.map((muscle) => (
            <MuscleRow key={muscle.muscle_group_id} muscle={muscle} />
          ))}
        </View>
      ))}

      <Text style={styles.legend}>
        Counts direct sets only. Assistance work is already accounted for in the MEV/MAV/MRV
        numbers, so counting it twice would overstate your volume.
      </Text>
    </ScrollView>
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
    padding: spacing.lg,
  },
  error: { color: colors.danger, textAlign: "center" },

  diagnosisEntry: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderColor: colors.accentDark,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  diagnosisEntryText: { flex: 1 },
  diagnosisEntryTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  diagnosisEntrySubtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2 },

  weekBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  weekLabel: { alignItems: "center" },
  weekTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  weekSubtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2 },

  region: { marginBottom: spacing.lg },
  regionTitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
  },

  muscle: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  muscleDim: { opacity: 0.55 },
  muscleHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  muscleName: { color: colors.text, fontSize: 15, fontWeight: "600" },
  muscleNumbers: { flexDirection: "row", alignItems: "baseline" },
  setCount: { fontSize: 20, fontWeight: "700" },
  setTarget: { color: colors.textMuted, fontSize: 13 },

  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.background,
    marginTop: spacing.sm,
    overflow: "hidden",
    position: "relative",
  },
  fill: { height: "100%", borderRadius: 3 },
  tick: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1.5,
    backgroundColor: colors.border,
  },

  muscleFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  statusText: { fontSize: 12, fontWeight: "600" },
  muscleMeta: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  metaText: { color: colors.textMuted, fontSize: 12 },
  quality: { flexDirection: "row", alignItems: "center", gap: 3 },

  legend: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
    marginTop: spacing.sm,
  },
});
