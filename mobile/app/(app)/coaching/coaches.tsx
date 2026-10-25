/**
 * My Coaches: enter an invite code, see which coach it comes from, and connect
 * only after explicitly accepting. Connected coaches are listed here and can
 * be disconnected at any time.
 *
 * A new connection shares nothing. Each connection has its own switch for
 * letting that coach read the athlete's completed workout history; weight and
 * nutrition are never shared. Turning it on needs an explicit confirmation.
 *
 * Programs a coach sends are a separate matter: they arrive as offers (see the
 * entry below), need no workout sharing, and only become the athlete's own
 * program when they accept.
 */

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { InvitePreview } from "../../../src/api/coaching";
import { useAuth } from "../../../src/auth/AuthContext";
import { FocusedDarkStatusBar } from "../../../src/FocusedDarkStatusBar";
import { light } from "../../../src/lightTheme";
import { coachingStore } from "../../../src/coaching/coachingSession";
import { ConnectionRow } from "../../../src/coaching/ConnectionRow";
import { formatExpiry, personHandle, personName } from "../../../src/coaching/presentation";
import { programOffersStore } from "../../../src/coaching/programOffersSession";
import { useCoaching } from "../../../src/coaching/useCoaching";
import { useProgramOffers } from "../../../src/coaching/useProgramOffers";

const MIN_TOUCH = 44;

type Previewed = { code: string; preview: InvitePreview };

export default function MyCoachesScreen() {
  const { user } = useAuth();
  // Keyed by account: switching users remounts the body, so a typed code, a
  // preview or a message from the previous account cannot survive.
  return <MyCoaches key={user?.id ?? "signed-out"} userId={user?.id ?? null} />;
}

