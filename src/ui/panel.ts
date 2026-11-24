import type Gio from "gi://Gio";
import type St from "gi://St";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import { PanelShell, type PanelStyleSection } from "./panelShell.js";
import { resolvePanelStyle, type PanelStyle } from "./styleCatalog.js";
import { STYLE_REGISTRY, type PanelStyleSpec } from "./styles.js";
import type { ProviderViewContext } from "./viewContext.js";

export type { PanelStyle } from "./styleCatalog.js";
export type { PanelStyleSection } from "./panelShell.js";

export class PanelWidget extends PopupMenu.PopupMenuSection {
  private readonly _settings: Gio.Settings;
  private readonly _openPreferences: () => void;
  private readonly _onRefresh: () => void;
  private readonly _closeMenu: () => void;
  private _currentStyle: PanelStyle | null = null;
  private _currentSection: PanelStyleSection | null = null;

  constructor(
    settings: Gio.Settings,
    openPreferences: () => void,
    onRefresh: () => void,
    closeMenu: () => void,
  ) {
    super();
    this._settings = settings;
    this._openPreferences = openPreferences;
    this._onRefresh = onRefresh;
    this._closeMenu = closeMenu;

    this._ensureSection();
  }

  private _styleSpec(): PanelStyleSpec {
    return STYLE_REGISTRY.panel[resolvePanelStyle(this._settings.get_string("panel-style"))];
  }

  private _createShell(spec: PanelStyleSpec, extraControls: readonly St.Widget[] = []): PanelShell {
    return new PanelShell({
      onRefresh: this._onRefresh,
      openPreferences: this._openPreferences,
      closeMenu: this._closeMenu,
      style: spec,
      extraControls,
    });
  }

  private _ensureSection(): PanelStyleSection {
    const spec = this._styleSpec();
    if (this._currentSection && this._currentStyle === spec.id) {
      return this._currentSection;
    }
    return this._switchSection(spec);
  }

  private _switchSection(spec: PanelStyleSpec): PanelStyleSection {
    const running = this._currentSection?.shell.isRunning() ?? false;
    this._currentSection?.shell.destroy();
    this._currentSection = null;

    this._currentStyle = spec.id;
    const section = spec.factory({
      settings: this._settings,
      createShell: (extraControls) => this._createShell(spec, extraControls),
    });
    this._currentSection = section;
    this.addMenuItem(section.shell);
    section.shell.setRunning(running);
    section.setRunning(running);
    return section;
  }

  render(view: ProviderViewContext, lastRefreshAt: number | null): void {
    const section = this._ensureSection();
    section.render({ lastRefreshAt, view });
    section.shell.setLastRefreshAt(lastRefreshAt, view.locale);
  }

  setRunning(running: boolean): void {
    this._currentSection?.shell.setRunning(running);
    this._currentSection?.setRunning(running);
  }

  override destroy(): void {
    this._currentSection?.shell.destroy();
    this._currentSection = null;
    super.destroy();
  }
}
