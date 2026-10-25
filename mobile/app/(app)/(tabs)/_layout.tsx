import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";

import { light } from "../../../src/lightTheme";
import { roman } from "../../../src/romanTheme";
import { colors } from "../../../src/theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: colors.background },
        // Shared by all four tabs.
        tabBarStyle: {
          backgroundColor: roman.background,
          borderTopColor: roman.border,
        },
        tabBarActiveTintColor: roman.gold,
        tabBarInactiveTintColor: roman.textMuted,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Training",
          // The screen draws its own title bar; a native header as well would
          // show "Training" twice.
          headerShown: false,
          // Training and Programs are the light tabs so far. The navigator applies the
          // focused screen's tab bar options, so these affect the bar only while
          // Training is focused; the other tabs keep the dark bar above.
          sceneStyle: { backgroundColor: light.background },
          tabBarStyle: {
            backgroundColor: light.surface,
            borderTopColor: light.separator,
          },
          tabBarActiveTintColor: light.text,
          tabBarInactiveTintColor: light.textSecondary,
          tabBarIcon: ({ color, size }) => <Ionicons name="barbell" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="programs"
        options={{
          title: "Programs",
          // Draws its own title bar; a native header as well would show "Programs" twice.
          headerShown: false,
          // Light like Training; the navigator applies the focused tab's options, so
          // Volume and Profile keep the dark bar and scene background above.
          sceneStyle: { backgroundColor: light.background },
          tabBarStyle: {
            backgroundColor: light.surface,
            borderTopColor: light.separator,
          },
          tabBarActiveTintColor: light.text,
          tabBarInactiveTintColor: light.textSecondary,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="clipboard" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="volume"
        options={{
          title: "Volume",
          // Draws its own title bar; a native header as well would show "Volume" twice.
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="stats-chart" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          // Draws its own title bar; a native header as well would show "Profile" twice.
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}