import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";

import { light } from "../../../src/lightTheme";
import { TabBarWithRestTimer } from "../../../src/workout/TabBarWithRestTimer";

/**
 * Workout is the middle tab AND where the app opens. The declared order is
 * the visual order (Volume, History, Workout, Exercises, Diet), and a
 * tab navigator would otherwise start on the first one it lists, so the landing
 * tab is named here rather than left to the order.
 */
export const unstable_settings = {
  anchor: "index",
};

export default function TabsLayout() {
  return (
    <Tabs
      // The floating pill bar, with the rest countdown above it while one is running.
      tabBar={(props) => <TabBarWithRestTimer {...props} />}
      screenOptions={{
        // Every tab draws its own title bar (headerShown: false below); a native
        // header as well would show each title twice.
        headerShown: false,
        sceneStyle: { backgroundColor: light.background },
        // Shared by all five tabs. The bar itself (one floating pill with a moving
        // highlight behind the selected tab) is drawn by FloatingTabBar, which owns the
        // container style, so none is set here.
        tabBarActiveTintColor: light.text,
        tabBarInactiveTintColor: light.textSecondary,
        // Five labels share the width of the smallest iPhones, so they all stay one
        // size and one line. The bar has a fixed height, so a label that grew with
        // Dynamic Type would be clipped by it; like the system's own tab bars it stays
        // one size, and each tab still has its full spoken name.
        tabBarAllowFontScaling: false,
        tabBarLabelStyle: { fontSize: 10 },
      }}
    >
      <Tabs.Screen
        name="volume"
        options={{
          title: "Volume",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="stats-chart" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "History",
          tabBarIcon: ({ color, size }) => <Ionicons name="time" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: "Workout",
          tabBarAccessibilityLabel: "Workout",
          // A stable handle for the end-to-end flows: the visible text "Workout" is also the
          // home screen's heading, so it cannot pick out the tab.
          tabBarButtonTestID: "tab-workout",
          tabBarIcon: ({ color, size }) => <Ionicons name="barbell" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="exercises"
        options={{
          title: "Exercises",
          tabBarIcon: ({ color, size }) => <Ionicons name="list" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="diet"
        options={{
          title: "Diet",
          tabBarIcon: ({ color, size }) => <Ionicons name="nutrition" size={size} color={color} />,
        }}
      />
      {/* Profile is opened from the Workout title bar. It stays a real route in this group (so
          /profile and every link to it still work) but has no button in the bar. */}
      <Tabs.Screen name="profile" options={{ href: null }} />
      {/* The old Programs tab. Programs now live on Workout; this route stays only so an old
          link to /programs still lands somewhere (it redirects), and has no button in the bar. */}
      <Tabs.Screen name="programs" options={{ href: null }} />
    </Tabs>
  );
}
