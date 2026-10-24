import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import type { Connection } from "../api/coaching";
import { roman, romanFont } from "../romanTheme";
import { formatConnectedDate, personHandle, personName } from "./presentation";

const MIN_TOUCH = 44;

/** One accepted connection with an "End connection" control. */
export function ConnectionRow({
  connection,
  ending,
  onEnd,
}: {
  connection: Connection;
  ending: boolean;
  onEnd: () => void;
}) {
  const name = personName(connection.person);
  const handle = personHandle(connection.person);
  const since = formatConnectedDate(connection.connected_at);

  return (
    <View style={styles.card}>
      <View style={styles.text}>
        <Text style={styles.name}>{name}</Text>
        {handle ? <Text style={styles.meta}>{handle}</Text> : null}
        {since ? <Text style={styles.meta}>Connected {since}</Text> : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`End connection with ${name}`}
        accessibilityState={{ busy: ending, disabled: ending }}
        disabled={ending}
        style={({ pressed }) => [styles.end, pressed && styles.pressed, ending && styles.busy]}
        onPress={onEnd}
      >
        {ending ? (
          <ActivityIndicator color={roman.danger} size="small" />
        ) : (
          <Text style={styles.endText}>End</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderLeftColor: roman.gold,
    borderLeftWidth: 3,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  text: { flex: 1 },
  name: { color: roman.text, fontFamily: romanFont.semibold, fontSize: 16, lineHeight: 22 },
  meta: { color: roman.textMuted, fontFamily: romanFont.regular, fontSize: 13, lineHeight: 19 },
  end: {
    minWidth: MIN_TOUCH,
    minHeight: MIN_TOUCH,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 10,
    borderColor: roman.border,
    borderWidth: 1,
  },
  endText: { color: roman.danger, fontFamily: romanFont.semibold, fontSize: 14 },
  pressed: { backgroundColor: roman.surfaceRaised },
  busy: { opacity: 0.6 },
});
