import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk";
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { PROVIDER_NAMES, type ProviderName } from "../../constants.js";
import {
  isProviderName,
  normalizeProvidersOrder,
  providerDisplayName,
} from "../../helpers/provider-settings.js";
import { buildReorderableList, setupDragSource, setupDropTarget } from "./shared.js";

export const ProviderLimitsPreferencesPage = GObject.registerClass(
  class ProviderLimitsPreferencesPage extends Adw.PreferencesPage {
    declare _settings: Gio.Settings;
    declare _settingsChangedIds: number[];
    declare _destroyCallbacks: (() => void)[];

    _init(settings: Gio.Settings) {
      super._init({
        title: _("General"),
        icon_name: "preferences-system-symbolic",
      });

      this._settings = settings;
      this._settingsChangedIds = [];
      this._destroyCallbacks = [];
      this.connect("destroy", () => this.cleanup());
      this.add(this._buildRefreshGroup());
      this.add(this._buildLanguageGroup());
      this.add(this._buildProvidersGroup());
    }

    cleanup(): void {
      for (const id of this._settingsChangedIds) {
        this._settings.disconnect(id);
      }
      this._settingsChangedIds = [];

      for (const destroy of this._destroyCallbacks) destroy();
      this._destroyCallbacks = [];
    }

    private _buildRefreshGroup(): Adw.PreferencesGroup {
      const group = new Adw.PreferencesGroup({
        title: _("Refresh"),
        description: _("Control how often the extension refreshes provider data."),
      });

      const shortRow = this._createSpinRow(
        "refresh-short-interval-seconds",
        _("Short interval"),
        _("Seconds between refreshes when data is changing."),
        10,
        3600,
        60,
      );
      group.add(shortRow);

      const longRow = this._createSpinRow(
        "refresh-long-interval-seconds",
        _("Long interval"),
        _("Seconds between refreshes when data is stable."),
        60,
        3600,
        60,
      );
      group.add(longRow);

      const thresholdRow = this._createSpinRow(
        "refresh-stable-reads-threshold",
        _("Stable reads threshold"),
        _("Number of unchanged reads before degrading to the long interval."),
        1,
        10,
        1,
      );
      group.add(thresholdRow);

      return group;
    }

    private _buildLanguageGroup(): Adw.PreferencesGroup {
      const group = new Adw.PreferencesGroup({
        title: _("Language"),
        description: _("Display language for the extension."),
      });

      const model = Gtk.StringList.new([_("System"), _("English"), _("Português (Brasil)")]);
      const row = new Adw.ComboRow({
        title: _("Display language"),
        subtitle: _("Override the system locale, or follow it."),
        model,
      });

      const current = this._settings.get_string("language");
      row.selected = current === "en" ? 1 : current === "pt_BR" ? 2 : 0;

      row.connect("notify::selected", (combo: Adw.ComboRow) => {
        const values = ["", "en", "pt_BR"];
        const lang = values[combo.selected] ?? "";
        this._settings.set_string("language", lang);
        if (lang && lang.trim()) {
          GLib.setenv("LANGUAGE", lang.trim(), true);
        } else {
          GLib.unsetenv("LANGUAGE");
        }
        GLib.get_language_names();
      });

      group.add(row);
      return group;
    }

    private _buildProvidersGroup(): Adw.PreferencesGroup {
      const group = new Adw.PreferencesGroup({
        title: _("Providers"),
        description: _("Enable and reorder providers by dragging the rows."),
      });

      const { listBox, render, destroy } = buildReorderableList(
        this._settings,
        "providers-order",
        (value) => {
          if (!isProviderName(value)) return null;
          const row = this._buildReorderableRow({
            key: "providers-order",
            value,
            label: providerDisplayName(this._settings, value),
          });
          const toggle = new Gtk.Switch({ valign: Gtk.Align.CENTER });
          this._settings.bind(`${value}-enabled`, toggle, "active", Gio.SettingsBindFlags.DEFAULT);
          row.add_suffix(toggle);
          return row;
        },
        normalizeProvidersOrder,
      );
      this._destroyCallbacks.push(destroy);
      group.add(listBox);

      for (const name of PROVIDER_NAMES) {
        this._settingsChangedIds.push(
          this._settings.connect(`changed::${name}-display-name`, render),
        );
      }

      return group;
    }

    private _createSpinRow(
      key: string,
      title: string,
      subtitle: string,
      lower: number,
      upper: number,
      step: number,
    ): Adw.SpinRow {
      const adjustment = new Gtk.Adjustment({
        lower,
        upper,
        step_increment: step,
        value: this._settings.get_int(key),
      });

      const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment,
        climb_rate: 1,
        digits: 0,
      });

      this._settings.bind(key, row, "value", Gio.SettingsBindFlags.DEFAULT);
      return row;
    }

    private _buildReorderableRow(args: {
      key: string;
      value: ProviderName;
      label: string;
    }): Adw.ActionRow {
      const { key, value, label } = args;

      const row = new Adw.ActionRow({
        title: label,
        activatable: false,
      });

      const dragHandle = new Gtk.Image({ icon_name: "list-drag-handle-symbolic" });
      row.add_prefix(dragHandle);

      setupDragSource(row, value);
      setupDropTarget(row, this._settings, key);

      return row;
    }
  },
);
