import Clutter from "gi://Clutter";
import type Gio from "gi://Gio";
import St from "gi://St";
import { ensureActorVisibleInScrollView } from "resource:///org/gnome/shell/misc/animationUtils.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import type { ProviderName } from "../constants.js";
import { bindActivation } from "../helpers/keyboard.js";
import { providerDisplayName } from "../helpers/provider-settings.js";
import type { FieldDef, ReaderResult } from "../readers/base.js";
import { ReaderStatus } from "../readers/base.js";
import { disposeCairoContext, drawMiniCapsule, isCairoContext } from "./cairoDrawing.js";
import { buildOverviewRowModel, getAvailableTabs } from "./cockpitModel.js";
import type { CockpitTab, OverviewBadgeKind, OverviewRowModel } from "./cockpitModel.js";
import type { MicroMeterSpec } from "./gaugeTypes.js";
import type { PanelShell } from "./panelShell.js";
import { structureKey } from "./renderStructure.js";
import { PlanRenderer, type RenderPlan } from "./statusBarRenderer.js";
import { applyToneClass } from "./tone.js";

const OVERVIEW_BAR_WIDTH = 56;
const OVERVIEW_BAR_HEIGHT = 6;

const BADGE_CLASSES = [
  "pl-badge-ok",
  "pl-badge-cached",
  "pl-badge-partial",
  "pl-badge-error",
  "pl-badge-loading",
] as const;

const HEALTH_CLASSES = [
  "pl-health-ok",
  "pl-health-partial",
  "pl-health-error",
  "pl-health-loading",
] as const;

const BADGE_CLASS_BY_KIND: Record<OverviewBadgeKind, string> = {
  ok: "pl-badge-ok",
  cached: "pl-badge-cached",
  partial: "pl-badge-partial",
  error: "pl-badge-error",
  loading: "pl-badge-loading",
};

function badgeClassFor(kind: OverviewBadgeKind): string {
  return BADGE_CLASS_BY_KIND[kind];
}

function healthClassFor(result: ReaderResult | undefined): string {
  if (!result) return "pl-health-loading";
  switch (result.status) {
    case ReaderStatus.OK:
      return "pl-health-ok";
    case ReaderStatus.PARTIAL:
      return "pl-health-partial";
    case ReaderStatus.ERROR:
    case ReaderStatus.UNAVAILABLE:
      return "pl-health-error";
    default:
      return "pl-health-loading";
  }
}

interface TabButtonWidgets {
  tab: CockpitTab;
  button: St.Button;
  label: St.Label;
  healthDot: St.Widget | null;
}

interface OverviewRowWidgets {
  item: PopupMenu.PopupBaseMenuItem;
  nameLabel: St.Label;
  badgeLabel: St.Label;
  meter: MicroMeterSpec;
  barArea: St.DrawingArea;
  primaryLabel: St.Label;
  secondaryLabel: St.Label | null;
}

export interface OverviewHost {
  readonly settings: Gio.Settings;
  readonly fieldDefs: Readonly<Record<ProviderName, readonly FieldDef[]>>;
  readonly shell: PanelShell;
  readonly translate: (message: string) => string;
  selectTab(tab: CockpitTab, focusTabButton?: boolean): void;
  handleArrowNavigation(event: Clutter.Event): boolean;
  getActiveTab(): CockpitTab;
  getEnabledProviders(): readonly ProviderName[];
}

interface TabBarContext {
  readonly enabledProviders: readonly ProviderName[];
  readonly results: Map<ProviderName, ReaderResult>;
  readonly locale: string;
  readonly activeTab: CockpitTab;
}

interface TabBarPlan extends RenderPlan {
  readonly tabs: readonly CockpitTab[];
  readonly activeTab: CockpitTab;
  readonly results: Map<ProviderName, ReaderResult>;
}

/** Owns the persistent tab bar through the same plan lifecycle as every other renderer. */
class TabBarRenderer extends PlanRenderer<TabBarPlan, TabBarContext> {
  constructor(
    private readonly bar: St.BoxLayout,
    private readonly headerRow: PopupMenu.PopupBaseMenuItem,
    private readonly buttons: TabButtonWidgets[],
    private readonly host: OverviewHost,
  ) {
    super();
  }

  protected plan(context: TabBarContext): TabBarPlan {
    if (context.enabledProviders.length === 0) {
      return { key: "", tabs: [], activeTab: context.activeTab, results: context.results };
    }
    const key = structureKey([
      context.locale,
      ...context.enabledProviders.map(
        (name) => `${name}:${providerDisplayName(this.host.settings, name)}`,
      ),
    ]);
    return {
      key,
      tabs: getAvailableTabs(context.enabledProviders),
      activeTab: context.activeTab,
      results: context.results,
    };
  }

  protected clear(): void {
    let child = this.bar.get_first_child?.() ?? null;
    while (child) {
      const next = child.get_next_sibling();
      child.destroy();
      child = next;
    }
  }

  protected override onDispose(): void {
    this.buttons.length = 0;
  }

