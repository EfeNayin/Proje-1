/**
 * Light palette for redesigned screens (Training home first).
 *
 * Deliberately separate from theme.ts and romanTheme.ts, the same way
 * romanTheme.ts is separate from theme.ts: screens that have not been
 * redesigned keep their own colours, and a screen opts in by importing from
 * here. Text uses the platform system font, so there is nothing to load.
 *
 * Contrast (WCAG), checked when the values were chosen:
 * text on background 17.3:1, textSecondary on background 5.5:1 and on surface
 * 6.0:1, onPrimary on primary 18.9:1, danger on surface 6.5:1, positive on
 * background 4.7:1.
 */

export const light = {
  background: "#F5F5F7",
  surface: "#FFFFFF",
  text: "#111111",
  textSecondary: "#636366",
  // Primary action: near-black fill with white text.
  primary: "#111111",
  onPrimary: "#FFFFFF",
  primaryPressed: "#3A3A3C",
  separator: "#E5E5EA",
  pressed: "#EDEDF0",
  danger: "#B3261E",
  // A workout that is in progress.
  positive: "#1A7F37",
  scrim: "rgba(0, 0, 0, 0.4)",
} as const;
