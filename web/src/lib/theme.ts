// Theme tokens -- validated reference palette (dataviz skill), wired to CSS
// variables defined in globals.css so every consumer is dark-mode aware
// automatically. Single source of truth so colors aren't hand-copied as hex
// literals across components.

export const SURFACE = "var(--tl-surface)"; // card/chart surface
export const PAGE = "var(--tl-page)"; // page background
export const BORDER = "var(--tl-border)";
export const BORDER_SOFT = "var(--tl-border-soft)";

export const TEXT_PRIMARY = "var(--tl-text-primary)";
export const TEXT_SECONDARY = "var(--tl-text-secondary)";
export const TEXT_MUTED = "var(--tl-text-muted)";

export const GRIDLINE = "var(--tl-gridline)";
export const BASELINE = "var(--tl-baseline)";

export const STATUS_GOOD = "var(--tl-status-good)";
export const STATUS_WARNING = "var(--tl-status-warning)";
export const STATUS_SERIOUS = "var(--tl-status-serious)";
export const STATUS_CRITICAL = "var(--tl-status-critical)";

export const CHART_BLUE = "var(--tl-chart-blue)";
export const CHART_RED = "var(--tl-chart-red)";
export const CHART_GREEN = "var(--tl-chart-green)";
export const CHART_AMBER = "var(--tl-chart-amber)";
export const CHART_TEAL = "var(--tl-chart-teal)";

// Shared table chrome -- header row background and hover tint, theme-aware.
export const TABLE_HEADER_BG = "color-mix(in srgb, var(--tl-text-primary) 3%, transparent)";

/**
 * A translucent tint of a theme color, e.g. for status pill backgrounds.
 * Replaces the old `${hex}1a`-style suffix trick, which only works on
 * literal hex strings -- CSS variables need color-mix() instead.
 */
export function tint(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}
