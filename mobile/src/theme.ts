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
  accentDark: "#1f9d5c",
  accentText: "#0f1115",
  danger: "#ff6b6b",
} as const;

/**
 * Colours for the weekly volume readout.
 *
 * "high" is blue rather than a warning shade: between MAV and MRV is hard but
 * productive training, not a mistake. Only above MRV is a problem.
 */
export const statusColors = {
  untrained: "#4a5160",
  below_mev: "#f0a955",
  optimal: "#3ddc84",
  high: "#4aa3f0",
  above_mrv: "#ff6b6b",
} as const;

export const statusLabels = {
  untrained: "Not trained",
  below_mev: "Below MEV",
  optimal: "Optimal",
  high: "High",
  above_mrv: "Over MRV",
} as const;

/**
 * Colours for diagnosis findings, by severity. Reuses the same tokens as
 * statusColors above rather than inventing a second palette: "critical" is
 * the same red as "above_mrv", "warning" the same amber as "below_mev",
 * "good" the same green as "optimal". "info" (not enough data yet) gets the
 * neutral muted tone — it isn't good or bad, just missing.
 */
export const findingSeverityColors = {
  critical: statusColors.above_mrv,
  warning: statusColors.below_mev,
  good: statusColors.optimal,
  info: colors.textMuted,
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