function MyCoaches({ userId }: { userId: string | null }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const state = useCoaching(userId);
  const offers = useProgramOffers(userId);
  const waiting = offers.received.items.filter((item) => item.status === "pending").length;
  const [code, setCodeState] = useState("");
  // What the input holds right now, readable from a lookup that finishes later.
  const typed = useRef("");
  const [previewing, setPreviewing] = useState(false);
  const [previewed, setPreviewed] = useState<Previewed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      coachingStore.bind(userId);
      void coachingStore.load("athlete");
      programOffersStore.bind(userId);
      void programOffersStore.refreshReceived();
    }, [userId]),
  );

  const setCode = (value: string) => {
    typed.current = value;
    setCodeState(value);
  };

  const onChangeCode = (value: string) => {
    setCode(value);
    // A preview belongs to the exact code that was looked up.
    setPreviewed(null);
    setError(null);
  };

  const lookUp = async () => {
    setError(null);
    setNotice(null);
    setPreviewing(true);
    const looked = code;
    const outcome = await coachingStore.previewCode(looked);
    if (outcome.kind === "ignored" || outcome.kind === "stale") return;
    setPreviewing(false);
    // The input stays editable while the lookup runs. If it changed, this
    // answer is about a code that is no longer there: showing it, with a
    // Connect button, would pair the wrong coach with the visible text.
    if (typed.current !== looked) return;
    if (outcome.kind === "failed") setError(outcome.message);
    else setPreviewed({ code: looked, preview: outcome.preview });
  };

  const accept = async () => {
    if (!previewed) return;
    setError(null);
    const outcome = await coachingStore.acceptCode(previewed.code, previewed.preview.coach.username);
    if (outcome.kind === "ignored" || outcome.kind === "stale") return;
    if (outcome.kind === "done") {
      setNotice(`You are now connected to ${personName(outcome.connection.person)}.`);
      setPreviewed(null);
      setCode("");
      return;
    }
    if (outcome.kind === "unknown") void coachingStore.load("athlete");
    setError(outcome.message);
  };

  const end = async (linkId: string, name: string) => {
    setError(null);
    const outcome = await coachingStore.endConnection("athlete", linkId);
    if (outcome.kind === "failed" || outcome.kind === "unknown") setError(outcome.message);
    if (outcome.kind === "done") setNotice(`Connection with ${name} ended.`);
  };

  const applySharing = async (linkId: string, enabled: boolean) => {
    setError(null);
    setNotice(null);
    const outcome = await coachingStore.setWorkoutSharing(linkId, enabled);
    if (outcome.kind === "failed" || outcome.kind === "unknown") setError(outcome.message);
  };

  // Turning sharing on is the consequential direction, so it is spelled out and
  // confirmed. Turning it off only reduces what is shared and happens at once.
  const toggleSharing = (linkId: string, name: string, enabled: boolean) => {
    if (!enabled) {
      void applySharing(linkId, false);
      return;
    }
    Alert.alert(
      `Share your workouts with ${name}?`,
      `${name} will be able to read your whole completed workout history, including past sessions: titles, dates, exercises, sets, weights, reps and RIR. They cannot change anything. Your body weight, nutrition and profile stay private. You can turn this off at any time, and ending the connection also stops it.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Share workouts", onPress: () => void applySharing(linkId, true) },
      ],
    );
  };

  const confirmEnd = (linkId: string, name: string) =>
    Alert.alert(
      `End connection with ${name}?`,
      "No account, program or workout is deleted. To connect again, they will need to send you a new invite code.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "End connection", style: "destructive", onPress: () => void end(linkId, name) },
      ],
    );

  const list = state.coaches;
  const firstLoad = !list.loaded && list.loading;
  const canLookUp = code.trim().length > 0 && !previewing && !state.accepting;

  const header = (
    <View>
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.cardTitle}>
          Connect with a coach
        </Text>
        <View>
          <Text style={styles.label}>Invite code</Text>
          <TextInput
            style={styles.input}
            accessibilityLabel="Invite code"
            placeholder="XXXX-XXXX-XXXX"
            placeholderTextColor={light.textSecondary}
            value={code}
            onChangeText={onChangeCode}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            returnKeyType="go"
            onSubmitEditing={() => canLookUp && void lookUp()}
            selectionColor={light.text}
          />
        </View>
        {error ? (
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>
            {error}
          </Text>
        ) : null}
        {previewed ? (
          <View style={styles.preview}>
            <Text style={styles.previewTitle}>
              Invite from {personName(previewed.preview.coach)}
            </Text>
            {personHandle(previewed.preview.coach) ? (
              <Text style={styles.meta}>{personHandle(previewed.preview.coach)}</Text>
            ) : null}
            <Text style={styles.meta}>Valid until {formatExpiry(previewed.preview.expires_at)}</Text>
            <Text style={styles.body}>
              Connecting adds this person to your coaches and shares nothing by itself. Afterwards
              you can choose to let them read your completed workout history; your body weight
              and nutrition are never shared. You can end the connection at any time.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Connect with ${personName(previewed.preview.coach)}`}
              accessibilityState={{ busy: state.accepting, disabled: state.accepting }}
              disabled={state.accepting}
              style={({ pressed }) => [
                styles.primary,
                pressed && styles.primaryPressed,
                state.accepting && styles.busy,
              ]}
              onPress={() => void accept()}
            >
              {state.accepting ? (
                <ActivityIndicator color={light.onPrimary} />
              ) : (
                <Text style={styles.primaryText}>Connect</Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={state.accepting}
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
              onPress={() => setPreviewed(null)}
            >
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Look up code"
            accessibilityState={{ busy: previewing, disabled: !canLookUp }}
            disabled={!canLookUp}
            style={({ pressed }) => [
              styles.primary,
              pressed && styles.primaryPressed,
              !canLookUp && styles.busy,
            ]}
            onPress={() => void lookUp()}
          >
            {previewing ? (
              <ActivityIndicator color={light.onPrimary} />
            ) : (
              <Text style={styles.primaryText}>Look up code</Text>
            )}
          </Pressable>
        )}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          waiting > 0
            ? `Received programs, ${waiting} waiting for your answer`
            : "Received programs"
        }
        accessibilityHint="Opens the programs your coaches sent you"
        style={({ pressed }) => [styles.entry, pressed && styles.pressed]}
        onPress={() => router.push("/coaching/programs-received")}
      >
        <View style={styles.entryText}>
          <Text style={styles.cardTitle}>Received programs</Text>
          <Text style={styles.meta}>
            {waiting > 0
              ? `${waiting} waiting for your answer`
              : "Programs your coaches send you appear here. Nothing is added until you accept."}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={light.textSecondary} style={styles.chevron} />
      </Pressable>

      <Text accessibilityRole="header" style={styles.sectionLabel}>
        Your coaches
      </Text>
      <Text style={styles.sectionCaption}>People who coach you. You decide what each one can see.</Text>
      {notice ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.notice}>
          {notice}
        </Text>
      ) : null}
      {list.error ? (
        <View style={styles.banner}>
          <Text accessibilityRole="alert" style={styles.error}>
            {list.loaded ? "Could not refresh." : "Could not load your coaches."} {list.error}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            onPress={() => void coachingStore.load("athlete")}
          >
            <Text style={styles.secondaryText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <FocusedDarkStatusBar />
      <FlatList
        style={styles.screen}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, 16) + 24 },
        ]}
        data={list.items}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        renderItem={({ item }) => (
          <ConnectionRow
            connection={item}
            ending={state.ending.includes(item.id)}
            onEnd={() => confirmEnd(item.id, personName(item.person))}
          >
            <SharingSwitch
              name={personName(item.person)}
              value={item.shares_workouts}
              busy={state.sharing.includes(item.id)}
              onChange={(enabled) => toggleSharing(item.id, personName(item.person), enabled)}
            />
          </ConnectionRow>
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={
          firstLoad ? (
            <ActivityIndicator color={light.textSecondary} accessibilityLabel="Loading coaches" />
          ) : list.error && !list.loaded ? null : (
            <Text style={styles.empty}>
              You are not connected to a coach. Ask yours for an invite code.
            </Text>
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={list.loading && list.loaded}
            onRefresh={() => void coachingStore.load("athlete")}
            tintColor={light.textSecondary}
          />
        }
      />
    </KeyboardAvoidingView>
  );
}

/** The athlete's per-coach switch for sharing completed workouts. */
function SharingSwitch({
  name,
  value,
  busy,
  onChange,
}: {
  name: string;
  value: boolean;
  busy: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <View style={styles.sharing}>
      <View style={styles.sharingText}>
        <Text style={styles.sharingTitle}>Share my workout history</Text>
        {/* The state is written out, so it never depends on the switch colour. */}
        <Text style={styles.sharingStatus}>{value ? "Sharing is on" : "Sharing is off"}</Text>
        <Text style={styles.meta}>
          {value
            ? `${name} can read your completed workouts. Weight and nutrition are not shared.`
            : `${name} cannot see any of your workouts.`}
        </Text>
        <Text style={styles.meta}>Programs from {name} do not depend on this setting.</Text>
      </View>
      {busy ? (
        <ActivityIndicator color={light.textSecondary} accessibilityLabel="Updating sharing" />
      ) : (
        <Switch
          accessibilityLabel={`Share my workout history with ${name}`}
          value={value}
          onValueChange={onChange}
          trackColor={{ false: light.separator, true: light.primary }}
          ios_backgroundColor={light.separator}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: light.background },
  screen: { flex: 1, backgroundColor: light.background },
  content: { paddingHorizontal: 16, paddingTop: 8 },
  card: {
    backgroundColor: light.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    gap: 12,
  },
  cardTitle: { color: light.text, fontSize: 17, fontWeight: "600", lineHeight: 22 },
  entry: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: light.surface,
    borderRadius: 12,
    paddingVertical: 12,
    paddingLeft: 16,
    paddingRight: 8,
    marginBottom: 24,
    gap: 8,
  },
  entryText: { flex: 1, gap: 4 },
  chevron: { width: MIN_TOUCH, textAlign: "center" },
  label: { color: light.textSecondary, fontSize: 13, fontWeight: "600", marginBottom: 6 },
  input: {
    minHeight: 52,
    backgroundColor: light.background,
    borderRadius: 10,
    color: light.text,
    fontSize: 17,
    letterSpacing: 1.5,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  preview: {
    gap: 8,
    borderTopColor: light.separator,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
  },
  previewTitle: { color: light.text, fontSize: 17, fontWeight: "600", lineHeight: 22 },
  body: { color: light.textSecondary, fontSize: 14, lineHeight: 21 },
  meta: { color: light.textSecondary, fontSize: 13, lineHeight: 19 },
  sectionLabel: {
    color: light.textSecondary,
    fontSize: 13,
    fontWeight: "600",
    marginLeft: 4,
  },
  sectionCaption: {
    color: light.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginLeft: 4,
    marginTop: 2,
    marginBottom: 10,
  },
  notice: { color: light.text, fontSize: 14, fontWeight: "500", lineHeight: 20, marginBottom: 10 },
  error: { color: light.danger, fontSize: 14, lineHeight: 20 },
  banner: {
    backgroundColor: light.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    gap: 8,
  },
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
  primaryText: { color: light.onPrimary, fontSize: 16, fontWeight: "600" },
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
  sharing: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: MIN_TOUCH,
    borderTopColor: light.separator,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
  },
  sharingText: { flex: 1, gap: 2 },
  sharingTitle: { color: light.text, fontSize: 15, fontWeight: "600" },
  sharingStatus: { color: light.text, fontSize: 13, fontWeight: "600", lineHeight: 19 },
});
