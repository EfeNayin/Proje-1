/**
 * "Why am I not growing" — the product's actual promise.
 *
 * Volume, recovery and weight trend all have their own screens already;
 * this one is the synthesis, so it lives one tap away from Volume (see the
 * entry card at the top of app/(app)/(tabs)/volume.tsx) rather than as a
 * 5th tab. It has its own period selector (4/8/12 weeks) instead of Volume's
 * week-by-week browser.
 *
 * It is a rule-based reading of what the user recorded, not a diagnosis. The screen
 * first says what each area (training, sleep, body weight) rests on, with that area's
 * own dates and one of five distinct states, then lists the few observations those
 * records support, each with a suggestion and a real place to act. It never says why
 * progress is slow and never calls the whole assessment complete. The logic that builds
 * this view lives in src/diagnosis/assessment.ts.
 */

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as analyticsApi from "../../src/api/analytics";
import { useAuth } from "../../src/auth/AuthContext";
import { buildAssessment, hrefFor } from "../../src/diagnosis/assessment";
import type {
  AssessmentAction,
  DomainView,
  ObservationView,
} from "../../src/diagnosis/assessment";
import { createDiagnosisLoader, initialDiagnosisState } from "../../src/diagnosis/loader";
import { light, lightStatus } from "../../src/lightTheme";

const PERIODS = [4, 8, 12] as const;

/** A word and an icon say how much a domain's records can support; colour never carries it alone. */
const STATE_ICON: Record<DomainView["state"], React.ComponentProps<typeof Ionicons>["name"]> = {
  sufficient: "checkmark-circle-outline",
  insufficient: "hourglass-outline",
  stale: "time-outline",
  missing: "remove-circle-outline",
  not_applicable: "information-circle-outline",
};

const KIND: Record<
  ObservationView["kind"],
  { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; color: string }
> = {
  check: { icon: "eye-outline", label: "Worth checking", color: lightStatus.below_mev.text },
  consistent: { icon: "checkmark-circle-outline", label: "Looks consistent", color: lightStatus.optimal.text },
};

