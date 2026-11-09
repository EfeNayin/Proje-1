import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { light } from "../lightTheme";
import type { WeightUnit } from "../units/weight";
import {
  calculatePlates,
  DEFAULT_PLATE_PREFERENCE,
  describePerSide,
  formatPlateNumber,
  MAX_BAR,
  MAX_TOTAL,
  PLATE_OPTIONS,
  parseDecimalInput,
  type PlateCount,
  type PlateResult,
} from "./plateMath";
import { getPlatePreference, setPlatePreference } from "./plateCalculatorPreference";
import { RestCountdownChip } from "./RestTimerPill";
import { restTimerStore } from "./restTimerStore";

/** What the result area says, and whether it is a problem (alert) or just information. */
function resultMessage(result: PlateResult, unit: WeightUnit): { text: string; alert: boolean } | null {
  switch (result.status) {
    case "invalid":
      if (result.field === "total") {
        if (result.reason === "blank") return { text: "Enter the total weight to load, bar included.", alert: false };
        if (result.reason === "too-large") return { text: `The total can be at most ${MAX_TOTAL} ${unit}.`, alert: true };
        return { text: "Enter the total as a number, like 87.5.", alert: true };
      }
      if (result.reason === "blank") return { text: "Enter the bar weight (0 if there is no bar).", alert: true };
      if (result.reason === "too-large") return { text: `The bar can be at most ${MAX_BAR} ${unit}.`, alert: true };
      return { text: "Enter the bar weight as a number, like 20.", alert: true };
    case "below-bar":
      return {
        text: `${formatPlateNumber(result.total)} ${unit} is lighter than the ${formatPlateNumber(result.bar)} ${unit} bar. Enter ${formatPlateNumber(result.bar)} ${unit} or more.`,
        alert: true,
      };
    case "bar-only":
      return { text: `Just the ${formatPlateNumber(result.bar)} ${unit} bar. No plates.`, alert: false };
    case "no-plates":
      return { text: "Select at least one plate size.", alert: true };
    case "closest":
      return {
        text: `${formatPlateNumber(result.requested)} ${unit} can't be made with these plates. The closest at or below it is ${formatPlateNumber(result.total)} ${unit}, ${formatPlateNumber(result.shortfall)} ${unit} short.`,
        alert: true,
      };
    case "exact":
      return null;
  }
}

