import Clutter from "gi://Clutter";
import type Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";

import type { ProviderName } from "../constants.js";
import { gettext as _ } from "../helpers/gettext.js";
import { resolveLocale } from "../helpers/locale.js";
import { normalizeProvidersOrder } from "../helpers/provider-settings.js";
import type { BaseReader, FieldDef, ReaderResult } from "../readers/base.js";
import { ReaderStatus } from "../readers/base.js";
import { cycleTab, resolveActiveTab } from "./cockpitModel.js";
import type { CockpitTab } from "./cockpitModel.js";
import type { DetailHost } from "./panelGaugesDetail.js";
import { DetailRenderer } from "./panelGaugesDetail.js";
import type { OverviewHost } from "./panelGaugesOverview.js";
import { OverviewRenderer } from "./panelGaugesOverview.js";
import type { PanelShell, PanelStyleSection } from "./panelShell.js";
import { structureKey } from "./renderStructure.js";

type BodyMode = "none" | "empty" | "overview" | "detail";

/** Thin coordinator: owns tab state and delegates rendering to focused renderers. */
export class GaugesPanelSection implements PanelStyleSection {
  private readonly _settings: Gio.Settings;
  private readonly _readers: Map<ProviderName, BaseReader>;
  private readonly _overview: OverviewRenderer;
  private readonly _detail: DetailRenderer;
  private _running = false;
  private _activeTab: CockpitTab = "overview";
  private _enabledProviders: ProviderName[] = [];
  private _lastResults: Map<ProviderName, ReaderResult> = new Map();
  private _lastRefreshAt: number | null = null;
  private _bodyMode: BodyMode = "none";
  private _emptyKey: string | null = null;
  readonly shell: PanelShell;

  constructor(
    settings: Gio.Settings,
    readers: Map<ProviderName, BaseReader>,
    fieldDefs: Readonly<Record<ProviderName, readonly FieldDef[]>>,
    shell: PanelShell,
  ) {
    this._settings = settings;
    this._readers = readers;
    this.shell = shell;

    const host: OverviewHost & DetailHost = {
      settings,
      fieldDefs,
      shell,
      translate: _,
      selectTab: (tab, focusTabButton) => this.selectTab(tab, focusTabButton),
      handleArrowNavigation: (event) => this._handleArrowNavigation(event),
      getActiveTab: () => this._activeTab,
      getEnabledProviders: () => this._enabledProviders,
    };
    this._overview = new OverviewRenderer(host);
    this._detail = new DetailRenderer(host);
    this.shell.setBodyKeyHandler((event) => this._handleArrowNavigation(event));
    this.shell.setFooterKeyHandler((event) => this._handleArrowNavigation(event));
  }

  destroy(): void {
    this.shell.destroy();
  }

  get activeTab(): CockpitTab {
    return this._activeTab;
  }

  selectTab(tab: CockpitTab, focusTabButton = false): void {
    const resolved = resolveActiveTab(tab, this._enabledProviders);
    if (resolved === this._activeTab && !focusTabButton) return;
    this._activeTab = resolved;
    this.render(this._lastResults, this._lastRefreshAt);
    if (focusTabButton) this._overview.focusTabButton(resolved);
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

    this._overview.syncTabHeader(enabledProviders, results, locale);
    this.shell.setRunning(this._running);
    this.shell.setLastRefreshAt(lastRefreshAt);

    if (enabledProviders.length === 0) {
      this._renderEmpty(
        locale,
        "empty",
        _("No providers enabled"),
        _("Enable a provider in Settings to monitor usage limits."),
      );
      return;
    }

    if (results.size === 0) {
      this._renderEmpty(
        locale,
        "loading",
        _("Reading provider limits…"),
        _("Waiting for initial refresh to complete."),
      );
      return;
    }

    if (this._activeTab === "overview") {
      this._enterMode("overview");
      this._overview.render(enabledProviders, results, locale);
      return;
    }

    const result = results.get(this._activeTab);
    if (!result) {
      this._renderEmpty(
        locale,
        "detail-loading",
        _("Reading provider limits…"),
        _("Waiting for initial refresh to complete."),
      );
      return;
    }

    this._enterMode("detail");
    this._detail.render(this._activeTab, result, locale);
  }

  setRunning(running: boolean): void {
    this._running = running;
    this.shell.setRunning(running);
  }

  private _enterMode(mode: "overview" | "detail"): void {
    if (this._bodyMode === mode) return;
    this._overview.reset();
    this._detail.reset();
    this._bodyMode = mode;
  }

  private _renderEmpty(locale: string, kind: string, title: string, subtitle: string): void {
    const key = structureKey([locale, kind, kind === "detail-loading" ? this._activeTab : ""]);
    if (this._bodyMode !== "empty" || key !== this._emptyKey) {
      this.shell.clearBody();
      this._overview.reset();
      this._detail.reset();
      const row = this.shell.addStaticRow();
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
      this.shell.addBodyItem(row);
      this._emptyKey = key;
    }
    this._bodyMode = "empty";
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
}
