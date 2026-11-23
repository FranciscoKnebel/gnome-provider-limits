import Clutter from "gi://Clutter";
import type Gio from "gi://Gio";
import GLib from "gi://GLib";

import type { ProviderName } from "../constants.js";
import { gettext as _ } from "../helpers/gettext.js";
import { resolveLocale } from "../helpers/locale.js";
import type { ReaderResult } from "../readers/base.js";
import { cycleTab, resolveActiveTab } from "./cockpitModel.js";
import type { CockpitTab } from "./cockpitModel.js";
import type { DetailHost } from "./panelGaugesDetail.js";
import { DetailRenderer } from "./panelGaugesDetail.js";
import type { OverviewHost } from "./panelGaugesOverview.js";
import { OverviewRenderer } from "./panelGaugesOverview.js";
import type { PanelRenderContext, PanelShell, PanelStyleSection } from "./panelShell.js";
import { emptyViewContext, type ViewPhase } from "./viewContext.js";
import { viewMessages } from "./viewMessages.js";

type BodyState =
  | { kind: "empty"; phase: ViewPhase }
  | { kind: "overview" }
  | { kind: "detail"; provider: ProviderName };

/** Thin coordinator: owns tab state and delegates rendering to focused renderers. */
export class GaugesPanelSection implements PanelStyleSection {
  private readonly _overview: OverviewRenderer;
  private readonly _detail: DetailRenderer;
  private _activeTab: CockpitTab = "overview";
  private _enabledProviders: ProviderName[] = [];
  private _lastContext: PanelRenderContext;
  readonly shell: PanelShell;

  constructor(settings: Gio.Settings, shell: PanelShell) {
    this.shell = shell;
    this._lastContext = {
      lastRefreshAt: null,
      view: emptyViewContext(
        resolveLocale(
          settings.get_string("language"),
          GLib.getenv("LC_MESSAGES"),
          GLib.getenv("LANG"),
        ),
        _,
      ),
    };

    const host: OverviewHost & DetailHost = {
      settings,
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
    const results = context.view.results;
    const locale = context.view.locale;
    const enabledProviders = [...context.view.activeProviders];

    this._enabledProviders = enabledProviders;
    this._activeTab = resolveActiveTab(this._activeTab, enabledProviders);
    this._overview.syncTabHeader(enabledProviders, context.view.models);

    this.shell.clearBody();
    const nextState = this._resolveBodyState(context.view.phase, results);

    if (nextState.kind === "empty") {
      const message = viewMessages({
        phase: nextState.phase,
        surface: "gauges",
        running: false,
        t: context.view.t,
      });
      this.shell.addEmptyStateRow(message.title, message.subtitle);
      return;
    }

    if (nextState.kind === "overview") {
      this._overview.render({
        models: context.view.models,
        enabledProviders,
        displayNames: context.view.displayNames,
      });
      return;
    }

    const model = context.view.models.find(
      (candidate) => candidate.provider === nextState.provider,
    );
    if (model) this._detail.render({ model, locale });
  }

  setRunning(running: boolean): void {
    this.shell.setRunning(running);
  }

  private _resolveBodyState(
    phase: ViewPhase,
    results: ReadonlyMap<ProviderName, ReaderResult>,
  ): BodyState {
    if (phase === "empty" || phase === "loading") return { kind: "empty", phase };

    if (this._activeTab === "overview") return { kind: "overview" };

    const result = results.get(this._activeTab);
    if (!result) return { kind: "empty", phase: "loading" };

    return { kind: "detail", provider: this._activeTab };
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
