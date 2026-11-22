/**
 * Review and publish: the coach reads exactly what the athlete would receive as the next
 * numbered version, then confirms. The content and the version number are built by the
 * backend, and the confirmation carries their fingerprint. If the draft changed since it
 * was shown (edited on another device, or another version published), the backend refuses
 * and this screen loads the new version and waits for another explicit confirmation.
 * Publishing replaces a version still waiting for the athlete's answer; it can then no
 * longer be accepted.
 */

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../../../../../../../src/auth/AuthContext";
import { coachingStore } from "../../../../../../../src/coaching/coachingSession";
import { OfferProgramView } from "../../../../../../../src/coaching/OfferProgramView";
import { exerciseCount } from "../../../../../../../src/coaching/offerDisplay";
import { personName } from "../../../../../../../src/coaching/presentation";
import { programPreparationStore } from "../../../../../../../src/coaching/programPreparationSession";
import { RecipientBanner } from "../../../../../../../src/coaching/RecipientBanner";
import { useProgramPreparation } from "../../../../../../../src/coaching/useProgramPreparation";
import { light } from "../../../../../../../src/lightTheme";

const MIN_TOUCH = 44;

export default function PublishScreen() {
  const { linkId, lineageId } = useLocalSearchParams<{ linkId: string; lineageId: string }>();
  const { user } = useAuth();
  // Keyed by account, athlete and preparation: a different one remounts the body, so a
  // preview or a result from another cannot carry over.
  return (
    <Publish
      key={`${user?.id ?? "signed-out"}:${linkId}:${lineageId}`}
      userId={user?.id ?? null}
      linkId={linkId}
      lineageId={lineageId}
    />
  );
}

function Publish({
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
  // Display only: a refusal or an uncertain publish reads as an error.
  const [noticeFailed, setNoticeFailed] = useState(false);
  const shown = view.preview.lineageId === lineageId ? view.preview : null;
  const preview = shown?.data ?? null;
  const publishing = view.publishing;

  useFocusEffect(
    useCallback(() => {
      coachingStore.bind(userId);
      programPreparationStore.bind(userId);
      programPreparationStore.bindLink(linkId);
      void programPreparationStore.loadPreview(lineageId);
      return () => programPreparationStore.closeDetail();
    }, [userId, linkId, lineageId]),
  );

  const padding = { paddingBottom: Math.max(insets.bottom, 16) + 24 };

  const publish = async () => {
    if (!preview) return;
    setNotice(null);
    setNoticeFailed(false);
    const outcome = await programPreparationStore.publishVersion(lineageId, preview.fingerprint);
    if (outcome.kind === "ignored" || outcome.kind === "stale") return;
    if (outcome.kind === "changed") {
      // Nothing was published. Show the current version; publishing it is a new decision.
      void programPreparationStore.loadPreview(lineageId, true);
      setNotice(`${outcome.message} The updated version is shown below.`);
      setNoticeFailed(true);
      return;
    }
    if (outcome.kind === "done") {
      // Back to the preparation this screen was opened from; it reloads on focus and
      // shows the new version, so no second copy of it is left in the stack.
      if (router.canGoBack()) router.back();
      else router.replace(`/coaching/athlete/${linkId}/programs/${lineageId}`);
      return;
    }
    setNotice(outcome.message);
    setNoticeFailed(true);
  };

  if (shown?.unavailable) {
    return (
      <View style={[styles.screen, styles.content, padding]}>
        <Text accessibilityRole="alert" style={styles.empty}>
          This preparation is no longer available. The connection with this athlete may have
          ended, so nothing can be published.
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

  if (!preview) {
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
              onPress={() => void programPreparationStore.loadPreview(lineageId)}
            >
              <Text style={styles.secondaryText}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <ActivityIndicator color={light.textSecondary} accessibilityLabel="Loading preview" />
        )}
        {notice ? (
          <Text accessibilityRole="alert" style={noticeFailed ? styles.error : styles.notice}>
            {notice}
          </Text>
        ) : null}
      </View>
    );
  }

  const athlete = personName(preview.athlete);
  const empty = exerciseCount(preview.program) === 0;
  const blocked = publishing || empty;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, padding]}
      keyboardShouldPersistTaps="handled"
    >
      {/* The recipient and the version stay in view from reading to confirming. */}
      <RecipientBanner athlete={preview.athlete} label="Publishing to" />
      <Text accessibilityRole="header" style={styles.version}>
        Version {preview.version}
      </Text>
      <Text style={styles.intro}>
        Nothing has been sent yet. Read the program below, then confirm.
      </Text>

      {shown?.changed ? (
        <View style={styles.changed} accessibilityRole="alert">
          <View style={styles.changedHead}>
            <Ionicons name="alert-circle-outline" size={18} color={light.text} />
            <Text style={styles.changedTitle}>This program changed</Text>
          </View>
          <Text style={styles.body}>
            Nothing was published. Read the updated version below and confirm again to publish it.
          </Text>
        </View>
      ) : null}

      {preview.replaces_version !== null ? (
        <View style={styles.card}>
          <Text style={styles.body}>
            Version {preview.replaces_version} is still waiting for {athlete}&apos;s answer. Publishing
            this version replaces it: {athlete} will only be able to answer version {preview.version}.
          </Text>
        </View>
      ) : null}

      <OfferProgramView program={preview.program} />

      {notice ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={noticeFailed ? styles.error : styles.notice}
        >
          {notice}
        </Text>
      ) : null}

      <View style={styles.card}>
        {empty ? (
          <Text style={styles.error}>
            This program has no exercises yet, so there is nothing to publish. Edit the draft first.
          </Text>
        ) : (
          <Text style={styles.body}>
            Publishing shares the program above, including any notes on it. {athlete} can add it as
            their own copy or decline; you cannot open or edit their copy. This version can never be
            changed afterwards; later edits go into the next version.
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Publish version ${preview.version} to ${athlete}`}
          accessibilityState={{ busy: publishing, disabled: blocked }}
          disabled={blocked}
          style={({ pressed }) => [
            styles.primary,
            pressed && styles.primaryPressed,
            blocked && styles.busy,
          ]}
          onPress={() => void publish()}
        >
          {publishing ? (
            <ActivityIndicator color={light.onPrimary} />
          ) : (
            <Text style={styles.primaryText}>
              {shown?.changed
                ? `Publish updated version ${preview.version} to ${athlete}`
                : `Publish version ${preview.version} to ${athlete}`}
            </Text>
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to the draft"
          accessibilityState={{ disabled: publishing }}
          disabled={publishing}
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          onPress={() => router.back()}
        >
          <Text style={styles.secondaryText}>Back without publishing</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  version: { color: light.text, fontSize: 22, fontWeight: "700", lineHeight: 28 },
  intro: { color: light.textSecondary, fontSize: 14, lineHeight: 21 },
  card: { backgroundColor: light.surface, borderRadius: 12, padding: 16, gap: 8 },
  changed: { backgroundColor: light.surface, borderRadius: 12, padding: 16, gap: 6 },
  changedHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  changedTitle: { color: light.text, fontSize: 16, fontWeight: "700" },
  body: { color: light.textSecondary, fontSize: 14, lineHeight: 21 },
  notice: { color: light.text, fontSize: 14, fontWeight: "500", lineHeight: 20 },
  error: { color: light.danger, fontSize: 14, lineHeight: 20 },
  banner: { backgroundColor: light.surface, borderRadius: 12, padding: 16, gap: 8 },
  empty: {
    color: light.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    paddingVertical: 16,
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