function Actions({
  actions,
  onOpen,
}: {
  actions: AssessmentAction[];
  onOpen: (action: AssessmentAction) => void;
}) {
  if (actions.length === 0) return null;
  return (
    <View style={styles.actions}>
      {actions.map((action, index) => (
        <Pressable
          key={action.label}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          accessibilityHint={action.hint}
          style={({ pressed }) => [
            index === 0 ? styles.actionPrimary : styles.actionSecondary,
            pressed && styles.pressed,
          ]}
          onPress={() => onOpen(action)}
        >
          <Text style={index === 0 ? styles.actionPrimaryText : styles.actionSecondaryText}>
            {action.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function DomainCard({ view, onOpen }: { view: DomainView; onOpen: (action: AssessmentAction) => void }) {
  return (
    <View style={styles.card}>
      <View
        accessible
        accessibilityRole="header"
        accessibilityLabel={`${view.title}: ${view.stateLabel}`}
        style={styles.cardHeader}
      >
        <Ionicons name={STATE_ICON[view.state]} size={20} color={light.text} accessible={false} />
        <Text style={styles.cardTitle}>{view.title}</Text>
        <Text style={styles.stateLabel}>{view.stateLabel}</Text>
      </View>
      <Text style={styles.cardDescription}>{view.windowText}</Text>
      <Text style={styles.cardDescription}>{view.recordsText}</Text>
      <Text style={styles.cardNote}>{view.note}</Text>
      <Actions actions={view.actions} onOpen={onOpen} />
    </View>
  );
}

function ObservationCard({
  view,
  number,
  onOpen,
}: {
  view: ObservationView;
  number: number | null;
  onOpen: (action: AssessmentAction) => void;
}) {
  const kind = KIND[view.kind];
  const prefix = number ? `${number}. ` : "";
  return (
    <View style={styles.card}>
      <View
        accessible
        accessibilityLabel={`${prefix}${kind.label}. ${view.title}. ${view.description} Suggestion: ${view.suggestion}`}
      >
        <View style={styles.cardHeader}>
          <Ionicons name={kind.icon} size={18} color={kind.color} accessible={false} />
          <Text style={[styles.kindLabel, { color: kind.color }]}>
            {prefix}
            {kind.label}
          </Text>
        </View>
        <Text style={styles.observationTitle}>{view.title}</Text>
        <Text style={styles.cardDescription}>{view.description}</Text>
        <View style={styles.cardAction}>
          <Ionicons name="bulb-outline" size={16} color={light.textSecondary} accessible={false} />
          <Text style={styles.cardActionText}>{view.suggestion}</Text>
        </View>
      </View>
      <Actions actions={view.actions} onOpen={onOpen} />
    </View>
  );
}

export default function DiagnosisScreen() {
  const { user } = useAuth();
  // Keyed by account so a different user never sees, or reloads over, another's result.
  return <Diagnosis key={user?.id ?? "signed-out"} />;
}

function Diagnosis() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [weeks, setWeeks] = useState<(typeof PERIODS)[number]>(4);
  const [state, setState] = useState(initialDiagnosisState);
  const [loader] = useState(() => createDiagnosisLoader(analyticsApi.fetchDiagnosis, setState));
  // Do not show the prior period even during the render before the focus effect runs.
  const current = state.weeks === weeks;
  const result = current ? state.result : null;
  const loading = !current || state.loading;
  const refreshing = current && state.refreshing;
  const error = current ? state.error : null;
  const view = useMemo(() => (result ? buildAssessment(result) : null), [result]);

  // Every focus, so a sleep record saved on the check-in screen is reflected on return.
  useFocusEffect(
    useCallback(() => {
      void loader.load(weeks);
      return () => loader.invalidate();
    }, [loader, weeks]),
  );

  const handleRefresh = () => loader.load(weeks, true);

  const open = (action: AssessmentAction) => {
    const href = hrefFor(action.target);
    // The two tab destinations switch tabs instead of stacking another copy on top.
    if (action.target.kind === "volume" || action.target.kind === "training-records") {
      router.navigate(href as never);
    } else {
      router.push(href as never);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
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

      {!loading && error ? (
        <View style={styles.centered}>
          <Text accessibilityRole="alert" style={styles.error}>
            {result ? `Could not refresh. ${error}` : error}
          </Text>
          {result ? (
            <Text style={styles.emptyText}>Showing the previous result for this period.</Text>
          ) : null}
          <Pressable accessibilityRole="button" style={styles.retry} onPress={handleRefresh}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={light.textSecondary} accessibilityLabel="Loading" />
        </View>
      ) : view && result ? (
        <>
          <Text accessibilityRole="header" style={styles.sectionLabel}>
            What was evaluated
          </Text>
          <Text style={styles.intro}>
            Each area is judged on its own records and dates. {view.sufficientCount} of 3 have
            enough records for the last {result.period_weeks} weeks.
          </Text>
          {view.domains.map((domain) => (
            <DomainCard key={domain.key} view={domain} onOpen={open} />
          ))}

          <Text accessibilityRole="header" style={styles.sectionLabel}>
            Observations
          </Text>
          {view.observations.map((observation, index) => (
            <ObservationCard
              key={observation.key}
              view={observation}
              number={observation.kind === "check" ? index + 1 : null}
              onOpen={open}
            />
          ))}
          {view.empty ? (
            <View style={styles.card} accessibilityLiveRegion="polite">
              <View style={styles.cardHeader}>
                <Ionicons
                  name={view.empty.kind === "insufficient" ? "hourglass-outline" : "information-circle-outline"}
                  size={20}
                  color={light.text}
                  accessible={false}
                />
                <Text style={styles.cardTitle}>{view.empty.title}</Text>
              </View>
              <Text style={styles.cardDescription}>{view.empty.text}</Text>
            </View>
          ) : null}

          <View style={styles.limits}>
            {view.limitations.map((line) => (
              <Text key={line} style={styles.limitText}>
                {line}
              </Text>
            ))}
            {view.referenceNote ? <Text style={styles.limitText}>{view.referenceNote}</Text> : null}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background },
  content: { padding: 16 },
  centered: { alignItems: "center", justifyContent: "center", padding: 32, gap: 8 },
  error: { color: light.danger, fontSize: 15, lineHeight: 21, textAlign: "center", padding: 16 },
  retry: { minHeight: 44, justifyContent: "center", paddingHorizontal: 16 },
  retryText: { color: light.text, fontSize: 15, fontWeight: "600", textDecorationLine: "underline" },
  pressed: { backgroundColor: light.pressed },

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

  sectionLabel: { color: light.textSecondary, fontSize: 13, fontWeight: "600", marginLeft: 4, marginTop: 8, marginBottom: 6 },
  intro: { color: light.textSecondary, fontSize: 14, lineHeight: 20, marginHorizontal: 4, marginBottom: 12 },
  emptyText: { color: light.textSecondary, fontSize: 15, lineHeight: 21, textAlign: "center" },

  card: {
    backgroundColor: light.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  cardTitle: { flex: 1, color: light.text, fontSize: 16, fontWeight: "600", lineHeight: 22 },
  stateLabel: { color: light.text, fontSize: 13, fontWeight: "600", lineHeight: 22, flexShrink: 1, textAlign: "right" },
  kindLabel: { flex: 1, fontSize: 13, fontWeight: "700", lineHeight: 18 },
  observationTitle: { color: light.text, fontSize: 16, fontWeight: "600", lineHeight: 22, marginTop: 6 },
  cardDescription: { color: light.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 8 },
  cardNote: { color: light.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 8 },
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

  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 12 },
  actionPrimary: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: light.primary,
  },
  actionPrimaryText: { color: light.onPrimary, fontSize: 14, fontWeight: "600" },
  actionSecondary: { minHeight: 44, justifyContent: "center", paddingHorizontal: 6, borderRadius: 8 },
  actionSecondaryText: { color: light.text, fontSize: 14, fontWeight: "600", textDecorationLine: "underline" },

  limits: { gap: 8, marginTop: 8, paddingHorizontal: 4 },
  limitText: { color: light.textSecondary, fontSize: 12, lineHeight: 18 },
});
