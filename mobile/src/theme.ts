/**
 * Shared styling values.
 *
 * A plain object rather than a UI library: the app has four screens so far,
 * and pulling in a component kit now would be a dependency to maintain before
 * we know what the design needs.
 */

export const colors = {
  background: "#0f1115",
  surface: "#1a1d24",
  border: "#2a2f3a",
  text: "#f2f4f8",
  textMuted: "#8b93a3",
  accent: "#3ddc84",
  accentText: "#0f1115",
  danger: "#ff6b6b",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
} as const;
