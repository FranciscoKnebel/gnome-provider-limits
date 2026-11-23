import Clutter from "gi://Clutter";
import type Gio from "gi://Gio";
import St from "gi://St";
import { ensureActorVisibleInScrollView } from "resource:///org/gnome/shell/misc/animationUtils.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import type { ProviderName } from "../constants.js";
import { clearChildren } from "../helpers/children.js";
import { bindActivation } from "../helpers/keyboard.js";
import { providerDisplayName } from "../helpers/provider-settings.js";
import { connectRepaint, drawMiniCapsule } from "./cairoDrawing.js";
import { buildOverviewRowModel, getAvailableTabs, loadingOverviewRow } from "./cockpitModel.js";
import type { CockpitTab, OverviewBadgeKind, OverviewRowModel } from "./cockpitModel.js";
import type { ProviderDisplayModel } from "./displayModel.js";
import type { PanelShell } from "./panelShell.js";
import { applyHealthToneClass, applyToneClass } from "./tone.js";

const OVERVIEW_BAR_WIDTH = 56;
const OVERVIEW_BAR_HEIGHT = 6;

const BADGE_CLASS_BY_KIND: Record<OverviewBadgeKind, string> = {
  ok: "pl-badge-ok",
  cached: "pl-badge-cached",
  partial: "pl-badge-partial",
  error: "pl-badge-error",
  loading: "pl-badge-loading",
};

export interface OverviewHost {
  readonly settings: Gio.Settings;
  readonly shell: PanelShell;
  readonly translate: (message: string) => string;
  selectTab(tab: CockpitTab, focusTabButton?: boolean): void;
  handleArrowNavigation(event: Clutter.Event): boolean;
  getActiveTab(): CockpitTab;
  getEnabledProviders(): readonly ProviderName[];
}

interface TabBarContext {
  readonly enabledProviders: readonly ProviderName[];
  readonly models: readonly ProviderDisplayModel[];
  readonly activeTab: CockpitTab;
}

/** Rebuilds the tab bar from one freshly derived context. */
class TabBarRenderer {
  private readonly _buttons = new Map<CockpitTab, St.Button>();

  constructor(
    private readonly bar: St.BoxLayout,
    private readonly headerRow: PopupMenu.PopupBaseMenuItem,
    private readonly host: OverviewHost,
  ) {}

  render(context: TabBarContext): void {
    clearChildren(this.bar, (child) => child.destroy());
    this._buttons.clear();

    const modelsByProvider = new Map(context.models.map((model) => [model.provider, model]));
    const tabs = getAvailableTabs(context.enabledProviders);
    this.headerRow.visible = tabs.length > 0;

    for (const tab of tabs) {
      const isOverview = tab === "overview";
      const labelText = isOverview
        ? this.host.translate("Overview")
        : providerDisplayName(this.host.settings, tab);

      const content = new St.BoxLayout({
        style_class: "pl-tab-button-content",
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
      });

      if (!isOverview) {
        const healthDot = new St.Widget({
          style_class: "pl-health-dot",
          y_align: Clutter.ActorAlign.CENTER,
        });
        const tabModel = modelsByProvider.get(tab);
        applyHealthToneClass(healthDot, tabModel ? tabModel.facts.health.tone : "idle");
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
      if (tab === context.activeTab) button.add_style_class_name("pl-tab-button-active");
      button.accessible_name = labelText;
      bindActivation(button, () => this.host.selectTab(tab), {
        pointerSignals: ["clicked"],
        onOtherKey: (event) => this.host.handleArrowNavigation(event),
      });

      this.bar.add_child(button);
      this._buttons.set(tab, button);
    }
  }

  focusButton(tab: CockpitTab): void {
    this._buttons.get(tab)?.grab_key_focus?.();
  }
}

interface OverviewRowsContext {
  readonly models: readonly ProviderDisplayModel[];
  readonly enabledProviders: readonly ProviderName[];
  readonly displayNames: Readonly<Record<ProviderName, string>>;
}

/** Rebuilds the overview body rows and their mini bars from canonical models. */
class OverviewRowsRenderer {
  constructor(private readonly host: OverviewHost) {}

  render(context: OverviewRowsContext): void {
    const byProvider = new Map(context.models.map((model) => [model.provider, model]));
    for (const provider of context.enabledProviders) {
      const model = byProvider.get(provider);
      this._addRow(
        model
          ? buildOverviewRowModel(model)
          : loadingOverviewRow(provider, context.displayNames[provider]),
      );
    }
  }

  private _addRow(model: OverviewRowModel): void {
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
      style_class: `pl-badge ${BADGE_CLASS_BY_KIND[model.badgeKind]}`,
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

    if (model.secondaryText !== null) {
      const secondaryLabel = new St.Label({
        text: model.secondaryText,
        style_class: "provider-limits-dim pl-overview-secondary",
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
      });
      secondaryLabel.clutter_text.line_wrap = true;
      outer.add_child(secondaryLabel);
    }

    connectRepaint(barArea, drawMiniCapsule, model.meter);

    item.add_child(outer);
    this.host.shell.addBodyItem(item);
  }
}

/** Tab bar, overview rows and mini bars for the gauges panel style. */
export class OverviewRenderer {
  private readonly _host: OverviewHost;
  private readonly _tabHeaderRow: PopupMenu.PopupBaseMenuItem;
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

    const tabBar = new St.BoxLayout({ style_class: "pl-tab-bar", x_expand: true });
    this._tabHeaderRow.add_child(tabBar);
    host.shell.addHeaderItem(this._tabHeaderRow);

    this._tabRenderer = new TabBarRenderer(tabBar, this._tabHeaderRow, host);
    this._rowsRenderer = new OverviewRowsRenderer(host);
  }

  focusTabButton(tab: CockpitTab): void {
    this._tabRenderer.focusButton(tab);
  }

  syncTabHeader(
    enabledProviders: readonly ProviderName[],
    models: readonly ProviderDisplayModel[],
  ): void {
    this._tabRenderer.render({
      enabledProviders,
      models,
      activeTab: this._host.getActiveTab(),
    });
  }

  render(context: OverviewRowsContext): void {
    this._rowsRenderer.render(context);
  }
}
