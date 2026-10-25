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
import type { Finding } from "../../src/api/analytics";
import { createDiagnosisLoader, initialDiagnosisState } from "../../src/diagnosis/loader";
import { describeFinding, describeTrainingCoverage } from "../../src/diagnosis/messages";
import { light, lightStatus } from "../../src/lightTheme";

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

/**
 * Severity shown as an icon and a spoken word as well as a colour, so it never
 * rests on colour alone. The colours are the light-surface status tones the
 * Volume screen uses (the same "above MRV / below MEV / optimal / no reference").
 */
const SEVERITY: Record<
  Finding["severity"],
  { color: string; icon: React.ComponentProps<typeof Ionicons>["name"]; label: string }
> = {
  critical: { color: lightStatus.above_mrv.text, icon: "alert-circle", label: "Critical" },
  warning: { color: lightStatus.below_mev.text, icon: "warning-outline", label: "Warning" },
  good: { color: lightStatus.optimal.text, icon: "checkmark-circle-outline", label: "Good" },
  info: { color: lightStatus.no_reference.text, icon: "information-circle-outline", label: "Information" },
};

function FindingCard({ finding }: { finding: Finding }) {
  const copy = describeFinding(finding);
  const severity = SEVERITY[finding.severity];

  return (
    <View
      accessible
      accessibilityLabel={`${severity.label}. ${copy.title}. ${copy.description} ${copy.action}`}
      style={styles.card}
    >
      <View style={styles.cardHeader}>
        <Ionicons name={severity.icon} size={20} color={severity.color} />
        <Text style={[styles.cardTitle, { color: severity.color }]}>{copy.title}</Text>
      </View>
      <Text style={styles.cardDescription}>{copy.description}</Text>
      <View style={styles.cardAction}>
        <Ionicons name="bulb-outline" size={16} color={light.textSecondary} />
        <Text style={styles.cardActionText}>{copy.action}</Text>
      </View>
    </View>
  );
}

export default function DiagnosisScreen() {
  const [weeks, setWeeks] = useState<(typeof PERIODS)[number]>(4);
  const [state, setState] = useState(initialDiagnosisState);
  const [loader] = useState(() => createDiagnosisLoader(analyticsApi.fetchDiagnosis, setState));
  // Do not show the prior period even during the render before the focus effect runs.
  const current = state.weeks === weeks;
  const result = current ? state.result : null;
  const loading = !current || state.loading;
  const refreshing = current && state.refreshing;
  const error = current ? state.error : null;

  useFocusEffect(
    useCallback(() => {
      void loader.load(weeks);
      return () => loader.invalidate();
    }, [loader, weeks]),
  );

  const handleRefresh = () => loader.load(weeks, true);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={light.textSecondary}
        />
      }
    >
      <View style={styles.periodRow}>
        {PERIODS.map((period) => (
          <Pressable
            key={period}
            accessibilityRole="button"
            accessibilityLabel={`${period} weeks`}
            accessibilityState={{ selected: weeks === period }}
            style={[styles.chip, weeks === period && styles.chipActive]}
            onPress={() => {
              if (period === weeks) return;
              loader.invalidate();
              setWeeks(period);
            }}
          >
            <Text style={[styles.chipText, weeks === period && styles.chipTextActive]}>
              {period} weeks
            </Text>
          </Pressable>
        ))}
      </View>

      {!loading && error && (
        <View style={styles.centered}>
          <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
          {result && <Text style={styles.emptyText}>Showing the previous result for this period.</Text>}
          <Pressable accessibilityRole="button" style={styles.retry} onPress={handleRefresh}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      )}

      {!loading && result?.training_coverage && (
        <View style={styles.card}>
          <Text style={styles.cardDescription}>
            {describeTrainingCoverage(result.training_coverage)}
          </Text>
          <Text style={styles.cardDescription}>
            Sleep and weight use the selected {result.period_weeks}-week window through today.
          </Text>
        </View>
      )}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={light.textSecondary} accessibilityLabel="Loading" />
        </View>
      ) : error && !result ? null : !result?.has_enough_data ? (
        <View style={styles.centered}>
          <Ionicons name="hourglass-outline" size={28} color={light.textSecondary} />
          <Text style={styles.emptyTitle}>Not enough training records for this period</Text>
          <Text style={styles.emptyText}>
            {result?.training_coverage
              ? `Working sets must be recorded in at least ${result.training_coverage.required_weeks_with_work} completed weeks. Continue logging or choose a wider period if you have older records.`
              : "More training history is needed before this period can be evaluated."}
          </Text>
        </View>
      ) : result.findings.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="checkmark-circle-outline" size={28} color={light.positive} />
          <Text style={styles.emptyTitle}>Nothing stands out</Text>
          <Text style={styles.emptyText}>
            No findings were generated from the available records for this period.
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
  screen: { flex: 1, backgroundColor: light.background },
  content: { padding: 16, paddingBottom: 32 },
  centered: { alignItems: "center", justifyContent: "center", padding: 32, gap: 8 },
  error: { color: light.danger, fontSize: 15, lineHeight: 21, textAlign: "center", padding: 16 },
  retry: { minHeight: 44, justifyContent: "center", paddingHorizontal: 16 },
  retryText: { color: light.text, fontSize: 15, fontWeight: "600", textDecorationLine: "underline" },

  // Segmented period choice: the selected one is filled, the others outlined;
  // the weeks are in the text, so selection never relies on colour alone.
  periodRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  chip: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: light.surface,
    borderColor: light.separator,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 4,
  },
  chipActive: { backgroundColor: light.primary, borderColor: light.primary },
  chipText: { color: light.text, fontSize: 14, fontWeight: "600" },
  chipTextActive: { color: light.onPrimary },

  emptyTitle: { color: light.text, fontSize: 17, fontWeight: "600", lineHeight: 22, marginTop: 4, textAlign: "center" },
  emptyText: { color: light.textSecondary, fontSize: 15, lineHeight: 21, textAlign: "center" },

  card: {
    backgroundColor: light.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: "600", lineHeight: 22 },
  cardDescription: { color: light.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 8 },
  cardAction: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopColor: light.separator,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cardActionText: { flex: 1, color: light.text, fontSize: 14, lineHeight: 20 },
});
