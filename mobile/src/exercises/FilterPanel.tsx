/**
 * A filter's choices in a bottom sheet over the exercise list: a two-column
 * grid of selectable cards, with "Clear Filters" and "Show results" at the
 * bottom.
 *
 * The sheet holds no state. `value` is the PENDING choice, owned by the
 * browser: tapping a card or "Clear Filters" only changes what is pending,
 * "Show results" applies it, and closing the sheet any other way (the close
 * button, the backdrop, the Android back button) leaves the applied filter as
 * it was.
 *
 * It is a React Native Modal, the same pattern as the plate calculator and the
 * exercise history sheets. The exercise picker that hosts it is itself a native
 * modal screen; a Modal opened from inside one has not been checked on a device.
 *
 * The sheet only reports a value and does not know what the values mean. For
 * muscles this grid of names is the text-based way of choosing; the anatomical
 * model the redesign asks for is a separate piece that hands over the same
 * muscle code.
 */

import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { light } from "../lightTheme";

const MIN_TOUCH = 44;

type Option = { value: string; label: string; group?: string };

export function FilterPanel({
  title,
  allLabel,
  options,
  value,
  applyLabel,
  status = "ready",
  loadingLabel,
  errorText,
  retryLabel,
  onRetry,
  onChange,
  onApply,
  onDismiss,
}: {
  title: string;
  allLabel: string;
  options: Option[];
  /** The pending choice; null is "all". */
  value: string | null;
  /** "Show results", or "Show 7 results" once the server has counted them. */
  applyLabel: string;
  /** "loading" and "error" are for options that come from the server. */
  status?: "ready" | "loading" | "error";
  loadingLabel?: string;
  errorText?: string;
  retryLabel?: string;
  onRetry?: () => void;
  onChange: (value: string | null) => void;
  onApply: () => void;
  onDismiss: () => void;
}) {
  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent onRequestClose={onDismiss}>
      {/* A Modal is its own native window: it needs its own safe-area provider. */}
      <SafeAreaProvider>
        <View style={styles.overlay}>
          <Pressable
            testID="filter-backdrop"
            accessible={false}
            importantForAccessibility="no"
            style={StyleSheet.absoluteFill}
            onPress={onDismiss}
          />
          <SafeAreaView edges={["bottom", "left", "right"]} style={styles.sheet}>
            <View style={styles.header}>
              <Text accessibilityRole="header" style={styles.title}>
                {title}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Close ${title}`}
                hitSlop={8}
                style={styles.close}
                onPress={onDismiss}
              >
                <Text style={styles.closeText}>Close</Text>
              </Pressable>
            </View>

            <ScrollView
              accessibilityRole="radiogroup"
              style={styles.scroll}
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.grid}>
                <Card label={allLabel} checked={value === null} onPress={() => onChange(null)} />
              </View>

              {status === "loading" ? (
                <ActivityIndicator
                  color={light.textSecondary}
                  accessibilityLabel={loadingLabel}
                  style={styles.status}
                />
              ) : status === "error" ? (
                <View style={styles.status}>
                  <Text accessibilityRole="alert" style={styles.errorText}>
                    {errorText}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={retryLabel}
                    style={styles.retry}
                    onPress={onRetry}
                  >
                    <Text style={styles.retryText}>Try again</Text>
                  </Pressable>
                </View>
              ) : (
                sections(options).map((section) => (
                  <View key={section.group ?? "all"}>
                    {section.group ? (
                      <Text accessibilityRole="header" style={styles.group}>
                        {section.group}
                      </Text>
                    ) : null}
                    <View style={[styles.grid, !section.group && styles.gridSpaced]}>
                      {section.options.map((option) => (
                        <Card
                          key={option.value}
                          label={option.label}
                          checked={value === option.value}
                          onPress={() => onChange(option.value)}
                        />
                      ))}
                    </View>
                  </View>
                ))
              )}
            </ScrollView>

            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear Filters"
                accessibilityState={{ disabled: value === null }}
                disabled={value === null}
                style={({ pressed }) => [styles.action, styles.secondary, pressed && styles.pressed]}
                onPress={() => onChange(null)}
              >
                <Text style={[styles.secondaryText, value === null && styles.disabledText]}>Clear Filters</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={applyLabel}
                style={({ pressed }) => [styles.action, styles.primary, pressed && styles.primaryPressed]}
                onPress={onApply}
              >
                <Text style={styles.primaryText}>{applyLabel}</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}

/** Consecutive options with the same group heading, in the order given. */
function sections(options: Option[]): { group?: string; options: Option[] }[] {
  const result: { group?: string; options: Option[] }[] = [];
  for (const option of options) {
    const current = result[result.length - 1];
    if (current && current.group === option.group) current.options.push(option);
    else result.push({ group: option.group, options: [option] });
  }
  return result;
}

function Card({ label, checked, onPress }: { label: string; checked: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      style={({ pressed }) => [styles.card, checked && styles.cardChecked, pressed && !checked && styles.pressed]}
      onPress={onPress}
    >
      {/* The state is announced by the radio role; the fill is for sighted users. */}
      <Text numberOfLines={2} style={[styles.cardText, checked && styles.cardTextChecked]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: light.scrim, justifyContent: "flex-end" },
  sheet: {
    maxHeight: "85%",
    backgroundColor: light.background,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  title: { color: light.text, fontSize: 18, fontWeight: "700" },
  close: { minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, justifyContent: "center", alignItems: "flex-end" },
  closeText: { color: light.text, fontSize: 15, fontWeight: "600" },
  scroll: { flexGrow: 0 },
  content: { paddingHorizontal: 16, paddingBottom: 16 },

  // Two columns: each card takes just under half the row, the gap takes the rest.
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10 },
  gridSpaced: { marginTop: 10 },
  group: { color: light.textSecondary, fontSize: 13, fontWeight: "600", marginTop: 16, marginBottom: 6, marginLeft: 4 },
  card: {
    width: "48.5%",
    minHeight: 56,
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: light.separator,
    backgroundColor: light.surface,
  },
  cardChecked: { backgroundColor: light.primary, borderColor: light.primary },
  cardText: { color: light.text, fontSize: 16, fontWeight: "600" },
  cardTextChecked: { color: light.onPrimary },
  pressed: { backgroundColor: light.pressed },

  actions: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopColor: light.separator,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  action: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 12, paddingHorizontal: 12 },
  secondary: { backgroundColor: light.surface, borderWidth: 1, borderColor: light.separator },
  secondaryText: { color: light.text, fontSize: 16, fontWeight: "600" },
  disabledText: { color: light.textSecondary },
  primary: { backgroundColor: light.primary },
  primaryPressed: { backgroundColor: light.primaryPressed },
  primaryText: { color: light.onPrimary, fontSize: 16, fontWeight: "600" },

  status: { alignItems: "center", gap: 8, paddingVertical: 24 },
  errorText: { color: light.danger, fontSize: 14, textAlign: "center" },
  retry: {
    minHeight: MIN_TOUCH,
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: light.surface,
  },
  retryText: { color: light.text, fontSize: 15, fontWeight: "600" },
});
