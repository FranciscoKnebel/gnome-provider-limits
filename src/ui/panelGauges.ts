import Clutter from "gi://Clutter";
import type Gio from "gi://Gio";
import GLib from "gi://GLib";

import type { ProviderName } from "../constants.js";
import { gettext as _ } from "../helpers/gettext.js";
import { resolveLocale } from "../helpers/locale.js";
import { readProviderViewSettings } from "../helpers/provider-settings.js";
import type { BaseReader, FieldDef, ReaderResult } from "../readers/base.js";
import { cycleTab, resolveActiveTab } from "./cockpitModel.js";
import type { CockpitTab } from "./cockpitModel.js";
import type { DetailHost } from "./panelGaugesDetail.js";
import { DetailRenderer } from "./panelGaugesDetail.js";
import type { OverviewHost } from "./panelGaugesOverview.js";
import { OverviewRenderer } from "./panelGaugesOverview.js";
import type { PanelRenderContext, PanelShell, PanelStyleSection } from "./panelShell.js";
import { structureKey } from "./renderStructure.js";

type BodyState =
  | { kind: "none" }
  | { kind: "empty"; reason: "no-providers" | "initial-load" | "detail-load"; tab?: ProviderName }
  | { kind: "overview" }
  | { kind: "detail"; provider: ProviderName };

type EmptyState = Extract<BodyState, { kind: "empty" }>;

function bodyStructureKey(state: BodyState, locale: string): string {
  switch (state.kind) {
    case "none":
      return structureKey([locale, "none"]);
    case "empty":
      return structureKey([locale, state.reason, state.tab ?? ""]);
    case "overview":
      return structureKey([locale, "overview"]);
    case "detail":
      return structureKey([locale, "detail", state.provider]);
  }
}

function emptyStateText(state: EmptyState): { title: string; subtitle: string } {
  switch (state.reason) {
    case "no-providers":
      return {
        title: _("No providers enabled"),
        subtitle: _("Enable a provider in Settings to monitor usage limits."),
      };
    case "initial-load":
    case "detail-load":
      return {
        title: _("Reading provider limits…"),
        subtitle: _("Waiting for initial refresh to complete."),
      };
  }
}

/** Thin coordinator: owns tab state and delegates rendering to focused renderers. */
export class GaugesPanelSection implements PanelStyleSection {
  private readonly _settings: Gio.Settings;
  private readonly _overview: OverviewRenderer;
  private readonly _detail: DetailRenderer;
  private _running = false;
  private _activeTab: CockpitTab = "overview";
  private _enabledProviders: ProviderName[] = [];
  private _lastContext: PanelRenderContext;
  private _state: BodyState = { kind: "none" };
  readonly shell: PanelShell;

  constructor(
    settings: Gio.Settings,
    _readers: Map<ProviderName, BaseReader>,
    fieldDefs: Readonly<Record<ProviderName, readonly FieldDef[]>>,
    shell: PanelShell,
  ) {
    this._settings = settings;
    this.shell = shell;
    this._lastContext = {
      results: new Map(),
      lastRefreshAt: null,
      view: readProviderViewSettings(settings, new Map(), new Map(), fieldDefs),
    };

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
    this.render(this._lastContext);
    if (focusTabButton) this._overview.focusTabButton(resolved);
  }

  render(context: PanelRenderContext): void {
    this._lastContext = context;
    const results = context.results;

    const locale = resolveLocale(
      this._settings.get_string("language"),
      GLib.getenv("LC_MESSAGES"),
      GLib.getenv("LANG"),
    );

    const enabledProviders = [...context.view.activeProviders];

    this._enabledProviders = enabledProviders;
    this._activeTab = resolveActiveTab(this._activeTab, enabledProviders);

    this._overview.syncTabHeader(enabledProviders, results, locale);
    this.shell.setRunning(this._running);
    this.shell.setLastRefreshAt(context.lastRefreshAt);

    const nextState = this._resolveBodyState(enabledProviders, results);
    this._transitionBody(locale, nextState);

    if (nextState.kind === "overview") {
      this._overview.render({ enabledProviders, results, locale });
      return;
    }

    if (nextState.kind === "detail") {
      const result = results.get(nextState.provider);
      if (result) this._detail.render({ provider: nextState.provider, result, locale });
    }
  }

  setRunning(running: boolean): void {
    this._running = running;
    this.shell.setRunning(running);
  }

  private _resolveBodyState(
    enabledProviders: ProviderName[],
    results: Map<ProviderName, ReaderResult>,
  ): BodyState {
    if (enabledProviders.length === 0) {
      return { kind: "empty", reason: "no-providers" };
    }

    if (results.size === 0) {
      return { kind: "empty", reason: "initial-load" };
    }

    if (this._activeTab === "overview") {
      return { kind: "overview" };
    }

    const result = results.get(this._activeTab);
    if (!result) {
      return { kind: "empty", reason: "detail-load", tab: this._activeTab };
    }

    return { kind: "detail", provider: this._activeTab };
  }

  private _transitionBody(locale: string, nextState: BodyState): void {
    const previousKey = bodyStructureKey(this._state, locale);
    const nextKey = bodyStructureKey(nextState, locale);
    const rebuild = previousKey !== nextKey;
    this._state = nextState;

    if (nextState.kind === "empty") {
      if (rebuild) {
        this.shell.clearBody();
        this._overview.reset();
        this._detail.reset();
        const { title, subtitle } = emptyStateText(nextState);
        this.shell.addEmptyStateRow(title, subtitle);
      }
      return;
    }

    if (rebuild) {
      this._overview.reset();
      this._detail.reset();
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
}
