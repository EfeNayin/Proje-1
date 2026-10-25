import { useIsFocused } from "expo-router";
import { StatusBar } from "expo-status-bar";

/**
 * For a light screen: the app root sets light status-bar icons for the dark
 * screens, so a light screen asks for dark ones, but only while it is the
 * focused screen. Screens pushed over it then do not inherit a stale style.
 */
export function FocusedDarkStatusBar() {
  const focused = useIsFocused();
  return focused ? <StatusBar style="dark" /> : null;
}
