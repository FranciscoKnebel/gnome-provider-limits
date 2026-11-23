import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import St from "gi://St";

import { gettext as _ } from "../helpers/gettext.js";
import { CompactStatusBarRenderer } from "./statusBarCompact.js";
import { GaugesStatusBarRenderer } from "./statusBarGauges.js";
import { PillsStatusBarRenderer } from "./statusBarPills.js";
import { resolveStatusBarStyle, type StatusBarStyle } from "./styles.js";
import type { ProviderViewContext } from "./viewContext.js";

export type { StatusBarStyle } from "./styles.js";

interface StatusBarSectionRenderer {
  render(context: ProviderViewContext): void;
  dispose(): void;
}

type RendererFactory = (parent: St.BoxLayout) => StatusBarSectionRenderer;

const RENDERER_FACTORIES: Record<StatusBarStyle, RendererFactory> = {
  pills: (parent) => new PillsStatusBarRenderer(parent),
  gauges: (parent) => new GaugesStatusBarRenderer(parent),
  compact: (parent) => new CompactStatusBarRenderer(parent),
};

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
        this._renderer = RENDERER_FACTORIES[style](this);
        this._style = style;
      }

      this._renderer?.render(view);
    }
  },
);
