import { light } from "./lightTheme";

/**
 * Native stack header for a light screen that sits in the (dark-by-default)
 * app Stack: pass it to `<Stack.Screen options={...} />` inside the screen.
 * It styles only that screen's header, so dark screens keep theirs.
 */
export const lightHeaderOptions = {
  headerStyle: { backgroundColor: light.background },
  headerTintColor: light.text,
  headerTitleStyle: { color: light.text },
  headerShadowVisible: false,
} as const;
