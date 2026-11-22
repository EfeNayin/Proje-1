/**
 * One preparation: the draft the coach edits for one athlete, and the numbered versions
 * already published from it. Published versions never change; editing the draft changes
 * only the next one. A version waiting for the athlete's answer is replaced, not edited,
 * when a newer one is published.
 */

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { SentOffer } from "../../../../../../../src/api/coaching";
import { useAuth } from "../../../../../../../src/auth/AuthContext";
import { coachingStore } from "../../../../../../../src/coaching/coachingSession";
import {
  OFFER_STATUS_ICON,
  coachStatusLabel,
  lineageStatusText,
  summaryText,
} from "../../../../../../../src/coaching/offerDisplay";
import { formatConnectedDate, personName } from "../../../../../../../src/coaching/presentation";
import { programPreparationStore } from "../../../../../../../src/coaching/programPreparationSession";
import { RecipientBanner } from "../../../../../../../src/coaching/RecipientBanner";
import { useProgramPreparation } from "../../../../../../../src/coaching/useProgramPreparation";
import { light } from "../../../../../../../src/lightTheme";

const MIN_TOUCH = 44;

export default function PreparationScreen() {
  const { linkId, lineageId } = useLocalSearchParams<{ linkId: string; lineageId: string }>();
  const { user } = useAuth();
  // Keyed by account, athlete and preparation: a different one remounts the body.
  return (
    <Preparation
      key={`${user?.id ?? "signed-out"}:${linkId}:${lineageId}`}
      userId={user?.id ?? null}
      linkId={linkId}
      lineageId={lineageId}
    />
  );
}

