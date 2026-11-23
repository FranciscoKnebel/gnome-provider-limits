import type Gio from "gi://Gio";
import GLib from "gi://GLib";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import type { ProviderName } from "../constants.js";
import { gettext as _ } from "../helpers/gettext.js";
import { resolveLocale } from "../helpers/locale.js";
import type { BaseReader, FieldDef, ReaderResult } from "../readers/base.js";
import { PROVIDER_FIELDS } from "../readers/fields.js";
import { CardsPanelSection } from "./panelCards.js";
import { CompactPanelSection } from "./panelCompact.js";
import { GaugesPanelSection } from "./panelGauges.js";
import { PanelShell, type PanelStyleSection } from "./panelShell.js";
import { resolvePanelStyle, type PanelStyle, type StyleDispatch } from "./styles.js";
import { viewContextFor } from "./viewContext.js";

export type { PanelStyle } from "./styles.js";
export type { PanelStyleSection } from "./panelShell.js";

export class PanelWidget extends PopupMenu.PopupMenuSection {
  private readonly _settings: Gio.Settings;
  private readonly _readers: Map<ProviderName, BaseReader>;
  private readonly _fieldDefs: Readonly<Record<ProviderName, readonly FieldDef[]>>;
  private readonly _openPreferences: () => void;
  private readonly _onRefresh: () => void;
  private readonly _closeMenu: () => void;
  private readonly _sections: StyleDispatch<PanelStyle, () => PanelStyleSection>;
  private _currentStyle: PanelStyle | null = null;
  private _currentSection: PanelStyleSection | null = null;

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
    this._fieldDefs = PROVIDER_FIELDS;
    this._openPreferences = openPreferences;
    this._onRefresh = onRefresh;
    this._closeMenu = closeMenu;
    this._sections = {
      gauges: () =>
        new GaugesPanelSection(
          settings,
          this._readers,
          this._fieldDefs,
          this._createShell("gauges"),
        ),
      cards: () =>
        new CardsPanelSection(settings, this._readers, this._fieldDefs, this._createShell("cards")),
      compact: () =>
        new CompactPanelSection(
          settings,
          this._readers,
          this._fieldDefs,
          this._createShell("compact"),
        ),
    };

    this._ensureSection();
  }

  private _resolveStyle(): PanelStyle {
    return resolvePanelStyle(this._settings.get_string("panel-style"));
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
    let running = false;
    if (this._currentSection) {
      running = this._currentSection.shell.isRunning();
      this._currentSection.destroy();
      this._currentSection = null;
    }

    this._currentStyle = newStyle;
    const section = this._sections[newStyle]();
    this._currentSection = section;
    this.addMenuItem(section.shell);
    section.setRunning(running);
    return section;
  }

  render(results: Map<ProviderName, ReaderResult>, lastRefreshAt: number | null): void {
    const section = this._ensureSection();
    const view = viewContextFor(
      this._settings,
      this._readers,
      results,
      this._fieldDefs,
      resolveLocale(
        this._settings.get_string("language"),
        GLib.getenv("LC_MESSAGES"),
        GLib.getenv("LANG"),
      ),
      _,
    );
    section.render({ lastRefreshAt, view });
    section.shell.setLastRefreshAt(lastRefreshAt);
  }

  setRunning(running: boolean): void {
    this._currentSection?.setRunning(running);
  }

  override destroy(): void {
    if (this._currentSection) {
      this._currentSection.destroy();
      this._currentSection = null;
    }
    super.destroy();
  }
}
