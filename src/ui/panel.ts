import type Gio from "gi://Gio";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import type { ProviderName } from "../constants.js";
import type { BaseReader, ReaderResult } from "../readers/base.js";
import { CardsPanelSection } from "./panelCards.js";
import { CompactPanelSection } from "./panelCompact.js";
import { GaugesPanelSection } from "./panelGauges.js";

export type PanelStyle = "gauges" | "cards" | "compact";

export interface PanelStyleSection extends PopupMenu.PopupMenuSection {
  render(results: Map<ProviderName, ReaderResult>, lastRefreshAt: number | null): void;
  setRunning(running: boolean): void;
  destroy(): void;
}

export class PanelWidget extends PopupMenu.PopupMenuSection {
  private _settings: Gio.Settings;
  private _readers: Map<ProviderName, BaseReader>;
  private _openPreferences: () => void;
  private _onRefresh?: () => void;
  private _styleChangedId: number | null = null;
  private _currentStyle: PanelStyle | null = null;
  private _currentSection: PanelStyleSection | null = null;
  private _lastResults: Map<ProviderName, ReaderResult> = new Map();
  private _lastRefreshAt: number | null = null;
  private _running = false;

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

    this._ensureSection();

    if (typeof this._settings.connect === "function") {
      this._styleChangedId = this._settings.connect("changed::panel-style", () => {
        this._switchSection();
      });
    }
  }

  private _resolveStyle(): PanelStyle {
    if (typeof this._settings.get_string === "function") {
      const styleSetting = this._settings.get_string("panel-style");
      if (styleSetting === "cards" || styleSetting === "compact" || styleSetting === "gauges") {
        return styleSetting;
      }
    }
    return "gauges";
  }

  private _ensureSection(): PanelStyleSection {
    const style = this._resolveStyle();
    if (this._currentSection && this._currentStyle === style) {
      return this._currentSection;
    }
    return this._switchSection();
  }

  private _switchSection(): PanelStyleSection {
    const newStyle = this._resolveStyle();
    if (this._currentSection) {
      if (typeof this.box?.remove_child === "function" && this._currentSection.actor) {
        this.box.remove_child(this._currentSection.actor);
      }
      this._currentSection.destroy();
      this._currentSection = null;
    }

    this._currentStyle = newStyle;

    let section: PanelStyleSection;
    if (newStyle === "cards") {
      section = new CardsPanelSection(
        this._settings,
        this._readers,
        this._openPreferences,
        this._onRefresh,
      );
    } else if (newStyle === "compact") {
      section = new CompactPanelSection(
        this._settings,
        this._readers,
        this._openPreferences,
        this._onRefresh,
      );
    } else {
      section = new GaugesPanelSection(
        this._settings,
        this._readers,
        this._openPreferences,
        this._onRefresh,
      );
    }

    this._currentSection = section;
    this.addMenuItem(section);
    section.setRunning(this._running);
    if (this._lastResults.size > 0) {
      section.render(this._lastResults, this._lastRefreshAt);
    }
    return section;
  }

  render(results: Map<ProviderName, ReaderResult>, lastRefreshAt: number | null): void {
    this._lastResults = results;
    this._lastRefreshAt = lastRefreshAt;
    const section = this._ensureSection();
    section.render(results, lastRefreshAt);
  }

  update(results: Map<ProviderName, ReaderResult>): void {
    this.render(results, this._lastRefreshAt);
  }

  setRunning(running: boolean): void {
    this._running = running;
    this._currentSection?.setRunning(running);
  }

  override destroy(): void {
    if (this._styleChangedId !== null) {
      this._settings.disconnect(this._styleChangedId);
      this._styleChangedId = null;
    }
    if (this._currentSection) {
      this._currentSection.destroy();
      this._currentSection = null;
    }
    super.destroy();
  }
}