function Preparation({
  userId,
  linkId,
  lineageId,
}: {
  userId: string | null;
  linkId: string;
  lineageId: string;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const view = useProgramPreparation(userId, linkId);
  const [notice, setNotice] = useState<string | null>(null);
  const shown = view.detail.lineageId === lineageId ? view.detail : null;
  const lineage = shown?.data ?? null;

  // Every focus, so a draft edited on its own screen is reflected on return.
  useFocusEffect(
    useCallback(() => {
      coachingStore.bind(userId);
      programPreparationStore.bind(userId);
      programPreparationStore.bindLink(linkId);
      void programPreparationStore.loadDetail(lineageId);
      return () => programPreparationStore.closeDetail();
    }, [userId, linkId, lineageId]),
  );

  const padding = { paddingBottom: Math.max(insets.bottom, 16) + 24 };

  const discard = async () => {
    setNotice(null);
    const outcome = await programPreparationStore.discard(lineageId);
    if (outcome.kind === "ignored" || outcome.kind === "stale") return;
    if (outcome.kind === "done") {
      router.back();
      return;
    }
    setNotice(outcome.message);
  };

  const confirmDiscard = () =>
    Alert.alert(
      "Discard this draft?",
      "The draft is deleted. Nothing was ever sent to the athlete.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: () => void discard() },
      ],
    );

  if (shown?.unavailable) {
    return (
      <View style={[styles.screen, styles.content, padding]}>
        <Text accessibilityRole="alert" style={styles.empty}>
          This preparation is no longer available. The connection with this athlete may have
          ended.
        </Text>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          onPress={() => router.back()}
        >
          <Text style={styles.secondaryText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  if (!lineage) {
    return (
      <View style={[styles.screen, styles.content, padding]}>
        {shown?.error ? (
          <View style={styles.banner}>
            <Text accessibilityRole="alert" style={styles.error}>
              {shown.error}
            </Text>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
              onPress={() => void programPreparationStore.loadDetail(lineageId)}
            >
              <Text style={styles.secondaryText}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <ActivityIndicator color={light.textSecondary} accessibilityLabel="Loading preparation" />
        )}
      </View>
    );
  }

  const athlete = personName(lineage.athlete);
  const neverPublished = lineage.versions.length === 0;
  const waiting = lineage.pending_version;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, padding]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={Boolean(shown?.loading)}
          onRefresh={() => void programPreparationStore.loadDetail(lineageId)}
          tintColor={light.textSecondary}
        />
      }
    >
      <RecipientBanner athlete={lineage.athlete} />

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.cardTitle}>
          {lineage.name}
        </Text>
        <Text style={styles.meta}>{lineageStatusText(lineage.latest_version, lineage.latest_status)}</Text>
        {lineage.has_unpublished_changes ? (
          <View style={styles.statusRow}>
            <Ionicons name="create-outline" size={16} color={light.text} accessible={false} />
            <Text style={styles.status}>
              {neverPublished
                ? "Draft: not published yet"
                : "The draft has changes that are not published yet"}
            </Text>
          </View>
        ) : null}
        <Text style={styles.body}>
          Only you can see the draft. {athlete} sees a version once you publish it, and nothing in
          a published version changes afterwards.
        </Text>
      </View>

      {shown?.error ? (
        <View style={styles.banner}>
          <Text accessibilityRole="alert" style={styles.error}>
            Could not refresh. {shown.error}
          </Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Edit the draft prepared for ${athlete}`}
        accessibilityHint="Opens the program editor"
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        onPress={() => router.push(`/program/${lineage.draft_program_id}`)}
      >
        <Text style={styles.rowTitle}>Edit draft</Text>
        <Ionicons name="chevron-forward" size={18} color={light.textSecondary} />
      </Pressable>

      <View style={styles.card}>
        <Text style={styles.body}>
          {waiting !== null
            ? `Version ${waiting} is waiting for ${athlete}'s answer. Publishing a new version replaces it: ${athlete} can then only answer the new one.`
            : neverPublished
              ? `Review exactly what ${athlete} would receive before it is sent.`
              : `Publishing creates version ${(lineage.latest_version ?? 0) + 1}. Earlier versions stay as they are.`}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Review and publish for ${athlete}`}
          style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
          onPress={() => router.push(`/coaching/athlete/${linkId}/programs/${lineageId}/publish`)}
        >
          <Text style={styles.primaryText}>Review and publish</Text>
        </Pressable>
      </View>

      <Text accessibilityRole="header" style={styles.sectionLabel}>
        Published versions
      </Text>
      {neverPublished ? (
        <Text style={styles.meta}>Nothing published yet.</Text>
      ) : (
        lineage.versions.map((version) => (
          <VersionRow
            key={version.id}
            offer={version}
            onOpen={() =>
              router.push(
                `/coaching/athlete/${linkId}/programs/${lineageId}/version/${version.version}`,
              )
            }
          />
        ))
      )}

      {notice ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>
          {notice}
        </Text>
      ) : null}

      {neverPublished ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Discard this draft"
          accessibilityState={{ busy: view.discarding, disabled: view.discarding }}
          disabled={view.discarding}
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed, view.discarding && styles.busy]}
          onPress={confirmDiscard}
        >
          <Text style={styles.dangerText}>Discard draft</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function VersionRow({ offer, onOpen }: { offer: SentOffer; onOpen: () => void }) {
  const status = coachStatusLabel(offer.status);
  const sent = formatConnectedDate(offer.sent_at);
  const summary = summaryText(offer.template_count, offer.exercise_count);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Version ${offer.version}, ${status}, ${summary}`}
      accessibilityHint="Shows exactly what was published"
      style={({ pressed }) => [styles.versionRow, pressed && styles.pressed]}
      onPress={onOpen}
    >
      <View style={styles.rowText}>
        {/* The word and its icon say where a version stands, never the colour alone. */}
        <View style={styles.statusRow}>
          <Ionicons name={OFFER_STATUS_ICON[offer.status]} size={14} color={light.text} accessible={false} />
          <Text style={styles.status}>
            Version {offer.version} · {status}
          </Text>
        </View>
        <Text style={styles.meta}>{sent ? `${summary} · ${sent}` : summary}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={light.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  card: { backgroundColor: light.surface, borderRadius: 12, padding: 16, gap: 8 },
  cardTitle: { color: light.text, fontSize: 18, fontWeight: "600", lineHeight: 24 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  status: { color: light.text, fontSize: 14, fontWeight: "600", flexShrink: 1 },
  sectionLabel: { color: light.textSecondary, fontSize: 13, fontWeight: "600", marginLeft: 4 },
  body: { color: light.textSecondary, fontSize: 14, lineHeight: 21 },
  meta: { color: light.textSecondary, fontSize: 13, lineHeight: 19 },
  error: { color: light.danger, fontSize: 14, lineHeight: 20 },
  dangerText: { color: light.danger, fontSize: 15, fontWeight: "600", textDecorationLine: "underline" },
  banner: { backgroundColor: light.surface, borderRadius: 12, padding: 16, gap: 8 },
  empty: {
    color: light.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    paddingVertical: 16,
  },
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: light.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  rowTitle: { color: light.text, fontSize: 16, fontWeight: "600" },
  rowText: { flex: 1, gap: 2 },
  versionRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: light.surface,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
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
