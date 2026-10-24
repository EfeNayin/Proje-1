import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import type { Connection } from "../api/coaching";
import { roman, romanFont } from "../romanTheme";
import { formatConnectedDate, personHandle, personName } from "./presentation";

const MIN_TOUCH = 44;

/**
 * One accepted connection with an "End connection" control. `onOpen` turns the
 * name block into a button; `status` is an extra line under it; `children` sit
 * in a footer under the row (the athlete's sharing switch).
 */
export function ConnectionRow({
  connection,
  ending,
  onEnd,
  onOpen,
  status,
  children,
}: {
  connection: Connection;
  ending: boolean;
  onEnd: () => void;
  onOpen?: () => void;
  status?: string;
  children?: ReactNode;
}) {
  const name = personName(connection.person);
  const handle = personHandle(connection.person);
  const since = formatConnectedDate(connection.connected_at);

  const details = (
    <>
      <Text style={styles.name}>{name}</Text>
      {handle ? <Text style={styles.meta}>{handle}</Text> : null}
      {since ? <Text style={styles.meta}>Connected {since}</Text> : null}
      {status ? <Text style={styles.status}>{status}</Text> : null}
    </>
  );

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        {onOpen ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${name}. ${status ? `${status}. ` : ""}Open workouts`}
            style={({ pressed }) => [styles.text, pressed && styles.pressed]}
            onPress={onOpen}
          >
            {details}
          </Pressable>
        ) : (
          <View style={styles.text}>{details}</View>
        )}
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
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
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
  top: { flexDirection: "row", alignItems: "center", gap: 12 },
  text: { flex: 1, minHeight: MIN_TOUCH, justifyContent: "center" },
  status: { color: roman.goldLight, fontFamily: romanFont.medium, fontSize: 13, lineHeight: 19, marginTop: 2 },
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
