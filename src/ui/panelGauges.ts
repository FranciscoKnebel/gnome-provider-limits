import Clutter from "gi://Clutter";
import type Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";
import { ensureActorVisibleInScrollView } from "resource:///org/gnome/shell/misc/animationUtils.js";
import { Spinner } from "resource:///org/gnome/shell/ui/animation.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import type { ProviderName } from "../constants.js";
import { formatAbsoluteTimestamp, formatTimestampTemplate } from "../formatters.js";
import { gettext as _ } from "../helpers/gettext.js";
import { resolveLocale } from "../helpers/locale.js";
import { normalizeProvidersOrder, providerDisplayName } from "../helpers/provider-settings.js";
import type { BaseReader, ReaderResult } from "../readers/base.js";
import { ReaderStatus } from "../readers/base.js";
import { PROVIDER_FIELDS } from "../readers/fields.js";
import {
  buildOverviewRowModel,
  cycleTab,
  disposeCairoContext,
  drawMiniCapsule,
  drawRadialGauge,
  getAvailableTabs,
  isCairoContext,
  partitionProviderPanel,
  providerDetailStructureKey,
  resolveActiveTab,
} from "./cockpitModel.js";
import type {
  BentoTileItem,
  CockpitTab,
  GaugeGeometry,
  MicroMeterSpec,
  OverviewBadgeKind,
  OverviewRowModel,
  PartitionedProviderPanel,
  RadialGaugeItem,
} from "./cockpitModel.js";
import { structureKey } from "./renderStructure.js";
import { applyToneClass } from "./tone.js";

const RADIAL_GAUGE_SIZE = 80;
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

interface GaugeCardWidgets {
  geometry: GaugeGeometry;
  drawingArea: St.DrawingArea;
  valueLabel: St.Label;
  titleLabel: St.Label;
  resetLabel: St.Label | null;
  errorLabel: St.Label | null;
  card: St.BoxLayout;
}

interface BentoTileWidgets {
  valueLabel: St.Label;
  errorLabel: St.Label | null;
  tile: St.BoxLayout;
}

interface DetailViewWidgets {
  calloutBadge: St.Label | null;
  calloutText: St.Label | null;
  gauges: GaugeCardWidgets[];
  bentoTiles: BentoTileWidgets[];
  lastUpdatedLabel: St.Label | null;
}

interface CalloutPlan {
  kind: "warning" | "error";
  badge: string;
  text: string;
}

export class GaugesPanelSection extends PopupMenu.PopupMenuSection {
  private _settings: Gio.Settings;
  private _readers: Map<ProviderName, BaseReader>;
  private _openPreferences: () => void;
  private _onRefresh?: () => void;
  private _running = false;
  private _activeTab: CockpitTab = "overview";
  private _enabledProviders: ProviderName[] = [];
  private _lastResults: Map<ProviderName, ReaderResult> = new Map();
  private _lastRefreshAt: number | null = null;

  private _tabHeaderRow: PopupMenu.PopupBaseMenuItem;
  private _tabBar: St.BoxLayout;
  private _tabButtons: TabButtonWidgets[] = [];
  private _tabStructureKey: string | null = null;

  private _body: PopupMenu.PopupMenuSection;
  private _scroll: St.ScrollView;
  private _structureKey: string | null = null;
  private _overviewRows: OverviewRowWidgets[] = [];
  private _detailWidgets: DetailViewWidgets | null = null;

  private _footerRow: PopupMenu.PopupBaseMenuItem;
  private _refreshRow: St.Button;
  private _refreshButtonLabel: St.Label;
  private _refreshSpinner: Spinner;
  private _lastRefreshLabel: St.Label;
  private _settingsItem: St.Button;
  private _settingsLabel: St.Label;

