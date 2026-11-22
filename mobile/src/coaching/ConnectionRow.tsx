import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import type { Connection } from "../api/coaching";
import { light } from "../lightTheme";
import { formatConnectedDate, personHandle, personName } from "./presentation";

const MIN_TOUCH = 44;

/**
 * One accepted connection with an "End connection" control. `onOpen` turns the
 * name block into a button; `status` is an extra line under it; `detail` sits
 * under the status inside that button and `detailLabel` is its spoken form;
 * `children` sit in a footer under the row (the athlete's sharing switch).
 *
 * Used by My Athletes (the coach's roster) and My Coaches (the athlete's own
 * connections). The status is always words, never colour alone.
 */
export function ConnectionRow({
  connection,
  ending,
  onEnd,
  onOpen,
  status,
  detail,
  detailLabel,
  children,
}: {
  connection: Connection;
  ending: boolean;
  onEnd: () => void;
  onOpen?: () => void;
  status?: string;
  detail?: ReactNode;
  detailLabel?: string;
  children?: ReactNode;
}) {
  const name = personName(connection.person);
  const handle = personHandle(connection.person);
  const since = formatConnectedDate(connection.connected_at);

  const details = (
    <>
      <Text numberOfLines={2} style={styles.name}>
        {name}
      </Text>
      {handle ? (
        <Text numberOfLines={1} style={styles.meta}>
          {handle}
        </Text>
      ) : null}
      {since ? <Text style={styles.meta}>Connected {since}</Text> : null}
      {status ? <Text style={styles.status}>{status}</Text> : null}
      {detail}
    </>
  );

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        {onOpen ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${name}. ${status ? `${status}. ` : ""}${
              detailLabel ? `${detailLabel}. ` : ""
            }Open workouts`}
            style={({ pressed }) => [styles.text, pressed && styles.pressed]}
            onPress={onOpen}
          >
            {details}
          </Pressable>
        ) : (
          <View style={styles.text}>{details}</View>
        )}
        {onOpen ? (
          <Ionicons name="chevron-forward" size={18} color={light.textSecondary} />
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`End connection with ${name}`}
          accessibilityState={{ busy: ending, disabled: ending }}
          disabled={ending}
          style={({ pressed }) => [styles.end, pressed && styles.pressed, ending && styles.busy]}
          onPress={onEnd}
        >
          {ending ? (
            <ActivityIndicator color={light.danger} size="small" />
          ) : (
            <Text style={styles.endText}>End</Text>
          )}
        </Pressable>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 12,
    backgroundColor: light.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  top: { flexDirection: "row", alignItems: "center", gap: 8 },
  text: { flex: 1, minHeight: MIN_TOUCH, justifyContent: "center", borderRadius: 8 },
  status: { color: light.text, fontSize: 13, fontWeight: "600", lineHeight: 19, marginTop: 2 },
  name: { color: light.text, fontSize: 17, fontWeight: "600", lineHeight: 22 },
  meta: { color: light.textSecondary, fontSize: 13, lineHeight: 19 },
  end: {
    minWidth: MIN_TOUCH,
    minHeight: MIN_TOUCH,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: light.background,
  },
  endText: { color: light.danger, fontSize: 14, fontWeight: "600" },
  pressed: { backgroundColor: light.pressed },
  busy: { opacity: 0.6 },
});
