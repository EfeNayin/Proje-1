/**
 * "Why am I not growing" — the product's actual promise.
 *
 * Volume, recovery and weight trend all have their own screens already;
 * this one is the synthesis, so it lives one tap away from Volume (see the
 * entry card at the top of app/(app)/(tabs)/volume.tsx) rather than as a
 * 5th tab. Reached from Volume, not buried in Profile, but it's its own
 * route — not a second view toggled in place — because it has its own
 * period selector (4/8/12 weeks) instead of Volume's week-by-week browser,
 * and cramming both interaction models into one screen would have made
 * neither of them simple.
 */

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import * as analyticsApi from "../../src/api/analytics";
import type { DiagnosisResponse, Finding } from "../../src/api/analytics";
import { describeFinding } from "../../src/diagnosis/messages";
import { colors, findingSeverityColors, radius, spacing } from "../../src/theme";

const PERIODS = [4, 8, 12] as const;

/**
 * The code alone can repeat within one response (volume_below_mev per
 * muscle, muscles_untrained per region), so fold in whichever field tells
 * those apart. Every other code is emitted at most once, so the code by
 * itself is already unique for them.
 */
function findingKey(finding: Finding): string {
  const discriminator = finding.data.muscle ?? finding.data.region;
  return discriminator ? `${finding.code}-${String(discriminator)}` : finding.code;
}

function FindingCard({ finding }: { finding: Finding }) {
  const copy = describeFinding(finding);
  const color = findingSeverityColors[finding.severity];

  return (
    <View style={[styles.card, { borderLeftColor: color }]}>
      <Text style={[styles.cardTitle, { color }]}>{copy.title}</Text>
      <Text style={styles.cardDescription}>{copy.description}</Text>
      <View style={styles.cardAction}>
        <Ionicons name="bulb-outline" size={14} color={colors.textMuted} />
        <Text style={styles.cardActionText}>{copy.action}</Text>
      </View>
    </View>
  );
}

export default function DiagnosisScreen() {
  const [weeks, setWeeks] = useState<(typeof PERIODS)[number]>(4);
  const [result, setResult] = useState<DiagnosisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (forWeeks: number) => {
    const data = await analyticsApi.fetchDiagnosis(forWeeks);
    setResult(data);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      setError(null);
      load(weeks)
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : "Could not load diagnosis");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [load, weeks]),
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await load(weeks).catch(() => undefined);
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} />
      }
    >
      <View style={styles.periodRow}>
        {PERIODS.map((period) => (
          <Pressable
            key={period}
            style={[styles.chip, weeks === period && styles.chipActive]}
            onPress={() => setWeeks(period)}
          >
            <Text style={[styles.chipText, weeks === period && styles.chipTextActive]}>
              {period} weeks
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : !result?.has_enough_data ? (
        <View style={styles.centered}>
          <Ionicons name="hourglass-outline" size={28} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Not enough history yet</Text>
          <Text style={styles.emptyText}>
            At least 2 weeks of training history is needed for a diagnosis.
          </Text>
        </View>
      ) : result.findings.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="checkmark-circle-outline" size={28} color={colors.accent} />
          <Text style={styles.emptyTitle}>Nothing stands out</Text>
          <Text style={styles.emptyText}>
            Volume, recovery and weight trend all look fine for this period.
          </Text>
        </View>
      ) : (
        result.findings.map((finding) => (
          // The code alone is not unique: volume_below_mev/above_mrv can
          // list several muscles, and muscles_untrained several regions, in
          // the same response. muscle/region together with the code is.
          <FindingCard key={findingKey(finding)} finding={finding} />
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  centered: { alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.sm },
  error: { color: colors.danger, textAlign: "center", padding: spacing.lg },

  periodRow: { flexDirection: "row", gap: spacing.xs, marginBottom: spacing.lg },
  chip: {
    flex: 1,
    alignItems: "center",
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: colors.accentText },

  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: "700", marginTop: spacing.xs },
  emptyText: { color: colors.textMuted, fontSize: 13, textAlign: "center" },

  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderLeftWidth: 3,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardTitle: { fontSize: 15, fontWeight: "700" },
  cardDescription: { color: colors.textMuted, fontSize: 13, marginTop: spacing.xs, lineHeight: 18 },
  cardAction: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cardActionText: { flex: 1, color: colors.textMuted, fontSize: 12, lineHeight: 16 },
});
