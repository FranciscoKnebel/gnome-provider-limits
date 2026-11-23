import type { PanelSurface, StatusBarSurface } from "./viewMessages.js";

export const STATUS_BAR_STYLES = ["pills", "gauges", "compact"] as const;
export type StatusBarStyle = (typeof STATUS_BAR_STYLES)[number];

export const PANEL_STYLES = ["gauges", "cards", "compact"] as const;
export type PanelStyle = (typeof PANEL_STYLES)[number];

export const DEFAULT_STATUS_BAR_STYLE: StatusBarStyle = "pills";
export const DEFAULT_PANEL_STYLE: PanelStyle = "gauges";

export interface StyleCatalogEntry<Id extends string, Surface extends string> {
  /** Stable settings value and registry key. */
  readonly id: Id;
  /** Raw gettext key; translated by the preferences page at point of use. */
  readonly label: string;
  readonly surface: Surface;
}

/** Pure style metadata: no factories, CSS strings or GNOME Shell dependencies. */
export const STYLE_CATALOG: {
  readonly panel: Readonly<Record<PanelStyle, StyleCatalogEntry<PanelStyle, PanelSurface>>>;
  readonly statusBar: Readonly<
    Record<StatusBarStyle, StyleCatalogEntry<StatusBarStyle, StatusBarSurface>>
  >;
} = {
  panel: {
    gauges: { id: "gauges", label: "Tabbed cockpit & gauges", surface: "cockpit" },
    cards: { id: "cards", label: "Quick settings cards", surface: "cards" },
    compact: { id: "compact", label: "Collapsible matrix HUD", surface: "matrix" },
  },
  statusBar: {
    pills: { id: "pills", label: "Capsule pills", surface: "pills" },
    gauges: { id: "gauges", label: "Micro-ring gauges", surface: "gauges" },
    compact: { id: "compact", label: "Compact text", surface: "compact" },
  },
};

export function isPanelStyle(value: string): value is PanelStyle {
  return Object.hasOwn(STYLE_CATALOG.panel, value);
}

export function isStatusBarStyle(value: string): value is StatusBarStyle {
  return Object.hasOwn(STYLE_CATALOG.statusBar, value);
}

export function resolveStatusBarStyle(value: string): StatusBarStyle {
  return isStatusBarStyle(value) ? value : DEFAULT_STATUS_BAR_STYLE;
}

export function resolvePanelStyle(value: string): PanelStyle {
  return isPanelStyle(value) ? value : DEFAULT_PANEL_STYLE;
}
