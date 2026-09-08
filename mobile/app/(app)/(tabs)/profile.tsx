/**
 * Profile screen.
 *
 * The header card is editable (taps through to /profile/edit). Below it, the
 * menu is grouped into sections, starting with "Account" (Personal Details,
 * Preferences); further sections arrive with later tasks.
 */

import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { fullName, initials } from "../../../src/api/auth";
import { useAuth } from "../../../src/auth/AuthContext";
import { colors, radius, spacing } from "../../../src/theme";

function MenuRow({ label, onPress, last }: { label: string; onPress: () => void; last?: boolean }) {
  return (
    <Pressable style={[styles.row, last && styles.rowNoBorder]} onPress={onPress}>
      <Text style={styles.rowValue}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

export default function ProfileScreen() {
  const { user, signOut, refreshProfile } = useAuth();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

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

      <Text style={styles.sectionLabel}>Account</Text>
      <View style={styles.card}>
        <MenuRow label="Personal Details" onPress={() => router.push("/profile/personal-details")} />
        <MenuRow label="Preferences" onPress={() => router.push("/profile/preferences")} last />
      </View>

      <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>Goals & Tracking</Text>
      <View style={styles.card}>
        <MenuRow
          label="Nutrition Goals"
          onPress={() => router.push("/profile/nutrition-goals")}
          last
        />
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
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  sectionLabelSpaced: { marginTop: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.md,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowNoBorder: { borderBottomWidth: 0 },
  rowValue: { color: colors.text, fontSize: 15, fontWeight: "500" },
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
