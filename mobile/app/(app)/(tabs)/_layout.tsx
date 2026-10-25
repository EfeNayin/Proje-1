import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";

import { light } from "../../../src/lightTheme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        // Every tab draws its own title bar (headerShown: false below); a native
        // header as well would show each title twice.
        headerShown: false,
        sceneStyle: { backgroundColor: light.background },
        // Shared by all four tabs.
        tabBarStyle: {
          backgroundColor: light.surface,
          borderTopColor: light.separator,
        },
        tabBarActiveTintColor: light.text,
        tabBarInactiveTintColor: light.textSecondary,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Training",
          tabBarIcon: ({ color, size }) => <Ionicons name="barbell" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="programs"
        options={{
          title: "Programs",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="clipboard" size={size} color={color} />
          ),
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
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
