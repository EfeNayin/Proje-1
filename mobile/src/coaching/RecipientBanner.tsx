import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import type { Person } from "../api/coaching";
import { light } from "../lightTheme";
import { personHandle, personName } from "./presentation";

/**
 * Who a prepared program is for. Shown on every screen from preparing to publishing so
 * the coach never loses track of which athlete a change goes to.
 */
export function RecipientBanner({ athlete, label = "Prepared for" }: { athlete: Person; label?: string }) {
  const name = personName(athlete);
  const handle = personHandle(athlete);
  return (
    <View
      style={styles.root}
      accessible
      accessibilityLabel={`${label} ${name}${handle ? `, ${handle}` : ""}`}
    >
      <Ionicons name="person-outline" size={18} color={light.text} accessible={false} />
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
        <Text numberOfLines={2} style={styles.name}>
          {name}
        </Text>
        {handle ? <Text style={styles.handle}>{handle}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: light.surface,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  text: { flex: 1, gap: 1 },
  label: { color: light.textSecondary, fontSize: 13, fontWeight: "600" },
  name: { color: light.text, fontSize: 18, fontWeight: "700", lineHeight: 24 },
  handle: { color: light.textSecondary, fontSize: 13 },
});
