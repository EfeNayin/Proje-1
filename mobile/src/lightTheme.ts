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

/**
 * Weekly-volume status colours for light surfaces. The app-wide statusColors in
 * theme.ts are tuned for dark backgrounds (the amber and green are about 2:1 on
 * white), so light screens use these. `text` is for labels (>= 4.5:1 on white:
 * 5.9, 5.1, 5.7, 6.5, 6.0), `fill` for bars (>= 3:1 on white: 3.5, 5.1, 5.7,
 * 6.5). The status label always accompanies the colour; it never carries the
 * meaning alone.
 */
export const lightStatus = {
  untrained: { text: "#636366", fill: "#8E8E93" },
  below_mev: { text: "#8A5A00", fill: "#C77700" },
  optimal: { text: "#1A7F37", fill: "#1A7F37" },
  high: { text: "#0A64C8", fill: "#0A64C8" },
  above_mrv: { text: "#B3261E", fill: "#B3261E" },
  no_reference: { text: "#636366", fill: "#8E8E93" },
} as const;
