export const STATUS_BAR_STYLES = ["pills", "gauges", "compact"] as const;
export type StatusBarStyle = (typeof STATUS_BAR_STYLES)[number];

export const PANEL_STYLES = ["gauges", "cards", "compact"] as const;
export type PanelStyle = (typeof PANEL_STYLES)[number];

export const DEFAULT_STATUS_BAR_STYLE: StatusBarStyle = "pills";
export const DEFAULT_PANEL_STYLE: PanelStyle = "gauges";

/** A complete, typed mapping from every style name to a value of the same type. */
export type StyleDispatch<Style extends string, Value> = Record<Style, Value>;

export function isStatusBarStyle(value: string): value is StatusBarStyle {
  return (STATUS_BAR_STYLES as readonly string[]).includes(value);
}

export function isPanelStyle(value: string): value is PanelStyle {
  return (PANEL_STYLES as readonly string[]).includes(value);
}

export function resolveStatusBarStyle(value: string): StatusBarStyle {
  return isStatusBarStyle(value) ? value : DEFAULT_STATUS_BAR_STYLE;
}

export function resolvePanelStyle(value: string): PanelStyle {
  return isPanelStyle(value) ? value : DEFAULT_PANEL_STYLE;
}
