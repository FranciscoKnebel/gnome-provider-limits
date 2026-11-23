import type Gio from "gi://Gio";
import type St from "gi://St";

import { CardsPanelSection } from "./panelCardsRenderer.js";
import { CompactPanelSection, createExpandAllControl } from "./panelCompact.js";
import { GaugesPanelSection } from "./panelGauges.js";
import type { PanelShell, PanelStyleSection } from "./panelShell.js";
import { CompactStatusBarRenderer } from "./statusBarCompact.js";
import { GaugesStatusBarRenderer } from "./statusBarGauges.js";
import { PillsStatusBarRenderer } from "./statusBarPills.js";
import type { StatusBarSectionRenderer } from "./statusBarRenderer.js";
import { STYLE_CATALOG, type PanelStyle, type StatusBarStyle } from "./styleCatalog.js";

export type { PanelStyle, StatusBarStyle } from "./styleCatalog.js";

export type PointerSignal = "clicked" | "button-release-event";
export type IconSpec = readonly [string, string?];

/** Toolbar footer: a single horizontal row, optionally built from St.Buttons. */
export interface ToolbarFooterSpec {
  readonly layout: "toolbar";
  readonly rowClass: string;
  readonly toolbarClass: string;
  readonly pointerSignal: PointerSignal;
  readonly refreshClass: string;
  readonly settingsClass: string;
  readonly buttonControls: boolean;
  readonly refreshIcon?: IconSpec;
  readonly settingsIcon?: IconSpec;
  readonly labelClass?: string;
  readonly disabledClass?: string;
  readonly refreshContentClass?: string;
}

/** HUD footer: leading title and timestamp, trailing icon buttons and extra controls. */
export interface HudFooterSpec {
  readonly layout: "hud";
  readonly rowClass: string;
  readonly pointerSignal: PointerSignal;
  readonly refreshClass: string;
  readonly settingsClass: string;
  readonly refreshIcon: IconSpec;
  readonly settingsIcon: IconSpec;
}

export type FooterSpec = ToolbarFooterSpec | HudFooterSpec;

export interface PanelSectionHost {
  readonly settings: Gio.Settings;
  readonly createShell: (extraControls?: readonly St.Widget[]) => PanelShell;
}

export type PanelSectionFactory = (host: PanelSectionHost) => PanelStyleSection;
export type StatusBarRendererFactory = (parent: St.BoxLayout) => StatusBarSectionRenderer;

export interface StyleSpec<Id extends string> {
  readonly id: Id;
  readonly label: string;
}

export interface PanelStyleSpec extends StyleSpec<PanelStyle> {
  readonly shellPlacement: ShellPlacement;
  readonly footer: FooterSpec;
  readonly factory: PanelSectionFactory;
}

export interface StatusBarStyleSpec extends StyleSpec<StatusBarStyle> {
  readonly factory: StatusBarRendererFactory;
}

export interface ShellPlacement {
  readonly shellClass: string | null;
  readonly scrollClass: string | undefined;
  readonly insertionIndex: number | undefined;
}

export interface StyleRegistry {
  readonly panel: Readonly<Record<PanelStyle, PanelStyleSpec>>;
  readonly statusBar: Readonly<Record<StatusBarStyle, StatusBarStyleSpec>>;
}

/** The one shell-facing registry: catalog metadata, factories and CSS strings together. */
export const STYLE_REGISTRY: StyleRegistry = {
  panel: {
    gauges: {
      ...STYLE_CATALOG.panel.gauges,
      factory: ({ settings, createShell }) => new GaugesPanelSection(settings, createShell()),
      shellPlacement: {
        shellClass: "pl-cockpit-panel",
        scrollClass: "pl-cockpit-scroll",
        insertionIndex: undefined,
      },
      footer: {
        layout: "toolbar",
        rowClass: "pl-footer-row",
        toolbarClass: "pl-footer-toolbar",
        pointerSignal: "clicked",
        refreshClass: "pl-footer-button pl-refresh-button",
        settingsClass: "pl-footer-button pl-settings-button",
        buttonControls: true,
        refreshContentClass: "pl-footer-button-box",
      },
    },
    cards: {
      ...STYLE_CATALOG.panel.cards,
      factory: ({ createShell }) => new CardsPanelSection(createShell()),
      shellPlacement: {
        shellClass: null,
        scrollClass: "pl-panel-scroll",
        insertionIndex: undefined,
      },
      footer: {
        layout: "toolbar",
        rowClass: "pl-panel-footer-row",
        toolbarClass: "pl-panel-footer",
        pointerSignal: "button-release-event",
        refreshClass: "pl-footer-action pl-refresh-action",
        settingsClass: "pl-footer-action pl-settings-action",
        buttonControls: false,
        refreshIcon: ["view-refresh-symbolic", "pl-footer-icon"],
        settingsIcon: ["preferences-system-symbolic", "pl-footer-icon"],
        labelClass: "pl-footer-action-label",
        disabledClass: "pl-footer-action-disabled",
      },
    },
    compact: {
      ...STYLE_CATALOG.panel.compact,
      factory: ({ createShell }) => {
        const expandAll = createExpandAllControl();
        return new CompactPanelSection(createShell([expandAll.button]), expandAll);
      },
      shellPlacement: {
        shellClass: null,
        scrollClass: undefined,
        insertionIndex: 0,
      },
      footer: {
        layout: "hud",
        rowClass: "provider-limits-hud-toolbar",
        pointerSignal: "clicked",
        refreshClass: "provider-limits-icon-button",
        settingsClass: "provider-limits-icon-button",
        refreshIcon: ["view-refresh-symbolic"],
        settingsIcon: ["emblem-system-symbolic"],
      },
    },
  },
  statusBar: {
    pills: {
      ...STYLE_CATALOG.statusBar.pills,
      factory: (parent) => new PillsStatusBarRenderer(parent),
    },
    gauges: {
      ...STYLE_CATALOG.statusBar.gauges,
      factory: (parent) => new GaugesStatusBarRenderer(parent),
    },
    compact: {
      ...STYLE_CATALOG.statusBar.compact,
      factory: (parent) => new CompactStatusBarRenderer(parent),
    },
  },
};