function PerSide({ perSide, unit }: { perSide: PlateCount[]; unit: WeightUnit }) {
  if (perSide.length === 0) return null;
  return (
    <View
      accessible
      accessibilityLabel={`Per side: ${describePerSide(perSide, unit)}`}
      style={styles.perSide}
    >
      <Text style={styles.perSideTitle}>Per side</Text>
      {perSide.map(({ size, count }) => (
        <View key={size} style={styles.plateRow}>
          <Text style={styles.plateCount}>{count} ×</Text>
          <Text style={styles.plateSize}>
            {formatPlateNumber(size)} {unit}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Barbell plate calculator, opened from the active workout.
 *
 * Deliberately one-way: it is given the set's weight draft once, as the
 * starting value of its own total field, and it never gets a way to write
 * anything back. Typing here changes neither the draft nor the warm-up
 * toggle, and nothing here saves a set. Closing it returns to the workout
 * exactly as it was.
 *
 * Like the exercise-history panel it is a full-screen Modal, so it shows the
 * rest countdown in its header while the workout's own countdown is hidden
 * behind it. The countdown itself is not this component's: it only reads it.
 *
 * Mount it only while open: the starting total is read when it appears.
 */
export function PlateCalculator({ unit, initialTotal, onClose }: {
  unit: WeightUnit;
  initialTotal: string;
  onClose: () => void;
}) {
  const defaults = DEFAULT_PLATE_PREFERENCE[unit];
  const [total, setTotal] = useState(initialTotal);
  const [bar, setBar] = useState(formatPlateNumber(defaults.bar));
  const [plates, setPlates] = useState<number[]>([...defaults.plates]);
  // Saved choices arrive asynchronously; they must not overwrite one made meanwhile.
  const edited = useRef(false);

  useEffect(() => restTimerStore.coverInline(), []);

  useEffect(() => {
    let cancelled = false;
    void getPlatePreference(unit).then((saved) => {
      if (cancelled || edited.current) return;
      setBar(formatPlateNumber(saved.bar));
      setPlates(saved.plates);
    });
    return () => {
      cancelled = true;
    };
  }, [unit]);

  const remember = (nextBar: string, nextPlates: number[]) => {
    const parsedBar = parseDecimalInput(nextBar);
    if (parsedBar === null || parsedBar > MAX_BAR) return;
    // Best effort: a failed write only means the choice is not remembered.
    void setPlatePreference(unit, { bar: parsedBar, plates: nextPlates }).catch(() => undefined);
  };

  const changeBar = (value: string) => {
    edited.current = true;
    setBar(value);
    remember(value, plates);
  };

  const togglePlate = (size: number) => {
    edited.current = true;
    const next = PLATE_OPTIONS[unit].filter((option) =>
      option === size ? !plates.includes(size) : plates.includes(option),
    );
    setPlates(next);
    remember(bar, next);
  };

  const result = calculatePlates(total, bar, plates);
  const message = resultMessage(result, unit);
  const perSide = result.status === "exact" || result.status === "closest" ? result.perSide : [];

  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      {/* A Modal is its own native window: it needs its own safe-area provider. */}
      <SafeAreaProvider>
        <KeyboardAvoidingView style={styles.avoider} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.overlay}>
            <Pressable
              testID="plate-calculator-backdrop"
              accessible={false}
              importantForAccessibility="no"
              style={StyleSheet.absoluteFill}
              onPress={onClose}
            />
            <SafeAreaView edges={["bottom", "left", "right"]} style={styles.panel}>
              <View style={styles.header}>
                <View style={styles.headerText}>
                  <Text accessibilityRole="header" style={styles.headerTitle}>Barbell plate calculator</Text>
                  <Text style={styles.headerSubtitle}>Plates per side, bar included in the total</Text>
                </View>
                <RestCountdownChip />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close plate calculator"
                  hitSlop={8}
                  style={styles.closeButton}
                  onPress={onClose}
                >
                  <Ionicons name="close" size={22} color={light.text} />
                </Pressable>
              </View>

              <ScrollView
                style={styles.body}
                contentContainerStyle={styles.bodyContent}
                keyboardShouldPersistTaps="handled"
              >
                <View style={styles.fields}>
                  <View style={styles.field}>
                    <Text style={styles.fieldLabel}>Total ({unit})</Text>
                    <TextInput
                      accessibilityLabel={`Total weight in ${unit}, bar included`}
                      testID="plate-total-input"
                      style={styles.fieldInput}
                      value={total}
                      onChangeText={setTotal}
                      placeholder="0"
                      placeholderTextColor={light.textSecondary}
                      selectionColor={light.text}
                      keyboardType="decimal-pad"
                      returnKeyType="done"
                      submitBehavior="blurAndSubmit"
                      selectTextOnFocus
                    />
                  </View>
                  <View style={styles.field}>
                    <Text style={styles.fieldLabel}>Bar ({unit})</Text>
                    <TextInput
                      accessibilityLabel={`Bar weight in ${unit}`}
                      testID="plate-bar-input"
                      style={styles.fieldInput}
                      value={bar}
                      onChangeText={changeBar}
                      selectionColor={light.text}
                      keyboardType="decimal-pad"
                      returnKeyType="done"
                      submitBehavior="blurAndSubmit"
                      selectTextOnFocus
                    />
                  </View>
                </View>

                <Text style={styles.sectionLabel}>Plates you have</Text>
                <View style={styles.chips}>
                  {PLATE_OPTIONS[unit].map((size) => {
                    const selected = plates.includes(size);
                    return (
                      <Pressable
                        key={size}
                        accessibilityRole="checkbox"
                        accessibilityLabel={`${formatPlateNumber(size)} ${unit} plate`}
                        accessibilityState={{ checked: selected }}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => togglePlate(size)}
                      >
                        {/* The tick is as much a signal as the fill: selection is not carried by colour alone. */}
                        {selected ? <Ionicons name="checkmark" size={16} color={light.onPrimary} /> : null}
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                          {formatPlateNumber(size)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.assumption}>Assumes you have enough pairs of each size selected.</Text>

                {message ? (
                  <Text
                    accessibilityRole={message.alert ? "alert" : undefined}
                    style={[styles.message, message.alert && styles.messageAlert]}
                  >
                    {message.text}
                  </Text>
                ) : null}

                <PerSide perSide={perSide} unit={unit} />

                {perSide.length > 0 && (result.status === "exact" || result.status === "closest") ? (
                  <Text style={styles.summary}>
                    {formatPlateNumber(result.total)} {unit} = {formatPlateNumber(result.bar)} {unit} bar + 2 ×{" "}
                    {formatPlateNumber((result.total - result.bar) / 2)} {unit}
                  </Text>
                ) : null}
              </ScrollView>
            </SafeAreaView>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaProvider>
    </Modal>
  );
}

const MIN_TOUCH = 44;

const styles = StyleSheet.create({
  avoider: { flex: 1 },
  overlay: { flex: 1, backgroundColor: light.scrim, justifyContent: "flex-end" },
  panel: {
    maxHeight: "90%",
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
    paddingBottom: 8,
    backgroundColor: light.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: light.separator,
  },
  headerText: { flex: 1, marginRight: 8 },
  headerTitle: { color: light.text, fontSize: 17, fontWeight: "600" },
  headerSubtitle: { color: light.textSecondary, fontSize: 13, marginTop: 2 },
  closeButton: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: "center", justifyContent: "center" },

  body: { flexShrink: 1 },
  bodyContent: { padding: 16, gap: 12 },
  fields: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  field: { flexGrow: 1, flexBasis: 120, minWidth: 120 },
  fieldLabel: { color: light.textSecondary, fontSize: 12, marginBottom: 4 },
  fieldInput: {
    minHeight: 48,
    backgroundColor: light.surface,
    borderRadius: 10,
    color: light.text,
    fontSize: 18,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    textAlign: "center",
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  sectionLabel: { color: light.textSecondary, fontSize: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minWidth: 56,
    minHeight: MIN_TOUCH,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 12,
    borderRadius: 22,
    backgroundColor: light.surface,
    borderWidth: 1,
    borderColor: light.separator,
  },
  chipSelected: { backgroundColor: light.primary, borderColor: light.primary },
  chipText: { color: light.text, fontSize: 16, fontWeight: "600", fontVariant: ["tabular-nums"] },
  chipTextSelected: { color: light.onPrimary },
  assumption: { color: light.textSecondary, fontSize: 12 },

  message: { color: light.textSecondary, fontSize: 14, lineHeight: 20 },
  messageAlert: { color: light.danger, fontWeight: "500" },
  perSide: { backgroundColor: light.surface, borderRadius: 12, padding: 14, gap: 6 },
  perSideTitle: { color: light.textSecondary, fontSize: 13 },
  plateRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  plateCount: { color: light.textSecondary, fontSize: 20, fontWeight: "600", fontVariant: ["tabular-nums"], minWidth: 44 },
  plateSize: { color: light.text, fontSize: 24, fontWeight: "700", fontVariant: ["tabular-nums"] },
  summary: { color: light.textSecondary, fontSize: 13 },
});
