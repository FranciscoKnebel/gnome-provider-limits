import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk?version=4.0";

import { gettext as _ } from "./gettext.js";
import { bindSetting, unbindSettings } from "./shared.js";
import type { SettingsBinding } from "./shared.js";

export interface LanguageEntry {
  code: string;
  name: string;
}

export const ProviderLimitsPreferencesPage = GObject.registerClass(
  class ProviderLimitsPreferencesPage extends Adw.PreferencesPage {
    declare _settings: Gio.Settings;
    declare _languages: LanguageEntry[];
    declare _settingsChangedIds: number[];
    declare _bindings: SettingsBinding[];

    _init(settings: Gio.Settings, languages: LanguageEntry[]) {
      super._init({
        title: _("General"),
        icon_name: "preferences-system-symbolic",
      });

      this._settings = settings;
      this._languages = languages;
      this._settingsChangedIds = [];
      this._bindings = [];
      this.connect("destroy", () => this.cleanup());
      this.add(this._buildRefreshGroup());
      this.add(this._buildStatusBarPositionGroup());
      this.add(this._buildLanguageGroup());
    }

    cleanup(): void {
      for (const id of this._settingsChangedIds) {
        this._settings.disconnect(id);
      }
      this._settingsChangedIds = [];

      unbindSettings(this._bindings);
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

    private _buildStatusBarPositionGroup(): Adw.PreferencesGroup {
      const group = new Adw.PreferencesGroup({
        title: _("Status bar"),
      });
      const model = Gtk.StringList.new([_("Left"), _("Right")]);
      const row = new Adw.ComboRow({
        title: _("Status bar position"),
        subtitle: _(
          "Choose whether the status bar appears on the left or right side of the top bar.",
        ),
        model,
      });

      row.selected = this._settings.get_string("status-bar-position") === "left" ? 0 : 1;
      row.connect("notify::selected", (combo: Adw.ComboRow) => {
        const position = combo.selected === 0 ? "left" : "right";
        if (this._settings.get_string("status-bar-position") !== position) {
          this._settings.set_string("status-bar-position", position);
        }
      });
      this._settingsChangedIds.push(
        this._settings.connect("changed::status-bar-position", () => {
          const selected = this._settings.get_string("status-bar-position") === "left" ? 0 : 1;
          if (row.selected !== selected) row.selected = selected;
        }),
      );

      group.add(row);
      return group;
    }

    private _buildLanguageGroup(): Adw.PreferencesGroup {
      const group = new Adw.PreferencesGroup({
        title: _("Language"),
        description: _("Display language for the extension."),
      });

      const sorted = this._languages.toSorted((a: LanguageEntry, b: LanguageEntry) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      );
      const labels = [_("System"), ...sorted.map((l) => l.name)];
      const model = Gtk.StringList.new(labels);
      const row = new Adw.ComboRow({
        title: _("Display language"),
        subtitle: _("Override the system locale, or follow it."),
        model,
      });

      const current = this._settings.get_string("language");
      const matchIdx = sorted.findIndex((l) => l.code === current);
      row.selected = matchIdx >= 0 ? matchIdx + 1 : 0;

      row.connect("notify::selected", (combo: Adw.ComboRow) => {
        const lang = combo.selected === 0 ? "" : sorted[combo.selected - 1].code;
        this._settings.set_string("language", lang);
      });

      group.add(row);
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

      bindSetting(this._settings, key, row, "value", this._bindings);
      return row;
    }
  },
);
