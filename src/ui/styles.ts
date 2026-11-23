import type { ViewPhase } from "./viewContext.js";
import type { EmptyPresentation, PanelSurface, StatusBarSurface } from "./viewMessages.js";

export const STATUS_BAR_STYLES = ["pills", "gauges", "compact"] as const;
export type StatusBarStyle = (typeof STATUS_BAR_STYLES)[number];

export const PANEL_STYLES = ["gauges", "cards", "compact"] as const;
export type PanelStyle = (typeof PANEL_STYLES)[number];

export const DEFAULT_STATUS_BAR_STYLE: StatusBarStyle = "pills";
export const DEFAULT_PANEL_STYLE: PanelStyle = "gauges";

export type Translate = (text: string) => string;
export type PhaseMessages = (phase: ViewPhase, running: boolean, t: Translate) => EmptyPresentation;

export type PointerSignal = "clicked" | "button-release-event";

export interface ShellPlacement {
  readonly shellClass: string | null;
  readonly scrollClass: string | undefined;
  readonly insertionIndex: number | undefined;
}

export interface FooterSpec {
  readonly rowClass: string;
  readonly pointerSignal: PointerSignal;
  readonly refreshClass: string;
  readonly settingsClass: string;
  readonly layout: "toolbar" | "hud";
  readonly toolbarClass?: string;
  readonly refreshIcon?: readonly [string, string?];
  readonly settingsIcon?: readonly [string, string?];
  readonly labelClass?: string;
  readonly refreshContentClass?: string;
  readonly disabledClass?: string;
  readonly buttonControls?: boolean;
}

export interface StyleSpec<Id extends string> {
  /** Stable settings value and registry key. */
  readonly id: Id;
  /** Raw gettext key; translated by the preferences page at point of use. */
  readonly label: string;
  /** Key the consumer maps to its concrete section or renderer factory. */
  readonly factory: Id;
  readonly messages: PhaseMessages;
}

export interface PanelStyleSpec extends StyleSpec<PanelStyle> {
  readonly surface: PanelSurface;
  readonly shellPlacement: ShellPlacement;
  readonly footer: FooterSpec;
}

export interface StatusBarStyleSpec extends StyleSpec<StatusBarStyle> {
  readonly surface: StatusBarSurface;
}

const EMPTY_PRESENTATION: EmptyPresentation = {
  title: "",
  subtitle: "",
  placeholder: "",
  accessibleText: "",
  showPlaceholder: false,
};

function withTitle(t: Translate, title: string, subtitle = ""): EmptyPresentation {
  return { ...EMPTY_PRESENTATION, title: t(title), subtitle: subtitle ? t(subtitle) : "" };
}

function withPlaceholder(
  t: Translate,
  accessibleText: string,
  placeholder = "…",
): EmptyPresentation {
  return {
    ...EMPTY_PRESENTATION,
    placeholder,
    accessibleText: t(accessibleText),
    showPlaceholder: true,
  };
}

const CARD_MESSAGES: PhaseMessages = (phase, running, t) => {
  if (phase === "ready") return EMPTY_PRESENTATION;
  if (phase === "empty") {
    return withTitle(
      t,
      "No providers enabled",
      "Enable a provider in Settings to monitor usage limits.",
    );
  }
  return withTitle(t, running ? "Loading provider limits…" : "Waiting for provider data…");
};

const MATRIX_MESSAGES: PhaseMessages = (phase, _running, t) => {
  if (phase === "ready") return EMPTY_PRESENTATION;
  return withTitle(
    t,
    phase === "empty"
      ? "No providers enabled. Open Settings to enable a provider."
      : "Reading provider limits…",
  );
};

const COCKPIT_MESSAGES: PhaseMessages = (phase, _running, t) => {
  if (phase === "ready") return EMPTY_PRESENTATION;
  if (phase === "empty") {
    return withTitle(
      t,
      "No providers enabled",
      "Enable a provider in Settings to monitor usage limits.",
    );
  }
  return {
    title: t("Reading provider limits…"),
    subtitle: t("Waiting for initial refresh to complete."),
    placeholder: "…",
    accessibleText: t("Refreshing…"),
    showPlaceholder: true,
  };
};

const PILLS_MESSAGES: PhaseMessages = (phase, _running, t) =>
  phase === "loading" ? withPlaceholder(t, "Loading provider limits…") : EMPTY_PRESENTATION;

const STATUS_GAUGES_MESSAGES: PhaseMessages = (phase, _running, t) => {
  if (phase === "ready") return EMPTY_PRESENTATION;
  if (phase === "empty") {
    return withTitle(
      t,
      "No providers enabled",
      "Enable a provider in Settings to monitor usage limits.",
    );
  }
  return {
    title: t("Reading provider limits…"),
    subtitle: t("Waiting for initial refresh to complete."),
    placeholder: "…",
    accessibleText: t("Refreshing…"),
    showPlaceholder: true,
  };
};

