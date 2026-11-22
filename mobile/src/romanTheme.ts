/**
 * Black / antique-gold / silver palette and fonts for the Roman redesign.
 *
 * Deliberately separate from theme.ts: that file's colours are used by every
 * screen that has not been redesigned yet, and changing them in place would
 * restyle all of them at once. Screens opt in by importing from here.
 */

import { useFonts } from "expo-font";

export const roman = {
  background: "#09090B",
  surface: "#171719",
  border: "#2E2E34",
  gold: "#C5A46D",
  goldPressed: "#B3925B",
  goldLight: "#E4CD95",
  text: "#E7E7EB",
  textMuted: "#A0A0A8",
  danger: "#FF6B6B",
  placeholder: "#6B6B73",
  // Pressed/raised surface and the faint gold wash used to mark a selected row.
  surfaceRaised: "#1F1F22",
  goldTint: "rgba(197, 164, 109, 0.12)",
  // The transparent end of a gradient toward `background`: fading to the
  // literal "transparent" can leave a grey fringe on iOS.
  backgroundClear: "rgba(9, 9, 11, 0)",
} as const;

/**
 * Registered font family names. Safe to use directly in a StyleSheet: until the
 * font registers (or if it never does) React Native falls back to the system
 * font. Screens that want an explicit "loaded" flag use useRomanFonts instead.
 */
export const romanFont = {
  title: "Cinzel-Medium",
  regular: "PlusJakartaSans-Regular",
  medium: "PlusJakartaSans-Medium",
  semibold: "PlusJakartaSans-SemiBold",
} as const;

// Bundled files (see assets/fonts/*/OFL.txt): nothing is fetched at runtime.
const fontFiles = {
  [romanFont.title]: require("../assets/fonts/cinzel/Cinzel-Medium.ttf"),
  [romanFont.regular]: require("../assets/fonts/plus-jakarta-sans/PlusJakartaSans-Regular.ttf"),
  [romanFont.medium]: require("../assets/fonts/plus-jakarta-sans/PlusJakartaSans-Medium.ttf"),
  [romanFont.semibold]: require("../assets/fonts/plus-jakarta-sans/PlusJakartaSans-SemiBold.ttf"),
};

/**
 * Style fragments to spread after a text style. Until the fonts register (or if
 * they never do) every entry is null, so the screen renders with system fonts
 * and stays fully usable.
 */
export function useRomanFonts() {
  const [loaded] = useFonts(fontFiles);
  const make = (fontFamily: string) =>
    loaded ? ({ fontFamily, fontWeight: "normal" } as const) : null;
  return {
    title: make(romanFont.title),
    regular: make(romanFont.regular),
    medium: make(romanFont.medium),
    semibold: make(romanFont.semibold),
  };
}
