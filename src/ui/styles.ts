import type Gio from "gi://Gio";
import type St from "gi://St";

import { CardsPanelSection } from "./panelCardsRenderer.js";
import { CompactPanelSection, createExpandAllControl } from "./panelCompact.js";
import { buildCardsFooter, buildGaugesFooter, buildHudFooter } from "./panelFooter.js";
import type { FooterBuild, FooterOptions } from "./panelFooter.js";
import { GaugesPanelSection } from "./panelGauges.js";
import type { PanelShell, PanelStyleSection } from "./panelShell.js";
import { CompactStatusBarRenderer } from "./statusBarCompact.js";
import { GaugesStatusBarRenderer } from "./statusBarGauges.js";
import { PillsStatusBarRenderer } from "./statusBarPills.js";
import type { StatusBarSectionRenderer } from "./statusBarRenderer.js";
import { STYLE_CATALOG, type PanelStyle, type StatusBarStyle } from "./styleCatalog.js";

export type { PanelStyle, StatusBarStyle } from "./styleCatalog.js";

export interface PanelSectionHost {
  readonly settings: Gio.Settings;
  readonly createShell: (extraControls?: readonly St.Widget[]) => PanelShell;
}

export type PanelSectionFactory = (host: PanelSectionHost) => PanelStyleSection;
export type StatusBarRendererFactory = (parent: St.BoxLayout) => StatusBarSectionRenderer;
export type FooterFactory = (options: FooterOptions) => FooterBuild;

export interface StyleSpec<Id extends string> {
  readonly id: Id;
  readonly label: string;
}

export interface PanelStyleSpec extends StyleSpec<PanelStyle> {
  readonly shellPlacement: ShellPlacement;
  readonly footerFactory: FooterFactory;
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
      footerFactory: buildGaugesFooter,
      shellPlacement: {
        shellClass: "pl-cockpit-panel",
        scrollClass: "pl-cockpit-scroll",
        insertionIndex: undefined,
      },
    },
    cards: {
      ...STYLE_CATALOG.panel.cards,
      factory: ({ createShell }) => new CardsPanelSection(createShell()),
      footerFactory: buildCardsFooter,
      shellPlacement: {
        shellClass: null,
        scrollClass: "pl-panel-scroll",
        insertionIndex: undefined,
      },
    },
    compact: {
      ...STYLE_CATALOG.panel.compact,
      factory: ({ createShell }) => {
        const expandAll = createExpandAllControl();
        return new CompactPanelSection(createShell([expandAll.button]), expandAll);
      },
      footerFactory: buildHudFooter,
      shellPlacement: {
        shellClass: null,
        scrollClass: undefined,
        insertionIndex: 0,
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