  protected build(plan: TabBarPlan): void {
    this.headerRow.visible = plan.tabs.length > 0;
    for (const tab of plan.tabs) {
      const isOverview = tab === "overview";
      const labelText = isOverview
        ? this.host.translate("Overview")
        : providerDisplayName(this.host.settings, tab);

      const content = new St.BoxLayout({
        style_class: "pl-tab-button-content",
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
      });

      let healthDot: St.Widget | null = null;
      if (!isOverview) {
        healthDot = new St.Widget({
          style_class: "pl-health-dot",
          y_align: Clutter.ActorAlign.CENTER,
        });
        content.add_child(healthDot);
      }

      const label = new St.Label({
        text: labelText,
        style_class: "pl-tab-label",
        y_align: Clutter.ActorAlign.CENTER,
      });
      content.add_child(label);

      const button = new St.Button({
        style_class: "pl-tab-button",
        reactive: true,
        can_focus: true,
        track_hover: true,
        x_expand: true,
        child: content,
      });
      button.accessible_name = labelText;
      bindActivation(button, () => this.host.selectTab(tab), {
        pointerSignals: ["clicked"],
        onOtherKey: (event) => this.host.handleArrowNavigation(event),
      });

      this.bar.add_child(button);
      this.buttons.push({ tab, button, label, healthDot });
    }
  }

  protected update(plan: TabBarPlan): void {
    this.headerRow.visible = plan.tabs.length > 0;
    for (const entry of this.buttons) {
      const isActive = entry.tab === plan.activeTab;
      if (isActive) entry.button.add_style_class_name("pl-tab-button-active");
      else entry.button.remove_style_class_name("pl-tab-button-active");

      if (entry.tab !== "overview" && entry.healthDot) {
        for (const cls of HEALTH_CLASSES) {
          entry.healthDot.remove_style_class_name(cls);
        }
        entry.healthDot.add_style_class_name(healthClassFor(plan.results.get(entry.tab)));
      }
    }
  }
}

interface OverviewRowsContext {
  readonly enabledProviders: readonly ProviderName[];
  readonly results: Map<ProviderName, ReaderResult>;
  readonly locale: string;
}

type OverviewRowsPlan = RenderPlan & {
  readonly models: readonly OverviewRowModel[];
};

/** Owns the overview body rows through the shared incremental-render lifecycle. */
class OverviewRowsRenderer extends PlanRenderer<OverviewRowsPlan, OverviewRowsContext> {
  constructor(
    private readonly host: OverviewHost,
    private readonly rows: OverviewRowWidgets[],
  ) {
    super();
  }

  protected plan(context: OverviewRowsContext): OverviewRowsPlan {
    const models = context.enabledProviders.map((provider) => {
      const fieldsDefs = this.host.fieldDefs[provider];
      return buildOverviewRowModel({
        provider,
        displayName: providerDisplayName(this.host.settings, provider),
        fieldsDefs,
        result: context.results.get(provider),
        statusFieldNames: this.host.settings.get_strv(`${provider}-status-fields`),
        panelFieldNames: this.host.settings.get_strv(`${provider}-panel-fields`),
        locale: context.locale,
        t: this.host.translate,
      });
    });

    const key = structureKey([
      context.locale,
      "overview",
      ...models.map((m) => `${m.provider}:${m.secondaryText === null ? "0" : "1"}`),
    ]);
    return { key, models };
  }

  protected clear(): void {
    this.host.shell.clearBody();
  }

  protected override onDispose(): void {
    this.rows.length = 0;
  }

  protected build(plan: OverviewRowsPlan): void {
    for (const model of plan.models) {
      const item = new PopupMenu.PopupBaseMenuItem({
        reactive: true,
        can_focus: true,
        activate: false,
        hover: true,
      });
      item.add_style_class_name("pl-overview-row");
      item.accessible_name = model.accessibleText;
      item.connect("key-focus-in", () =>
        ensureActorVisibleInScrollView(this.host.shell.scrollView, item),
      );
      bindActivation(item, () => this.host.selectTab(model.provider, true), {
        pointerSignals: ["button-release-event"],
        onOtherKey: (event) => this.host.handleArrowNavigation(event),
      });

      const outer = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        style_class: "pl-overview-content",
      });

      const topRow = new St.BoxLayout({
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: "pl-overview-top",
      });

      const leftGroup = new St.BoxLayout({
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: "pl-overview-left",
      });

      const nameLabel = new St.Label({
        text: model.displayName,
        style_class: "pl-overview-name",
        y_align: Clutter.ActorAlign.CENTER,
      });

      const badgeLabel = new St.Label({
        text: model.badgeText,
        style_class: `pl-badge ${badgeClassFor(model.badgeKind)}`,
        y_align: Clutter.ActorAlign.CENTER,
      });

      leftGroup.add_child(nameLabel);
      leftGroup.add_child(badgeLabel);

      const rightGroup = new St.BoxLayout({
        y_align: Clutter.ActorAlign.CENTER,
        style_class: "pl-overview-right",
      });

