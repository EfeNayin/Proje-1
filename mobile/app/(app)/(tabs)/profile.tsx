/**
 * Profile screen.
 *
 * The header card is editable (taps through to /profile/edit). Below it, a
 * menu section starts with Personal Details; Email/Units/Timezone/Language/
 * Visibility used to be shown directly here as read-only rows and will move
 * into a Preferences entry in this same menu once one exists.
 */

import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";

import { fullName, initials } from "../../../src/api/auth";
import { useAuth } from "../../../src/auth/AuthContext";
import { colors, radius, spacing } from "../../../src/theme";
import {
  isReadinessCheckinEnabled,
  setReadinessCheckinEnabled,
} from "../../../src/workout/readinessPreference";

function MenuRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={[styles.row, styles.rowNoBorder]} onPress={onPress}>
      <Text style={styles.rowValue}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

export default function ProfileScreen() {
  const { user, signOut, refreshProfile } = useAuth();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [checkinEnabled, setCheckinEnabled] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void isReadinessCheckinEnabled().then((value) => {
      if (!cancelled) setCheckinEnabled(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggleCheckin = (value: boolean) => {
    setCheckinEnabled(value);
    void setReadinessCheckinEnabled(value);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshProfile();
    } catch {
      // The last known profile stays on screen; the client already signs the
      // user out if the session is genuinely gone.
    } finally {
      setRefreshing(false);
    }
  };

  if (!user) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} />
      }
    >
      <Pressable
        style={({ pressed }) => [styles.headerCard, pressed && styles.headerCardPressed]}
        onPress={() => router.push("/profile/edit")}
      >
        <LinearGradient
          colors={[colors.accent, colors.accentDark]}
          style={styles.avatar}
        >
          <Text style={styles.avatarText}>{initials(user)}</Text>
        </LinearGradient>
        <View style={styles.headerText}>
          <Text style={styles.name}>{fullName(user) ?? user.username}</Text>
          <Text style={styles.username}>@{user.username}</Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
      </Pressable>

      <View style={styles.card}>
        <MenuRow label="Personal Details" onPress={() => router.push("/profile/personal-details")} />
      </View>

      <View style={[styles.card, styles.cardSpaced]}>
        <View style={[styles.row, styles.rowNoBorder]}>
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>Readiness check-in</Text>
            <Text style={styles.rowHint}>Ask about sleep and soreness before each workout</Text>
          </View>
          <Switch
            value={checkinEnabled}
            onValueChange={handleToggleCheckin}
            trackColor={{ false: colors.border, true: colors.accent }}
            thumbColor={colors.text}
          />
        </View>
      </View>

      <Pressable style={styles.signOut} onPress={() => void signOut()}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  container: { padding: spacing.lg },
  headerCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  headerCardPressed: { opacity: 0.7 },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.accentText, fontSize: 22, fontWeight: "700" },
  headerText: { flex: 1, marginLeft: spacing.md },
  name: { color: colors.text, fontSize: 20, fontWeight: "700" },
  username: { color: colors.textMuted, fontSize: 14, marginTop: 2 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  cardSpaced: { marginTop: spacing.lg },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.md,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowNoBorder: { borderBottomWidth: 0 },
  rowLabel: { color: colors.textMuted, fontSize: 14 },
  rowValue: { color: colors.text, fontSize: 15, fontWeight: "500" },
  rowText: { flex: 1, marginRight: spacing.md },
  rowHint: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  signOut: {
    marginTop: spacing.xl,
    padding: spacing.md,
    borderRadius: radius.sm,
    borderColor: colors.border,
    borderWidth: 1,
    alignItems: "center",
  },
  signOutText: { color: colors.danger, fontSize: 16, fontWeight: "600" },
});
