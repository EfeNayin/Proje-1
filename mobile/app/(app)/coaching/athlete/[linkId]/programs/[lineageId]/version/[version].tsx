/**
 * One published version, exactly as the athlete received it: every day and prescription,
 * read-only. A published version never changes, so this is a record of what was offered,
 * not of what the athlete does with it: "Accepted" only means they added their own copy.
 */

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getLineageVersion } from "../../../../../../../../src/api/coaching";
import type { SentOfferDetail } from "../../../../../../../../src/api/coaching";
import { useAuth } from "../../../../../../../../src/auth/AuthContext";
import { OfferProgramView } from "../../../../../../../../src/coaching/OfferProgramView";
import { OFFER_STATUS_ICON, coachStatusLabel } from "../../../../../../../../src/coaching/offerDisplay";
import { formatConnectedDate } from "../../../../../../../../src/coaching/presentation";
import { light } from "../../../../../../../../src/lightTheme";

const MIN_TOUCH = 44;

export default function VersionScreen() {
  const { linkId, lineageId, version } = useLocalSearchParams<{
    linkId: string;
    lineageId: string;
    version: string;
  }>();
  const { user } = useAuth();
  // Keyed by account and version: a different one remounts the body.
  return (
    <Version
      key={`${user?.id ?? "signed-out"}:${linkId}:${lineageId}:${version}`}
      linkId={linkId}
      lineageId={lineageId}
      version={Number(version)}
    />
  );
}

function Version({
  linkId,
  lineageId,
  version,
}: {
  linkId: string;
  lineageId: string;
  version: number;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [offer, setOffer] = useState<SentOfferDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const latest = useRef(0);

  const load = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      const mine = ++latest.current;
      setError(null);
      try {
        const result = await getLineageVersion(linkId, lineageId, version);
        if (isCancelled() || mine !== latest.current) return;
        setOffer(result);
      } catch (failure) {
        if (isCancelled() || mine !== latest.current) return;
        if ((failure as { status?: unknown } | null)?.status === 404) {
          setUnavailable(true);
          return;
        }
        setError(failure instanceof Error ? failure.message : "Could not load this version");
      }
    },
    [linkId, lineageId, version],
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void load(() => cancelled);
      return () => {
        cancelled = true;
        latest.current += 1;
      };
    }, [load]),
  );

  const padding = { paddingBottom: Math.max(insets.bottom, 16) + 24 };

  if (unavailable) {
    return (
      <View style={[styles.screen, styles.content, padding]}>
        <Text accessibilityRole="alert" style={styles.empty}>
          This version is no longer available. The connection with this athlete may have ended.
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

  if (!offer) {
    return (
      <View style={[styles.screen, styles.content, padding]}>
        {error ? (
          <View style={styles.banner}>
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
              onPress={() => void load()}
            >
              <Text style={styles.secondaryText}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <ActivityIndicator color={light.textSecondary} accessibilityLabel="Loading version" />
        )}
      </View>
    );
  }

  const sent = formatConnectedDate(offer.sent_at);
  const answered = offer.responded_at ? formatConnectedDate(offer.responded_at) : "";
  const replaced = offer.superseded_at ? formatConnectedDate(offer.superseded_at) : "";

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, padding]}>
      <View style={styles.card}>
        <View style={styles.statusRow}>
          <Ionicons name={OFFER_STATUS_ICON[offer.status]} size={16} color={light.text} accessible={false} />
          <Text style={styles.status}>
            Version {offer.version} · {coachStatusLabel(offer.status)}
          </Text>
        </View>
        {sent ? <Text style={styles.meta}>Published {sent}</Text> : null}
        {answered ? (
          <Text style={styles.meta}>
            {offer.status === "accepted" ? "Accepted" : "Declined"} {answered}
          </Text>
        ) : null}
        {replaced ? <Text style={styles.meta}>Replaced {replaced}</Text> : null}
        <Text style={styles.body}>
          This is exactly what the athlete received. It never changes. Accepted only means the
          athlete added their own copy; it does not say whether they follow it.
        </Text>
      </View>
      <OfferProgramView program={offer.program} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  card: { backgroundColor: light.surface, borderRadius: 12, padding: 16, gap: 6 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  status: { color: light.text, fontSize: 15, fontWeight: "600", flexShrink: 1 },
  body: { color: light.textSecondary, fontSize: 14, lineHeight: 21, marginTop: 4 },
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
  secondary: {
    minHeight: MIN_TOUCH,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  secondaryText: { color: light.text, fontSize: 15, fontWeight: "600", textDecorationLine: "underline" },
  pressed: { backgroundColor: light.pressed },
});