      const barArea = new St.DrawingArea({
        style_class: "pl-overview-bar",
        width: OVERVIEW_BAR_WIDTH,
        height: OVERVIEW_BAR_HEIGHT,
        y_align: Clutter.ActorAlign.CENTER,
      });

      const primaryLabel = new St.Label({
        text: model.primaryText,
        style_class: "pl-overview-primary",
        y_align: Clutter.ActorAlign.CENTER,
      });
      applyToneClass(primaryLabel, model.tone);

      const chevronLabel = new St.Label({
        text: "›",
        style_class: "provider-limits-dim pl-overview-chevron",
        y_align: Clutter.ActorAlign.CENTER,
      });

      rightGroup.add_child(barArea);
      rightGroup.add_child(primaryLabel);
      rightGroup.add_child(chevronLabel);

      topRow.add_child(leftGroup);
      topRow.add_child(rightGroup);
      outer.add_child(topRow);

      let secondaryLabel: St.Label | null = null;
      if (model.secondaryText !== null) {
        secondaryLabel = new St.Label({
          text: model.secondaryText,
          style_class: "provider-limits-dim pl-overview-secondary",
          x_expand: true,
          x_align: Clutter.ActorAlign.START,
        });
        secondaryLabel.clutter_text.line_wrap = true;
        outer.add_child(secondaryLabel);
      }

      const rowWidgets: OverviewRowWidgets = {
        item,
        nameLabel,
        badgeLabel,
        meter: model.meter,
        barArea,
        primaryLabel,
        secondaryLabel,
      };

      barArea.connect("repaint", (area: St.DrawingArea) => {
        const rawCr: unknown = area.get_context();
        try {
          if (isCairoContext(rawCr)) {
            const [w, h] = area.get_surface_size();
            drawMiniCapsule(rawCr, w, h, rowWidgets.meter);
          }
        } finally {
          disposeCairoContext(rawCr);
        }
      });

      item.add_child(outer);
      this.host.shell.addBodyItem(item);
      this.rows.push(rowWidgets);
      barArea.queue_repaint();
    }
  }

  protected update(plan: OverviewRowsPlan): void {
    plan.models.forEach((model, idx) => {
      const widgets = this.rows[idx];
      if (!widgets) return;

      widgets.item.accessible_name = model.accessibleText;
      widgets.nameLabel.text = model.displayName;
      widgets.badgeLabel.text = model.badgeText;
      for (const cls of BADGE_CLASSES) {
        widgets.badgeLabel.remove_style_class_name(cls);
      }
      widgets.badgeLabel.add_style_class_name(badgeClassFor(model.badgeKind));

      widgets.meter = model.meter;
      widgets.barArea.queue_repaint();

      widgets.primaryLabel.text = model.primaryText;
      applyToneClass(widgets.primaryLabel, model.tone);

      if (widgets.secondaryLabel && model.secondaryText !== null) {
        widgets.secondaryLabel.text = model.secondaryText;
      }
    });
  }
}

/** Tab bar, overview rows and mini bars for the gauges panel style. */
export class OverviewRenderer {
  private readonly _host: OverviewHost;
  private readonly _tabHeaderRow: PopupMenu.PopupBaseMenuItem;
  private readonly _tabBar: St.BoxLayout;
  private readonly _tabButtons: TabButtonWidgets[] = [];
  private readonly _rows: OverviewRowWidgets[] = [];
  private readonly _tabRenderer: TabBarRenderer;
  private readonly _rowsRenderer: OverviewRowsRenderer;

  constructor(host: OverviewHost) {
    this._host = host;
    this._tabHeaderRow = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
      activate: false,
      hover: false,
    });
    this._tabHeaderRow.add_style_class_name("provider-limits-static-row");
    this._tabHeaderRow.add_style_class_name("pl-tab-header-row");
    this._tabHeaderRow.visible = false;

    this._tabBar = new St.BoxLayout({ style_class: "pl-tab-bar", x_expand: true });
    this._tabHeaderRow.add_child(this._tabBar);
    host.shell.addHeaderItem(this._tabHeaderRow);

    this._tabRenderer = new TabBarRenderer(
      this._tabBar,
      this._tabHeaderRow,
      this._tabButtons,
      host,
    );
    this._rowsRenderer = new OverviewRowsRenderer(host, this._rows);
  }

  reset(): void {
    this._rowsRenderer.dispose();
  }

  focusTabButton(tab: CockpitTab): void {
    const match = this._tabButtons.find((entry) => entry.tab === tab);
    match?.button.grab_key_focus?.();
  }

  syncTabHeader(
    enabledProviders: readonly ProviderName[],
    results: Map<ProviderName, ReaderResult>,
    locale: string,
  ): void {
    this._tabRenderer.render({
      enabledProviders,
      results,
      locale,
      activeTab: this._host.getActiveTab(),
    });
  }

  render(context: OverviewRowsContext): void {
    this._rowsRenderer.render(context);
  }
}
