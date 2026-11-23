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

/** Declarative description of one footer action (refresh or settings). */
export interface PanelFooterActionSpec {
  readonly controlClass: string;
  readonly contentClass: string | null;
  readonly useButton: boolean;
  readonly iconName: string | null;
  readonly iconClass: string | null;
  readonly includeLabel: boolean;
  readonly labelClass: string | null;
  readonly spinnerFirst: boolean;
  readonly iconHidesWhenRunning: boolean;
}

/** Declarative description of the shell chrome for one panel style. */
export interface PanelFooterSpec {
  readonly panelClass: string | null;
  readonly scrollClass: string | undefined;
  readonly footerRowClass: string;
  readonly toolbarClass: string | null;
  readonly footerAboveBody: boolean;
  readonly compact: boolean;
  readonly disabledRefreshClass: string | null;
  readonly refresh: PanelFooterActionSpec;
  readonly settings: PanelFooterActionSpec;
}

/** Single source of truth for footer construction, keyed by panel style. */
export const PANEL_FOOTER_SPECS: StyleDispatch<PanelStyle, PanelFooterSpec> = {
  gauges: {
    panelClass: "pl-cockpit-panel",
    scrollClass: "pl-cockpit-scroll",
    footerRowClass: "pl-footer-row",
    toolbarClass: "pl-footer-toolbar",
    footerAboveBody: false,
    compact: false,
    disabledRefreshClass: null,
    refresh: {
      controlClass: "pl-footer-button pl-refresh-button",
      contentClass: "pl-footer-button-box",
      useButton: true,
      iconName: null,
      iconClass: null,
      includeLabel: true,
      labelClass: null,
      spinnerFirst: true,
      iconHidesWhenRunning: false,
    },
    settings: {
      controlClass: "pl-footer-button pl-settings-button",
      contentClass: null,
      useButton: true,
      iconName: null,
      iconClass: null,
      includeLabel: true,
      labelClass: null,
      spinnerFirst: false,
      iconHidesWhenRunning: false,
    },
  },
  cards: {
    panelClass: null,
    scrollClass: "pl-panel-scroll",
    footerRowClass: "pl-panel-footer-row",
    toolbarClass: "pl-panel-footer",
    footerAboveBody: false,
    compact: false,
    disabledRefreshClass: "pl-footer-action-disabled",
    refresh: {
      controlClass: "pl-footer-action pl-refresh-action",
      contentClass: null,
      useButton: false,
      iconName: "view-refresh-symbolic",
      iconClass: "pl-footer-icon",
      includeLabel: true,
      labelClass: "pl-footer-action-label",
      spinnerFirst: true,
      iconHidesWhenRunning: true,
    },
    settings: {
      controlClass: "pl-footer-action pl-settings-action",
      contentClass: null,
      useButton: false,
      iconName: "preferences-system-symbolic",
      iconClass: "pl-footer-icon",
      includeLabel: true,
      labelClass: "pl-footer-action-label",
      spinnerFirst: false,
      iconHidesWhenRunning: false,
    },
  },
  compact: {
    panelClass: null,
    scrollClass: undefined,
    footerRowClass: "provider-limits-hud-toolbar",
    toolbarClass: null,
    footerAboveBody: true,
    compact: true,
    disabledRefreshClass: null,
    refresh: {
      controlClass: "provider-limits-icon-button",
      contentClass: null,
      useButton: true,
      iconName: "view-refresh-symbolic",
      iconClass: null,
      includeLabel: false,
      labelClass: null,
      spinnerFirst: false,
      iconHidesWhenRunning: false,
    },
    settings: {
      controlClass: "provider-limits-icon-button",
      contentClass: null,
      useButton: true,
      iconName: "emblem-system-symbolic",
      iconClass: null,
      includeLabel: false,
      labelClass: null,
      spinnerFirst: false,
      iconHidesWhenRunning: false,
    },
  },
};