  constructor(
    settings: Gio.Settings,
    readers: Map<ProviderName, BaseReader>,
    openPreferences: () => void,
    onRefresh?: () => void,
  ) {
    super();
    this._settings = settings;
    this._readers = readers;
    this._openPreferences = openPreferences;
    this._onRefresh = onRefresh;
    this.box.add_style_class_name("pl-cockpit-panel");

    this._tabHeaderRow = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
      activate: false,
      hover: false,
    });
    this._tabHeaderRow.add_style_class_name("provider-limits-static-row");
    this._tabHeaderRow.add_style_class_name("pl-tab-header-row");
    this._tabHeaderRow.visible = false;

    this._tabBar = new St.BoxLayout({
      style_class: "pl-tab-bar",
      x_expand: true,
    });
    this._tabHeaderRow.add_child(this._tabBar);
    this.addMenuItem(this._tabHeaderRow);

    this._body = new PopupMenu.PopupMenuSection();
    this._body.actor.connect("key-press-event", (_actor: Clutter.Actor, event: Clutter.Event) =>
      this._handleArrowNavigation(event),
    );

    this._scroll = new St.ScrollView({
      overlay_scrollbars: true,
      x_expand: true,
      style_class: "pl-cockpit-scroll",
    });
    this._scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
    this.addMenuItem(this._body);
    this.box.remove_child(this._body.actor);

    const scroll = this._scroll as St.ScrollView & { add_actor?: (actor: Clutter.Actor) => void };
    if (typeof scroll.set_child === "function") scroll.set_child(this._body.actor);
    else scroll.add_actor?.(this._body.actor);
    this.box.add_child(this._scroll);

    this._scroll.connect("notify::mapped", () => {
      if (!this._scroll.mapped) return;
      const monitor = Main.layoutManager.findMonitorForActor(this.actor);
      if (!monitor) return;
      const area = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
      const scale = St.ThemeContext.get_for_stage(this.actor.get_stage()).scale_factor;
      this._scroll.style = `max-height: ${Math.max(1, Math.floor((area.height / scale) * 0.6))}px;`;
    });

    const footer = this._createFooter("en");
    this._footerRow = footer.footerRow;
    this._refreshRow = footer.refreshButton;
    this._refreshButtonLabel = footer.refreshLabel;
    this._refreshSpinner = footer.spinner;
    this._lastRefreshLabel = footer.lastRefreshLabel;
    this._settingsItem = footer.settingsButton;
    this._settingsLabel = footer.settingsLabel;
    this.addMenuItem(this._footerRow);
  }

  override destroy(): void {
    this._body.destroy();
    super.destroy();
  }

  get activeTab(): CockpitTab {
    return this._activeTab;
  }

  selectTab(tab: CockpitTab, focusTabButton = false): void {
    const resolved = resolveActiveTab(tab, this._enabledProviders);
    if (resolved === this._activeTab && !focusTabButton) return;
    this._activeTab = resolved;
    this.render(this._lastResults, this._lastRefreshAt);
    if (focusTabButton) {
      this._focusTabButton(resolved);
    }
  }

  render(results: Map<ProviderName, ReaderResult>, lastRefreshAt: number | null): void {
    this._lastResults = results;
    this._lastRefreshAt = lastRefreshAt;

    const order = normalizeProvidersOrder(this._settings.get_strv("providers-order"));
    const locale = resolveLocale(
      this._settings.get_string("language"),
      GLib.getenv("LC_MESSAGES"),
      GLib.getenv("LANG"),
    );

    const enabledProviders = order.filter((name) => {
      const result = results.get(name);
      if (result) return result.status !== ReaderStatus.DISABLED;
      return this._readers.has(name) || this._settings.get_boolean(`${name}-enabled`);
    });

    this._enabledProviders = enabledProviders;
    this._activeTab = resolveActiveTab(this._activeTab, enabledProviders);

    this._syncTabHeader(enabledProviders, results, locale);
    this._settingsLabel.text = _("Settings");
    this._settingsItem.accessible_name = _("Settings");
    this.setRunning(this._running);
    this.setLastRefreshAt(lastRefreshAt);

    if (enabledProviders.length === 0) {
      const emptyKey = structureKey([locale, "empty"]);
      if (emptyKey !== this._structureKey) {
        this._rebuildEmptyState(
          _("No providers enabled"),
          _("Enable a provider in Settings to monitor usage limits."),
        );
        this._structureKey = emptyKey;
      }
      return;
    }

    if (results.size === 0) {
      const loadingKey = structureKey([locale, "loading"]);
      if (loadingKey !== this._structureKey) {
        this._rebuildEmptyState(
          _("Reading provider limits…"),
          _("Waiting for initial refresh to complete."),
        );
        this._structureKey = loadingKey;
      }
      return;
    }

    if (this._activeTab === "overview") {
      this._renderOverview(enabledProviders, results, locale);
      return;
    }

    this._renderProviderDetail(this._activeTab, results.get(this._activeTab), locale);
  }

  setLastRefreshAt(lastRefreshAt: number | null): void {
    this._lastRefreshAt = lastRefreshAt;
    const locale = resolveLocale(
      this._settings.get_string("language"),
      GLib.getenv("LC_MESSAGES"),
      GLib.getenv("LANG"),
    );
    this._lastRefreshLabel.visible = lastRefreshAt !== null;
    this._lastRefreshLabel.text = formatTimestampTemplate(
      _("Last refresh: %s"),
      lastRefreshAt,
      locale,
    );
  }

  setRunning(running: boolean): void {
    this._running = running;
    this._refreshSpinner.visible = running;
    if (running) this._refreshSpinner.play();
    else this._refreshSpinner.stop();

    const text = running ? _("Refreshing…") : _("Force refresh");
    this._refreshButtonLabel.text = text;
    this._refreshButtonLabel.accessible_name = text;
    this._refreshRow.accessible_name = text;
    this._refreshRow.reactive = !running;
  }

  private _syncTabHeader(
    enabledProviders: readonly ProviderName[],
    results: Map<ProviderName, ReaderResult>,
    locale: string,
  ): void {
    if (enabledProviders.length === 0) {
      this._tabHeaderRow.visible = false;
      this._tabStructureKey = null;
      return;
    }

    this._tabHeaderRow.visible = true;
    const tabs = getAvailableTabs(enabledProviders);
    const nextTabKey = structureKey([
      locale,
      ...enabledProviders.map((name) => `${name}:${providerDisplayName(this._settings, name)}`),
    ]);

    if (nextTabKey !== this._tabStructureKey) {
      let child = this._tabBar.get_first_child?.() ?? null;
      while (child) {
        const next = child.get_next_sibling();
        child.destroy();
        child = next;
      }
      this._tabButtons = [];

      for (const tab of tabs) {
        const isOverview = tab === "overview";
        const labelText = isOverview ? _("Overview") : providerDisplayName(this._settings, tab);

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

        button.connect("clicked", () => {
          this.selectTab(tab);
        });
        button.connect("key-press-event", (_actor: Clutter.Actor, event: Clutter.Event) => {
          const symbol = event.get_key_symbol();
          if (
            symbol === Clutter.KEY_Return ||
            symbol === Clutter.KEY_KP_Enter ||
            symbol === Clutter.KEY_space
          ) {
            this.selectTab(tab);
            return Clutter.EVENT_STOP;
          }
          return this._handleArrowNavigation(event);
        });

        this._tabBar.add_child(button);
        this._tabButtons.push({ tab, button, label, healthDot });
      }

      this._tabStructureKey = nextTabKey;
    }

    for (const entry of this._tabButtons) {
      const isActive = entry.tab === this._activeTab;
      if (isActive) entry.button.add_style_class_name("pl-tab-button-active");
      else entry.button.remove_style_class_name("pl-tab-button-active");

      if (entry.tab !== "overview" && entry.healthDot) {
        for (const cls of HEALTH_CLASSES) {
          entry.healthDot.remove_style_class_name(cls);
        }
        entry.healthDot.add_style_class_name(healthClassFor(results.get(entry.tab)));
      }
    }
  }

  private _handleArrowNavigation(event: Clutter.Event): boolean {
    if (this._enabledProviders.length === 0) return Clutter.EVENT_PROPAGATE;
    const symbol = event.get_key_symbol();
    if (symbol === Clutter.KEY_Left || symbol === Clutter.KEY_KP_Left) {
      const prev = cycleTab(this._activeTab, this._enabledProviders, -1);
      this.selectTab(prev, true);
      return Clutter.EVENT_STOP;
    }
    if (symbol === Clutter.KEY_Right || symbol === Clutter.KEY_KP_Right) {
      const next = cycleTab(this._activeTab, this._enabledProviders, 1);
      this.selectTab(next, true);
      return Clutter.EVENT_STOP;
    }
    return Clutter.EVENT_PROPAGATE;
  }

  private _focusTabButton(tab: CockpitTab): void {
    const match = this._tabButtons.find((entry) => entry.tab === tab);
    match?.button.grab_key_focus?.();
  }

  private _resetBodyState(): void {
    this._body.removeAll();
    this._overviewRows = [];
    this._detailWidgets = null;
  }

  private _rebuildEmptyState(title: string, subtitle: string): void {
    this._resetBodyState();
    const row = this._addStaticRow();
    const box = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      style_class: "pl-empty-state",
    });

    const titleLabel = new St.Label({
      text: title,
      style_class: "pl-empty-title",
      x_align: Clutter.ActorAlign.CENTER,
      x_expand: true,
    });
    titleLabel.accessible_name = title;

    const subtitleLabel = new St.Label({
      text: subtitle,
      style_class: "provider-limits-dim pl-empty-subtitle",
      x_align: Clutter.ActorAlign.CENTER,
      x_expand: true,
    });
    subtitleLabel.clutter_text.line_wrap = true;
    subtitleLabel.accessible_name = subtitle;

    box.add_child(titleLabel);
    box.add_child(subtitleLabel);
    row.add_child(box);
    this._body.addMenuItem(row);
  }

  private _renderOverview(
    enabledProviders: readonly ProviderName[],
    results: Map<ProviderName, ReaderResult>,
    locale: string,
  ): void {
    const models = enabledProviders.map((provider) => {
      const reader = this._readers.get(provider);
      const fieldsDefs = reader?.FIELDS ?? PROVIDER_FIELDS[provider];
      return buildOverviewRowModel({
        provider,
        displayName: providerDisplayName(this._settings, provider),
        fieldsDefs,
        result: results.get(provider),
        statusFieldNames: this._settings.get_strv(`${provider}-status-fields`),
        panelFieldNames: this._settings.get_strv(`${provider}-panel-fields`),
        locale,
        t: _,
      });
    });

    const nextKey = structureKey([
      locale,
      "overview",
      ...models.map((m) => `${m.provider}:${m.secondaryText === null ? "0" : "1"}`),
    ]);

    if (nextKey !== this._structureKey) {
      this._rebuildOverview(models);
      this._structureKey = nextKey;
      return;
    }

    this._updateOverview(models);
  }

  private _rebuildOverview(models: readonly OverviewRowModel[]): void {
    this._resetBodyState();

    for (const model of models) {
      const item = new PopupMenu.PopupBaseMenuItem({
        reactive: true,
        can_focus: true,
        activate: false,
        hover: true,
      });
      item.add_style_class_name("pl-overview-row");
      item.accessible_name = model.accessibleText;
      item.connect("key-focus-in", () => ensureActorVisibleInScrollView(this._scroll, item));
      item.connect("button-release-event", () => {
        this.selectTab(model.provider, true);
        return Clutter.EVENT_STOP;
      });
      item.connect("key-press-event", (_actor: Clutter.Actor, event: Clutter.Event) => {
        const symbol = event.get_key_symbol();
        if (
          symbol === Clutter.KEY_Return ||
          symbol === Clutter.KEY_KP_Enter ||
          symbol === Clutter.KEY_space
        ) {
          this.selectTab(model.provider, true);
          return Clutter.EVENT_STOP;
        }
        return this._handleArrowNavigation(event);
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
      this._body.addMenuItem(item);
      this._overviewRows.push(rowWidgets);
      barArea.queue_repaint();
    }
  }

  private _updateOverview(models: readonly OverviewRowModel[]): void {
    models.forEach((model, idx) => {
      const widgets = this._overviewRows[idx];
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

  private _renderProviderDetail(
    provider: ProviderName,
    result: ReaderResult | undefined,
    locale: string,
  ): void {
    if (!result) {
      const loadingKey = structureKey([locale, "detail-loading", provider]);
      if (loadingKey !== this._structureKey) {
        this._rebuildEmptyState(
          _("Reading provider limits…"),
          _("Waiting for initial refresh to complete."),
        );
        this._structureKey = loadingKey;
      }
      return;
    }

    const displayName = providerDisplayName(this._settings, provider);
    const reader = this._readers.get(provider);
    const fieldsDefs = reader?.FIELDS ?? PROVIDER_FIELDS[provider];
    const isError =
      result.status === ReaderStatus.ERROR || result.status === ReaderStatus.UNAVAILABLE;

    let callout: CalloutPlan | null = null;
    if (isError) {
      callout = {
        kind: "error",
        badge: _("Error"),
        text: result.lastError ?? _("Error"),
      };
    } else if (result.status === ReaderStatus.PARTIAL && result.lastError) {
      callout = {
        kind: "warning",
        badge: result.pathsTried?.includes("last-known-good") ? _("Cached") : _("Partial"),
        text: result.lastError,
      };
    }

    const partition: PartitionedProviderPanel = isError
      ? { gauges: [], gaugeRows: [], bentoTiles: [], bentoRows: [] }
      : partitionProviderPanel(
          fieldsDefs,
          result,
          this._settings.get_strv(`${provider}-panel-fields`),
          locale,
          _,
        );

    const lastUpdatedText =
      !isError && Number.isFinite(result.lastUpdated)
        ? formatAbsoluteTimestamp(result.lastUpdated, locale)
        : null;

    const nextKey = providerDetailStructureKey({
      provider,
      displayName,
      status: result.status,
      locale,
      hasCallout: callout !== null,
      hasTimestamp: lastUpdatedText !== null,
      partition,
    });

    if (nextKey !== this._structureKey) {
      this._rebuildProviderDetail(callout, isError, partition, lastUpdatedText);
      this._structureKey = nextKey;
      return;
    }

    this._updateProviderDetail(callout, partition, lastUpdatedText);
  }

  private _rebuildProviderDetail(
    callout: CalloutPlan | null,
    isError: boolean,
    partition: PartitionedProviderPanel,
    lastUpdatedText: string | null,
  ): void {
    this._resetBodyState();

    let calloutBadge: St.Label | null = null;
    let calloutText: St.Label | null = null;

    if (callout !== null) {
      const row = this._addStaticRow();
      const box = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        style_class:
          callout.kind === "error"
            ? "pl-callout pl-callout-error"
            : "pl-callout pl-callout-warning",
      });

      calloutBadge = new St.Label({
        text: callout.badge,
        style_class:
          callout.kind === "error" ? "pl-badge pl-badge-error" : "pl-badge pl-badge-cached",
        x_align: Clutter.ActorAlign.START,
      });

      calloutText = new St.Label({
        text: callout.text,
        style_class: callout.kind === "error" ? "provider-limits-error" : "provider-limits-dim",
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
      });
      calloutText.clutter_text.line_wrap = true;
      calloutText.accessible_name = `${callout.badge}: ${callout.text}`;

      box.add_child(calloutBadge);
      box.add_child(calloutText);
      row.add_child(box);
      this._body.addMenuItem(row);
    }

    const gauges: GaugeCardWidgets[] = [];
    const bentoTiles: BentoTileWidgets[] = [];

    if (!isError) {
      for (const gaugeRow of partition.gaugeRows) {
        const row = this._addStaticRow();
        row.add_style_class_name("pl-gauge-row-item");
        const rowBox = new St.BoxLayout({
          style_class: "pl-gauge-row",
          x_expand: true,
        });

        for (const gauge of gaugeRow) {
          const cardWidgets = this._buildGaugeCard(gauge);
          rowBox.add_child(cardWidgets.card);
          gauges.push(cardWidgets);
        }

        row.add_child(rowBox);
        this._body.addMenuItem(row);
      }

      for (const bentoRow of partition.bentoRows) {
        const row = this._addStaticRow();
        row.add_style_class_name("pl-bento-row-item");
        const rowBox = new St.BoxLayout({
          style_class: "pl-bento-row",
          x_expand: true,
        });

        for (const tile of bentoRow) {
          const tileWidgets = this._buildBentoTile(tile);
          rowBox.add_child(tileWidgets.tile);
          bentoTiles.push(tileWidgets);
        }

        row.add_child(rowBox);
        this._body.addMenuItem(row);
      }

      if (partition.gauges.length === 0 && partition.bentoTiles.length === 0) {
        const emptyRow = this._addStaticRow();
        const emptyLabel = new St.Label({
          text: _("No panel fields configured for this provider."),
          style_class: "provider-limits-dim pl-empty-fields",
          x_expand: true,
          x_align: Clutter.ActorAlign.CENTER,
        });
        emptyLabel.clutter_text.line_wrap = true;
        emptyRow.add_child(emptyLabel);
        this._body.addMenuItem(emptyRow);
      }
    }

    let lastUpdatedLabel: St.Label | null = null;
    if (lastUpdatedText !== null) {
      const row = this._addStaticRow();
      const text = _("Last updated: %s").replace("%s", lastUpdatedText);
      lastUpdatedLabel = new St.Label({
        text,
        style_class: "provider-limits-dim pl-provider-updated",
        x_expand: true,
        x_align: Clutter.ActorAlign.END,
      });
      lastUpdatedLabel.accessible_name = text;
      row.add_child(lastUpdatedLabel);
      this._body.addMenuItem(row);
    }

    this._detailWidgets = {
      calloutBadge,
      calloutText,
      gauges,
      bentoTiles,
      lastUpdatedLabel,
    };
  }

  private _buildGaugeCard(gauge: RadialGaugeItem): GaugeCardWidgets {
    const card = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      style_class: "pl-gauge-card",
    });
    card.accessible_name = gauge.accessibleText;

    const ringOverlay = new St.Widget({
      layout_manager: new Clutter.BinLayout(),
      x_align: Clutter.ActorAlign.CENTER,
      style_class: "pl-gauge-ring-wrap",
    });

    const drawingArea = new St.DrawingArea({
      style_class: "pl-radial-gauge",
      width: RADIAL_GAUGE_SIZE,
      height: RADIAL_GAUGE_SIZE,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });

    const valueLabel = new St.Label({
      text: gauge.geometry.centerText,
      style_class: "pl-gauge-center-value",
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
      x_expand: true,
      y_expand: true,
    });
    applyToneClass(valueLabel, gauge.geometry.fieldTone);

    ringOverlay.add_child(drawingArea);
    ringOverlay.add_child(valueLabel);

    const titleLabel = new St.Label({
      text: gauge.translatedLabel,
      style_class: "pl-gauge-label",
      x_align: Clutter.ActorAlign.CENTER,
      x_expand: true,
    });
    titleLabel.clutter_text.line_wrap = true;

    card.add_child(ringOverlay);
    card.add_child(titleLabel);

    let resetLabel: St.Label | null = null;
    if (gauge.hasResetSlot && gauge.resetText !== null) {
      resetLabel = new St.Label({
        text: gauge.resetText,
        style_class: "provider-limits-dim pl-gauge-reset",
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
      });
      card.add_child(resetLabel);
    }

    let errorLabel: St.Label | null = null;
    if (gauge.errorText) {
      errorLabel = new St.Label({
        text: gauge.errorText,
        style_class: "provider-limits-error pl-gauge-error",
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
      });
      errorLabel.clutter_text.line_wrap = true;
      card.add_child(errorLabel);
    }

    const widgets: GaugeCardWidgets = {
      geometry: gauge.geometry,
      drawingArea,
      valueLabel,
      titleLabel,
      resetLabel,
      errorLabel,
      card,
    };

    drawingArea.connect("repaint", (area: St.DrawingArea) => {
      const rawCr: unknown = area.get_context();
      try {
        if (isCairoContext(rawCr)) {
          const [w, h] = area.get_surface_size();
          drawRadialGauge(rawCr, w, h, widgets.geometry);
        }
      } finally {
        disposeCairoContext(rawCr);
      }
    });
    drawingArea.queue_repaint();

    return widgets;
  }

  private _buildBentoTile(tileData: BentoTileItem): BentoTileWidgets {
    const tile = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      style_class: "pl-bento-tile",
    });
    tile.accessible_name = tileData.accessibleText;

    const caption = new St.Label({
      text: tileData.translatedLabel,
      style_class: "provider-limits-dim pl-bento-label",
      x_align: Clutter.ActorAlign.START,
      x_expand: true,
    });
    caption.clutter_text.line_wrap = true;

    const valueLabel = new St.Label({
      text: tileData.valueText,
      style_class: "pl-bento-value",
      x_align: Clutter.ActorAlign.START,
      x_expand: true,
    });
    valueLabel.clutter_text.line_wrap = true;

    tile.add_child(caption);
    tile.add_child(valueLabel);

    let errorLabel: St.Label | null = null;
    if (tileData.errorText) {
      errorLabel = new St.Label({
        text: tileData.errorText,
        style_class: "provider-limits-error pl-bento-error",
        x_align: Clutter.ActorAlign.START,
        x_expand: true,
      });
      errorLabel.clutter_text.line_wrap = true;
      tile.add_child(errorLabel);
    }

    return { valueLabel, errorLabel, tile };
  }

  private _updateProviderDetail(
    callout: CalloutPlan | null,
    partition: PartitionedProviderPanel,
    lastUpdatedText: string | null,
  ): void {
    const widgets = this._detailWidgets;
    if (!widgets) return;

    if (callout !== null && widgets.calloutBadge && widgets.calloutText) {
      widgets.calloutBadge.text = callout.badge;
      widgets.calloutText.text = callout.text;
      widgets.calloutText.accessible_name = `${callout.badge}: ${callout.text}`;
    }

    partition.gauges.forEach((gauge, idx) => {
      const cardWidgets = widgets.gauges[idx];
      if (!cardWidgets) return;
      cardWidgets.geometry = gauge.geometry;
      cardWidgets.drawingArea.queue_repaint();
      cardWidgets.valueLabel.text = gauge.geometry.centerText;
      applyToneClass(cardWidgets.valueLabel, gauge.geometry.fieldTone);
      cardWidgets.titleLabel.text = gauge.translatedLabel;
      cardWidgets.card.accessible_name = gauge.accessibleText;
      if (cardWidgets.resetLabel && gauge.resetText !== null) {
        cardWidgets.resetLabel.text = gauge.resetText;
      }
      if (cardWidgets.errorLabel && gauge.errorText) {
        cardWidgets.errorLabel.text = gauge.errorText;
      }
    });

    partition.bentoTiles.forEach((tileData, idx) => {
      const tileWidgets = widgets.bentoTiles[idx];
      if (!tileWidgets) return;
      tileWidgets.valueLabel.text = tileData.valueText;
      tileWidgets.tile.accessible_name = tileData.accessibleText;
      if (tileWidgets.errorLabel && tileData.errorText) {
        tileWidgets.errorLabel.text = tileData.errorText;
      }
    });

    if (widgets.lastUpdatedLabel && lastUpdatedText !== null) {
      const text = _("Last updated: %s").replace("%s", lastUpdatedText);
      widgets.lastUpdatedLabel.text = text;
      widgets.lastUpdatedLabel.accessible_name = text;
    }
  }

  private _addStaticRow(): PopupMenu.PopupBaseMenuItem {
    const row = new PopupMenu.PopupBaseMenuItem({
      reactive: true,
      can_focus: true,
      activate: false,
      hover: false,
    });
    row.add_style_class_name("provider-limits-static-row");
    row.connect("key-focus-in", () => ensureActorVisibleInScrollView(this._scroll, row));
    return row;
  }

  private _createFooter(locale: string): {
    footerRow: PopupMenu.PopupBaseMenuItem;
    refreshButton: St.Button;
    refreshLabel: St.Label;
    spinner: Spinner;
    lastRefreshLabel: St.Label;
    settingsButton: St.Button;
    settingsLabel: St.Label;
  } {
    const footerRow = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
      activate: false,
      hover: false,
    });
    footerRow.add_style_class_name("provider-limits-static-row");
    footerRow.add_style_class_name("pl-footer-row");

    const toolbar = new St.BoxLayout({
      style_class: "pl-footer-toolbar",
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });

    const refreshContent = new St.BoxLayout({
      style_class: "pl-footer-button-box",
      y_align: Clutter.ActorAlign.CENTER,
    });

    const spinner = new Spinner(14, { animate: true, hideOnStop: true });
    spinner.add_style_class_name("provider-limits-refresh-spinner");
    spinner.visible = this._running;
    if (this._running) spinner.play();

    const refreshLabel = new St.Label({
      text: this._running ? _("Refreshing…") : _("Force refresh"),
      y_align: Clutter.ActorAlign.CENTER,
    });
    refreshLabel.accessible_name = refreshLabel.text;

    refreshContent.add_child(spinner);
    refreshContent.add_child(refreshLabel);

    const refreshButton = new St.Button({
      style_class: "pl-footer-button pl-refresh-button",
      reactive: !this._running,
      can_focus: true,
      track_hover: true,
      child: refreshContent,
    });
    refreshButton.accessible_name = refreshLabel.text;
    refreshButton.connect("clicked", () => {
      if (!this._running) this._onRefresh?.();
    });
    refreshButton.connect("key-press-event", (_actor: Clutter.Actor, event: Clutter.Event) => {
      const symbol = event.get_key_symbol();
      if (
        symbol === Clutter.KEY_Return ||
        symbol === Clutter.KEY_KP_Enter ||
        symbol === Clutter.KEY_space
      ) {
        if (!this._running) this._onRefresh?.();
        return Clutter.EVENT_STOP;
      }
      return this._handleArrowNavigation(event);
    });

    const lastRefreshLabel = new St.Label({
      text: formatTimestampTemplate(_("Last refresh: %s"), null, locale),
      style_class: "provider-limits-dim pl-footer-timestamp",
      x_expand: true,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });
    lastRefreshLabel.visible = false;

    const settingsLabel = new St.Label({
      text: _("Settings"),
      y_align: Clutter.ActorAlign.CENTER,
    });

    const settingsButton = new St.Button({
      style_class: "pl-footer-button pl-settings-button",
      reactive: true,
      can_focus: true,
      track_hover: true,
      child: settingsLabel,
    });
    settingsButton.accessible_name = _("Settings");
    settingsButton.connect("clicked", () => {
      this._closeTopMenuAndOpenPreferences();
    });
    settingsButton.connect("key-press-event", (_actor: Clutter.Actor, event: Clutter.Event) => {
      const symbol = event.get_key_symbol();
      if (
        symbol === Clutter.KEY_Return ||
        symbol === Clutter.KEY_KP_Enter ||
        symbol === Clutter.KEY_space
      ) {
        this._closeTopMenuAndOpenPreferences();
        return Clutter.EVENT_STOP;
      }
      return this._handleArrowNavigation(event);
    });

    toolbar.add_child(refreshButton);
    toolbar.add_child(lastRefreshLabel);
    toolbar.add_child(settingsButton);
    footerRow.add_child(toolbar);

    return {
      footerRow,
      refreshButton,
      refreshLabel,
      spinner,
      lastRefreshLabel,
      settingsButton,
      settingsLabel,
    };
  }

  private _closeTopMenuAndOpenPreferences(): void {
    closeTopMenuOf(this);
    this._openPreferences();
  }
}

function closeTopMenuOf(section: unknown): void {
  if (
    typeof section === "object" &&
    section !== null &&
    "_getTopMenu" in section &&
    typeof section._getTopMenu === "function"
  ) {
    const topMenu: unknown = section._getTopMenu();
    if (
      typeof topMenu === "object" &&
      topMenu !== null &&
      "close" in topMenu &&
      typeof topMenu.close === "function"
    ) {
      topMenu.close(true);
    }
  }
}
