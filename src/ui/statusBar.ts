import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import St from "gi://St";

import type { ProviderName } from "../constants.js";
import { gettext as _ } from "../helpers/gettext.js";
import { resolveLocale } from "../helpers/locale.js";
import { normalizeProvidersOrder, providerDisplayNameShort } from "../helpers/provider-settings.js";
import type { BaseReader, FieldDef, ReaderResult } from "../readers/base.js";
import { resolveFieldDefs } from "../readers/fields.js";
import { CompactStatusBarRenderer } from "./statusBarCompact.js";
import { GaugesStatusBarRenderer } from "./statusBarGauges.js";
import { PillsStatusBarRenderer } from "./statusBarPills.js";
import { StatusBarRenderer } from "./statusBarRenderer.js";
import { resolveStatusBarStyle, type StatusBarStyle, type StyleDispatch } from "./styles.js";

export type { StatusBarStyle } from "./styles.js";
export type { StatusBarRenderer } from "./statusBarRenderer.js";

export interface StatusBarRenderContext {
  readonly order: readonly ProviderName[];
  readonly results: ReadonlyMap<ProviderName, ReaderResult>;
  readonly locale: string;
  readonly hasEnabledProviders: boolean;
  shortDisplayName(name: ProviderName): string;
  statusFields(name: ProviderName): readonly string[];
  fieldDefs(name: ProviderName): readonly FieldDef[];
  isEnabled(name: ProviderName): boolean;
  t(text: string): string;
}

type RendererFactory = (parent: St.BoxLayout) => StatusBarRenderer;

const RENDERER_FACTORIES: StyleDispatch<StatusBarStyle, RendererFactory> = {
  pills: (parent) => new PillsStatusBarRenderer(parent),
  gauges: (parent) => new GaugesStatusBarRenderer(parent),
  compact: (parent) => new CompactStatusBarRenderer(parent),
};

export const StatusBarWidget = GObject.registerClass(
  class StatusBarWidget extends St.BoxLayout {
    declare _settings: Gio.Settings;
    declare _readers: Map<ProviderName, BaseReader>;
    declare _fieldDefs: Readonly<Record<ProviderName, readonly FieldDef[]>>;
    declare _style: StatusBarStyle | null;
    declare _renderer: StatusBarRenderer | null;

    _init(settings: Gio.Settings, readers: Map<ProviderName, BaseReader>) {
      super._init({
        style_class: "provider-limits-status-bar",
        y_align: Clutter.ActorAlign.CENTER,
      });
      this._settings = settings;
      this._readers = readers;
      this._fieldDefs = resolveFieldDefs();
      this._style = null;
      this._renderer = null;
      this.accessible_name = _("Provider Limits");
    }

    render(results: Map<ProviderName, ReaderResult>): void {
      const style = resolveStatusBarStyle(this._settings.get_string("status-bar-style"));
      const context = this._createContext(results);

      if (this._style !== style) {
        this._renderer?.dispose();
        this._renderer = RENDERER_FACTORIES[style](this);
        this._style = style;
      }

      this._renderer?.render(context);
    }

    private _createContext(results: Map<ProviderName, ReaderResult>): StatusBarRenderContext {
      const order = normalizeProvidersOrder(this._settings.get_strv("providers-order"));
      const locale = resolveLocale(
        this._settings.get_string("language"),
        GLib.getenv("LC_MESSAGES"),
        GLib.getenv("LANG"),
      );
      const hasEnabledReaders = this._readers.size > 0;

      return {
        order,
        results,
        locale,
        hasEnabledProviders: hasEnabledReaders,
        shortDisplayName: (name) => providerDisplayNameShort(this._settings, name),
        statusFields: (name) => this._settings.get_strv(`${name}-status-fields`),
        fieldDefs: (name) => this._fieldDefs[name],
        isEnabled: (name) => this._settings.get_boolean(`${name}-enabled`),
        t: _,
      };
    }
  },
);
