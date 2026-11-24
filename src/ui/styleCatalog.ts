export const STATUS_BAR_STYLES = ["pills", "gauges", "compact"] as const;
export type StatusBarStyle = (typeof STATUS_BAR_STYLES)[number];

export const PANEL_STYLES = ["gauges", "cards", "compact"] as const;
export type PanelStyle = (typeof PANEL_STYLES)[number];

export const DEFAULT_STATUS_BAR_STYLE: StatusBarStyle = "pills";
export const DEFAULT_PANEL_STYLE: PanelStyle = "gauges";

export interface StyleCatalogEntry<Id extends string> {
  /** Stable settings value and registry key. */
  readonly id: Id;
  /** Raw gettext key; translated by the preferences page at point of use. */
  readonly label: string;
}

/** Pure style metadata: no factories, CSS strings or GNOME Shell dependencies. */
export const STYLE_CATALOG: {
  readonly panel: Readonly<Record<PanelStyle, StyleCatalogEntry<PanelStyle>>>;
  readonly statusBar: Readonly<Record<StatusBarStyle, StyleCatalogEntry<StatusBarStyle>>>;
} = {
  panel: {
    gauges: { id: "gauges", label: "Tabbed cockpit & gauges" },
    cards: { id: "cards", label: "Quick settings cards" },
    compact: { id: "compact", label: "Collapsible matrix HUD" },
  },
  statusBar: {
    pills: { id: "pills", label: "Capsule pills" },
    gauges: { id: "gauges", label: "Micro-ring gauges" },
    compact: { id: "compact", label: "Compact text" },
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
