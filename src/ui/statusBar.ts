import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import St from "gi://St";

import { gettext as _ } from "../helpers/gettext.js";
import type { StatusBarSectionRenderer } from "./statusBarRenderer.js";
import { resolveStatusBarStyle, type StatusBarStyle } from "./styleCatalog.js";
import { STYLE_REGISTRY } from "./styles.js";
import type { ProviderViewContext } from "./viewContext.js";

export const StatusBarWidget = GObject.registerClass(
  class StatusBarWidget extends St.BoxLayout {
    declare _settings: Gio.Settings;
    declare _style: StatusBarStyle | null;
    declare _renderer: StatusBarSectionRenderer | null;

    _init(settings: Gio.Settings) {
      super._init({
        style_class: "provider-limits-status-bar",
        y_align: Clutter.ActorAlign.CENTER,
      });
      this._settings = settings;
      this._style = null;
      this._renderer = null;
      this.accessible_name = _("Provider Limits");
    }

    render(view: ProviderViewContext): void {
      const style = resolveStatusBarStyle(this._settings.get_string("status-bar-style"));
      if (this._style !== style) {
        this._renderer?.dispose();
        const spec = STYLE_REGISTRY.statusBar[style];
        this._renderer = spec.factory(this);
        this._style = spec.id;
      }

      this._renderer?.render(view);
    }
  },
);