const STATUS_COMPACT_MESSAGES: PhaseMessages = (phase, _running, t) =>
  phase === "loading" ? withPlaceholder(t, "Reading provider limits…") : EMPTY_PRESENTATION;

export interface StyleRegistry {
  readonly panel: Readonly<Record<PanelStyle, PanelStyleSpec>>;
  readonly statusBar: Readonly<Record<StatusBarStyle, StatusBarStyleSpec>>;
}

/** The one registry for both bars: ids, labels, factories, placement, footer and phase copy. */
export const STYLE_REGISTRY: StyleRegistry = {
  panel: {
    gauges: {
      id: "gauges",
      label: "Tabbed cockpit & gauges",
      factory: "gauges",
      surface: "cockpit",
      messages: COCKPIT_MESSAGES,
      shellPlacement: {
        shellClass: "pl-cockpit-panel",
        scrollClass: "pl-cockpit-scroll",
        insertionIndex: undefined,
      },
      footer: {
        rowClass: "pl-footer-row",
        toolbarClass: "pl-footer-toolbar",
        pointerSignal: "clicked",
        refreshClass: "pl-footer-button pl-refresh-button",
        settingsClass: "pl-footer-button pl-settings-button",
        layout: "toolbar",
        buttonControls: true,
        refreshContentClass: "pl-footer-button-box",
      },
    },
    cards: {
      id: "cards",
      label: "Quick settings cards",
      factory: "cards",
      surface: "cards",
      messages: CARD_MESSAGES,
      shellPlacement: {
        shellClass: null,
        scrollClass: "pl-panel-scroll",
        insertionIndex: undefined,
      },
      footer: {
        rowClass: "pl-panel-footer-row",
        toolbarClass: "pl-panel-footer",
        pointerSignal: "button-release-event",
        refreshClass: "pl-footer-action pl-refresh-action",
        settingsClass: "pl-footer-action pl-settings-action",
        layout: "toolbar",
        refreshIcon: ["view-refresh-symbolic", "pl-footer-icon"],
        settingsIcon: ["preferences-system-symbolic", "pl-footer-icon"],
        labelClass: "pl-footer-action-label",
        disabledClass: "pl-footer-action-disabled",
      },
    },
    compact: {
      id: "compact",
      label: "Collapsible matrix HUD",
      factory: "compact",
      surface: "matrix",
      messages: MATRIX_MESSAGES,
      shellPlacement: {
        shellClass: null,
        scrollClass: undefined,
        insertionIndex: 0,
      },
      footer: {
        rowClass: "provider-limits-hud-toolbar",
        pointerSignal: "clicked",
        refreshClass: "provider-limits-icon-button",
        settingsClass: "provider-limits-icon-button",
        layout: "hud",
        buttonControls: true,
        refreshIcon: ["view-refresh-symbolic"],
        settingsIcon: ["emblem-system-symbolic"],
      },
    },
  },
  statusBar: {
    pills: {
      id: "pills",
      label: "Capsule pills",
      factory: "pills",
      surface: "pills",
      messages: PILLS_MESSAGES,
    },
    gauges: {
      id: "gauges",
      label: "Micro-ring gauges",
      factory: "gauges",
      surface: "gauges",
      messages: STATUS_GAUGES_MESSAGES,
    },
    compact: {
      id: "compact",
      label: "Compact text",
      factory: "compact",
      surface: "compact",
      messages: STATUS_COMPACT_MESSAGES,
    },
  },
};

export function isPanelStyle(value: string): value is PanelStyle {
  return Object.hasOwn(STYLE_REGISTRY.panel, value);
}

export function isStatusBarStyle(value: string): value is StatusBarStyle {
  return Object.hasOwn(STYLE_REGISTRY.statusBar, value);
}

export function resolveStatusBarStyle(value: string): StatusBarStyle {
  return isStatusBarStyle(value) ? value : DEFAULT_STATUS_BAR_STYLE;
}

export function resolvePanelStyle(value: string): PanelStyle {
  return isPanelStyle(value) ? value : DEFAULT_PANEL_STYLE;
}

const SPEC_BY_SURFACE: Readonly<
  Record<PanelSurface | StatusBarSurface, PanelStyleSpec | StatusBarStyleSpec>
> = {
  cards: STYLE_REGISTRY.panel.cards,
  matrix: STYLE_REGISTRY.panel.compact,
  cockpit: STYLE_REGISTRY.panel.gauges,
  pills: STYLE_REGISTRY.statusBar.pills,
  gauges: STYLE_REGISTRY.statusBar.gauges,
  compact: STYLE_REGISTRY.statusBar.compact,
};

/** Resolve the one spec that owns copy and presentation for a view surface. */
export function styleSpecForSurface(
  surface: PanelSurface | StatusBarSurface,
): PanelStyleSpec | StatusBarStyleSpec {
  return SPEC_BY_SURFACE[surface];
}
