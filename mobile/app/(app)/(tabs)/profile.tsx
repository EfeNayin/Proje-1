/**
 * Profile screen.
 *
 * Read-only for now; editing lands here once the training loop is settled.
 */

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

import { useAuth } from "../../../src/auth/AuthContext";
import { colors, radius, spacing } from "../../../src/theme";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const { user, signOut, refreshProfile } = useAuth();
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
      <Text style={styles.name}>{user.display_name ?? user.username}</Text>
      <Text style={styles.username}>@{user.username}</Text>

      <View style={styles.card}>
        <Row label="Email" value={user.email} />
        <Row label="Units" value={user.weight_unit} />
        <Row label="Timezone" value={user.timezone} />
        <Row label="Language" value={user.locale} />
        <Row label="Visibility" value={user.is_private ? "Private" : "Public"} />
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
  name: { color: colors.text, fontSize: 26, fontWeight: "700" },
  username: { color: colors.textMuted, fontSize: 15, marginBottom: spacing.lg },
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
  rowLabel: { color: colors.textMuted, fontSize: 14 },
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
