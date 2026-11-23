/**
 * Diet: the fifth tab, a first dashboard in the app's light layout.
 *
 * What is real: the week strip (seven actual days in the user's timezone, today selected
 * first) and the daily goals, which are the calorie/macro numbers the user already saved
 * under Profile > Nutrition Goals, read from the existing API.
 *
 * What is NOT here, on purpose: food logging does not exist yet. So the goals are labelled
 * as targets, never as "left" or "eaten"; the rings are decorative (they carry no progress);
 * nothing is derived from workouts; and the Recent meals section says plainly that meal
 * logging is coming. The selected day only sets the date context of that section: the goals
 * are the current ones whichever day is picked.
 */

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { fetchNutritionGoals } from "../../../src/api/nutrition";
import { useAuth } from "../../../src/auth/AuthContext";
import { light, lightMacro } from "../../../src/lightTheme";
import { TabTopBar } from "../../../src/navigation/TabTopBar";
import {
  createDietGoalsLoader,
  formatGoal,
  hasAnyGoal,
  type DietGoals,
} from "../../../src/nutrition/dietGoals";
import {
  calendarDateIn,
  formatMealContext,
  weekContaining,
  type CalendarDate,
} from "../../../src/nutrition/dietWeek";

const MIN_TOUCH = 44;
const MINUTE_MS = 60_000;
// From this system text scale up, three macro cards no longer fit side by side.
const STACK_MACROS_FROM_SCALE = 1.5;

