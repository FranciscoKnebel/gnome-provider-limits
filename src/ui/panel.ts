import type Gio from "gi://Gio";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import type { ProviderName } from "../constants.js";
import { gettext as _ } from "../helpers/gettext.js";
import type { BaseReader, ReaderResult } from "../readers/base.js";
import { CardsPanelSection } from "./panelCards.js";
import { CompactPanelSection } from "./panelCompact.js";
import { GaugesPanelSection } from "./panelGauges.js";
import { PanelShell, type PanelStyleSection } from "./panelShell.js";
import { isPanelStyle, type PanelStyle, type StyleDispatch } from "./styles.js";

export type { PanelStyle } from "./styles.js";
export type { PanelStyleSection } from "./panelShell.js";

export class PanelWidget extends PopupMenu.PopupMenuSection {
  private readonly _settings: Gio.Settings;
  private readonly _readers: Map<ProviderName, BaseReader>;
  private readonly _openPreferences: () => void;
  private readonly _onRefresh: () => void;
  private readonly _closeMenu: () => void;
  private readonly _sections: StyleDispatch<PanelStyle, () => PanelStyleSection>;
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
    onRefresh: () => void,
    closeMenu: () => void,
  ) {
    super();
    this._settings = settings;
    this._readers = readers;
    this._openPreferences = openPreferences;
    this._onRefresh = onRefresh;
    this._closeMenu = closeMenu;
    this._sections = {
      gauges: () => new GaugesPanelSection(settings, this._readers, this._createShell("gauges")),
      cards: () => new CardsPanelSection(settings, this._readers, this._createShell("cards")),
      compact: () => new CompactPanelSection(settings, this._readers, this._createShell("compact")),
    };

    this._ensureSection();

    this._styleChangedId = this._settings.connect("changed::panel-style", () => {
      this._switchSection();
    });
  }

  private _resolveStyle(): PanelStyle {
    const styleSetting = this._settings.get_string("panel-style");
    return isPanelStyle(styleSetting) ? styleSetting : "gauges";
  }

  private _createShell(variant: PanelStyle): PanelShell {
    return new PanelShell({
      settings: this._settings,
      onRefresh: this._onRefresh,
      openPreferences: this._openPreferences,
      closeMenu: this._closeMenu,
      translate: _,
      footerVariant: variant,
    });
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
      const oldShell = this._currentSection.shell;
      if (typeof this.box?.remove_child === "function" && oldShell.actor) {
        this.box.remove_child(oldShell.actor);
      }
      this._currentSection.destroy();
      this._currentSection = null;
    }

    this._currentStyle = newStyle;
    const section = this._sections[newStyle]();
    this._currentSection = section;
    this.addMenuItem(section.shell);
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
