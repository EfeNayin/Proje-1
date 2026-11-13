import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";

import { light } from "../../../src/lightTheme";
import { TabBarWithRestTimer } from "../../../src/workout/TabBarWithRestTimer";

/**
 * Start Workout is the middle tab AND where the app opens. The declared order is
 * the visual order (Profile, History, Start Workout, Exercises, Volume), and a
 * tab navigator would otherwise start on the first one it lists, so the landing
 * tab is named here rather than left to the order.
 */
export const unstable_settings = {
  anchor: "index",
};

export default function TabsLayout() {
  return (
    <Tabs
      // The usual bar, with the rest countdown above it while one is running.
      tabBar={(props) => <TabBarWithRestTimer {...props} />}
      screenOptions={{
        // Every tab draws its own title bar (headerShown: false below); a native
        // header as well would show each title twice.
        headerShown: false,
        sceneStyle: { backgroundColor: light.background },
        // Shared by all five tabs.
        tabBarStyle: {
          backgroundColor: light.surface,
          borderTopColor: light.separator,
        },
        tabBarActiveTintColor: light.text,
        tabBarInactiveTintColor: light.textSecondary,
        // Five labels share the width of the smallest iPhones, and "Start Workout"
        // is the longest. The bar has a fixed height, so a label that grew with
        // Dynamic Type would be clipped by it; like the system's own tab bars it
        // stays one size, and each tab still has its full spoken name.
        tabBarAllowFontScaling: false,
        tabBarLabelStyle: { fontSize: 10 },
      }}
    >
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
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
          title: "Start Workout",
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
        name="volume"
        options={{
          title: "Volume",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="stats-chart" size={size} color={color} />
          ),
        }}
      />
      {/* The old Programs tab. Programs now live on Start Workout; this route stays only so an old
          link to /programs still lands somewhere (it redirects), and has no button in the bar. */}
      <Tabs.Screen name="programs" options={{ href: null }} />
    </Tabs>
  );
}