export default function DietScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { fontScale } = useWindowDimensions();
  const userId = user?.id ?? null;
  const timeZone = user?.timezone ?? null;

  // One loader per signed-in account, so another account never sees (or receives a late
  // answer for) the previous one's goals.
  const { loader } = useMemo(
    () => ({ owner: userId, loader: createDietGoalsLoader(fetchNutritionGoals) }),
    [userId],
  );
  const { goals, loading, error } = useSyncExternalStore(loader.subscribe, loader.getSnapshot);

  const [now, setNow] = useState(() => new Date());
  const today = calendarDateIn(now, timeZone);
  const week = weekContaining(today);
  const [picked, setPicked] = useState<CalendarDate | null>(null);
  // A day picked in a week that has since ended (the app stayed open past Sunday) is dropped.
  const selected = picked !== null && week.some((day) => day.date === picked) ? picked : today;

  const navigatingRef = useRef(false);

  // The signed-in account's zone, read by the clock checks below without restarting them.
  const timeZoneRef = useRef(timeZone);
  useEffect(() => {
    timeZoneRef.current = timeZone;
  }, [timeZone]);

  // While focused: re-read the day (midnight may have passed) and the goals (an edit made on
  // the Nutrition Goals screen shows up on return). The day is re-checked at every minute
  // boundary and whenever the app returns to the foreground, because Diet can stay focused
  // across midnight or in the background without any tab switch. `now` only changes when the
  // calendar day (in the account's zone) really did, so a quiet minute re-renders nothing and
  // a deliberately picked day is kept.
  useFocusEffect(
    useCallback(() => {
      navigatingRef.current = false;
      const syncDay = () =>
        setNow((previous) => {
          const next = new Date();
          return calendarDateIn(next, timeZoneRef.current) ===
            calendarDateIn(previous, timeZoneRef.current)
            ? previous
            : next;
        });
      syncDay();
      void loader.load();

      let timer: ReturnType<typeof setTimeout> | null = null;
      const scheduleNextMinute = () => {
        timer = setTimeout(() => {
          syncDay();
          scheduleNextMinute();
        }, MINUTE_MS - (Date.now() % MINUTE_MS) + 50);
      };
      scheduleNextMinute();
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") syncDay();
      });

      return () => {
        if (timer !== null) clearTimeout(timer);
        subscription.remove();
        loader.invalidate();
      };
    }, [loader]),
  );

  const openGoals = () => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    router.push("/profile/nutrition-goals");
  };

  // Why a value is not on screen yet (it is a dash either way, but it is spoken differently).
  const pending = goals === null ? (error ? "unavailable" : "loading") : null;
  const stackMacros = fontScale >= STACK_MACROS_FROM_SCALE;
  const editLabel = goals !== null && !hasAnyGoal(goals) ? "Set goals" : "Edit goals";

  return (
    <View style={styles.screen}>
      <TabTopBar
        title="Diet"
        trailing={
          <View style={styles.headerIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Ionicons name="nutrition" size={20} color={light.text} />
          </View>
        }
      />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <WeekStrip days={week} selected={selected} onSelect={setPicked} />

        <View style={styles.sectionHeader}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            Daily goals
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={editLabel}
            accessibilityHint="Opens your nutrition goals"
            onPress={openGoals}
            style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
          >
            <Text style={styles.actionText}>{editLabel}</Text>
            <Ionicons name="chevron-forward" size={16} color={light.text} />
          </Pressable>
        </View>
        <GoalsStatus
          loading={loading}
          error={error}
          goals={goals}
          onRetry={() => void loader.load()}
        />

        <CalorieCard value={goals?.calories ?? null} pending={pending} />
        <View style={[styles.macroRow, stackMacros && styles.macroColumn]}>
          <MacroCard
            label="Protein"
            icon="fish"
            color={lightMacro.protein}
            value={goals?.protein ?? null}
            pending={pending}
            stacked={stackMacros}
          />
          <MacroCard
            label="Carbs"
            icon="leaf"
            color={lightMacro.carbs}
            value={goals?.carbs ?? null}
            pending={pending}
            stacked={stackMacros}
          />
          <MacroCard
            label="Fat"
            icon="water"
            color={lightMacro.fat}
            value={goals?.fat ?? null}
            pending={pending}
            stacked={stackMacros}
          />
        </View>

        <View style={styles.mealsHeader}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            Recent meals
          </Text>
          <Text style={styles.mealContext} testID="meal-context">
            {formatMealContext(selected, today)}
          </Text>
        </View>
        <View style={styles.emptyCard}>
          <View style={styles.emptyIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Ionicons name="restaurant-outline" size={28} color={light.textSecondary} />
          </View>
          <Text style={styles.emptyTitle}>No meals to show</Text>
          <Text style={styles.emptyBody}>Meal logging is coming soon.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function WeekStrip({
  days,
  selected,
  onSelect,
}: {
  days: ReturnType<typeof weekContaining>;
  selected: CalendarDate;
  onSelect: (date: CalendarDate) => void;
}) {
  return (
    <View style={styles.week}>
      {days.map((day) => {
        const isSelected = day.date === selected;
        return (
          <Pressable
            key={day.date}
            accessibilityRole="button"
            accessibilityLabel={`${day.longLabel}${day.isToday ? ", today" : ""}`}
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelect(day.date)}
            style={({ pressed }) => [
              styles.day,
              isSelected && styles.daySelected,
              pressed && !isSelected && styles.dayPressed,
            ]}
          >
            <Text
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
              style={[styles.weekday, isSelected && styles.weekdaySelected]}
            >
              {day.weekday}
            </Text>
            <View style={[styles.dayCircle, day.isToday && styles.dayCircleToday]}>
              <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.dayNumber}>
                {day.dayOfMonth}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function GoalsStatus({
  loading,
  error,
  goals,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  goals: DietGoals | null;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <View style={styles.statusRow}>
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.statusError}>
          {goals === null
            ? `Could not load your goals. ${error}`
            : `Showing your last loaded goals. Could not refresh: ${error}`}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Try loading goals again"
          onPress={onRetry}
          style={({ pressed }) => [styles.retry, pressed && styles.actionPressed]}
        >
          <Text style={styles.actionText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  if (loading) {
    return (
      <View style={styles.statusRow}>
        <ActivityIndicator color={light.textSecondary} accessibilityLabel="Loading your goals" />
        <Text style={styles.caption}>Loading your goals…</Text>
      </View>
    );
  }
  return (
    <Text style={styles.caption}>
      {hasAnyGoal(goals)
        ? "Your current daily targets, the same for every day. Food logging is not available yet."
        : "No daily goals saved yet."}
    </Text>
  );
}

/** The decorative ring: a neutral outline that shows no progress. */
function Ring({ size, stroke, children }: { size: number; stroke: number; children: ReactNode }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.ring,
        { width: size, height: size, borderRadius: size / 2, borderWidth: stroke },
      ]}
    >
      {children}
    </View>
  );
}

const spoken = (value: number | null, pending: string | null, unit: string) =>
  pending ?? (value === null ? "not set" : `${Math.round(value)} ${unit}`);

function CalorieCard({ value, pending }: { value: number | null; pending: string | null }) {
  return (
    <View
      accessible
      accessibilityLabel={`Daily calorie goal: ${spoken(value, pending, "kilocalories")}`}
      style={styles.calorieCard}
    >
      <View style={styles.calorieText}>
        <Text style={styles.cardLabel}>Daily calorie goal</Text>
        <Text style={[styles.calorieValue, value === null && styles.valueMissing]}>
          {formatGoal(value)}
          {value !== null ? <Text style={styles.calorieUnit}> kcal</Text> : null}
        </Text>
      </View>
      <Ring size={88} stroke={8}>
        <Ionicons name="flame" size={34} color={light.text} />
      </Ring>
    </View>
  );
}

function MacroCard({
  label,
  icon,
  color,
  value,
  pending,
  stacked,
}: {
  label: string;
  icon: "fish" | "leaf" | "water";
  color: string;
  value: number | null;
  pending: string | null;
  stacked: boolean;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${label} daily goal: ${spoken(value, pending, "grams")}`}
      style={[styles.macroCard, stacked && styles.macroCardStacked]}
    >
      <View style={styles.macroHead}>
        <Ionicons name={icon} size={16} color={color} />
        <Text style={styles.macroLabel}>{label}</Text>
      </View>
      <Text style={[styles.macroValue, value === null && styles.valueMissing]}>
        {formatGoal(value)}
        {value !== null ? <Text style={styles.macroUnit}> g</Text> : null}
      </Text>
      <Text style={styles.macroCaption}>daily goal</Text>
      <Ring size={44} stroke={5}>
        <Ionicons name={icon} size={16} color={color} />
      </Ring>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24, rowGap: 12 },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: light.surface,
    alignItems: "center",
    justifyContent: "center",
  },

  // Week strip: seven equal columns, slightly wider than the page padding so each stays a 44 pt target.
  week: { flexDirection: "row", marginHorizontal: -10, marginBottom: 8 },
  day: {
    flex: 1,
    minHeight: 76,
    paddingVertical: 8,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    rowGap: 6,
  },
  daySelected: { backgroundColor: light.primary },
  dayPressed: { backgroundColor: light.pressed },
  weekday: { color: light.textSecondary, fontSize: 12, fontWeight: "500" },
  weekdaySelected: { color: light.onPrimary },
  dayCircle: {
    minWidth: 32,
    minHeight: 32,
    borderRadius: 16,
    backgroundColor: light.surface,
    borderWidth: 1.5,
    borderColor: light.separator,
    alignItems: "center",
    justifyContent: "center",
  },
  dayCircleToday: { borderColor: light.text },
  dayNumber: { color: light.text, fontSize: 15, fontWeight: "600" },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: 12,
    marginTop: 4,
  },
  sectionTitle: { flexShrink: 1, color: light.text, fontSize: 20, fontWeight: "700" },
  action: {
    minHeight: MIN_TOUCH,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 4,
    paddingLeft: 12,
    borderRadius: 12,
  },
  actionPressed: { backgroundColor: light.pressed },
  actionText: { color: light.text, fontSize: 15, fontWeight: "600" },
  caption: { color: light.textSecondary, fontSize: 13, flexShrink: 1 },
  statusRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: 12, rowGap: 4 },
  statusError: { color: light.danger, fontSize: 13, flexShrink: 1 },
  retry: { minHeight: MIN_TOUCH, justifyContent: "center", paddingHorizontal: 12, borderRadius: 12 },

  calorieCard: {
    backgroundColor: light.surface,
    borderRadius: 28,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: 12,
  },
  calorieText: { flex: 1, rowGap: 4 },
  cardLabel: { color: light.textSecondary, fontSize: 14, fontWeight: "500" },
  calorieValue: { color: light.text, fontSize: 40, fontWeight: "700" },
  calorieUnit: { fontSize: 16, fontWeight: "600", color: light.textSecondary },
  valueMissing: { color: light.textSecondary },
  ring: {
    borderColor: light.separator,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },

  macroRow: { flexDirection: "row", columnGap: 10 },
  macroColumn: { flexDirection: "column", rowGap: 10 },
  macroCard: {
    flex: 1,
    backgroundColor: light.surface,
    borderRadius: 22,
    padding: 12,
    rowGap: 2,
    alignItems: "flex-start",
  },
  macroCardStacked: { flex: 0, alignSelf: "stretch" },
  macroHead: { flexDirection: "row", alignItems: "center", columnGap: 4, flexWrap: "wrap" },
  macroLabel: { color: light.textSecondary, fontSize: 13, fontWeight: "500", flexShrink: 1 },
  macroValue: { color: light.text, fontSize: 24, fontWeight: "700", marginTop: 6 },
  macroUnit: { fontSize: 14, fontWeight: "600", color: light.textSecondary },
  macroCaption: { color: light.textSecondary, fontSize: 12, marginBottom: 10 },

  mealsHeader: { marginTop: 8, rowGap: 2 },
  mealContext: { color: light.textSecondary, fontSize: 14 },
  emptyCard: {
    backgroundColor: light.surface,
    borderRadius: 28,
    paddingVertical: 32,
    paddingHorizontal: 20,
    alignItems: "center",
    rowGap: 6,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: light.background,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  emptyTitle: { color: light.text, fontSize: 17, fontWeight: "600", textAlign: "center" },
  emptyBody: { color: light.textSecondary, fontSize: 15, textAlign: "center" },
});
