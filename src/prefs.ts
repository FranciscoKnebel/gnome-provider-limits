import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk";
import {
  ExtensionPreferences,
  gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { PROVIDER_LABELS } from "./constants.js";

const ProviderLimitsPreferencesPage = GObject.registerClass(
  class ProviderLimitsPreferencesPage extends Adw.PreferencesPage {
    _init(settings: Gio.Settings) {
      super._init({
        title: _("General"),
        icon_name: "preferences-system-symbolic",
      });

      this._settings = settings;
      this.add(this._buildRefreshGroup());
      this.add(this._buildLanguageGroup());
      this.add(this._buildProvidersGroup());
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

      const model = Gtk.StringList.new([_("System"), "English", "Português (Brasil)"]);
      const row = new Adw.ComboRow({
        title: _("Display language"),
        subtitle: _("Override the system locale, or follow it."),
        model,
      });

      const current = this._settings.get_string("language");
      row.selected = current === "en" ? 1 : current === "pt_BR" ? 2 : 0;

      row.connect("notify::selected", (combo: Adw.ComboRow) => {
        const values = ["", "en", "pt_BR"];
        this._settings.set_string("language", values[combo.selected] ?? "");
      });

      group.add(row);
      return group;
    }

    private _buildProvidersGroup(): Adw.PreferencesGroup {
      const group = new Adw.PreferencesGroup({
        title: _("Providers"),
        description: _("Enable and reorder providers."),
      });

      const order = this._settings.get_strv("providers-order");
      for (const name of order) {
        const row = new Adw.ActionRow({
          title: PROVIDER_LABELS[name] ?? name,
        });

        const toggle = new Gtk.Switch({
          valign: Gtk.Align.CENTER,
        });
        this._settings.bind(`${name}-enabled`, toggle, "active", Gio.SettingsBindFlags.DEFAULT);
        row.add_suffix(toggle);

        group.add(row);
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
  },
);

export default class ProviderLimitsPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window: Adw.PreferencesWindow): void {
    const settings = this.getSettings();

    window.add(new ProviderLimitsPreferencesPage(settings));

    // Add per-provider pages for enabled providers
    const order = settings.get_strv("providers-order");
    for (const name of order) {
      if (settings.get_boolean(`${name}-enabled`)) {
        window.add(this._buildProviderPage(settings, name));
      }

      // Dynamically add/remove page when toggle changes
      settings.connect(`changed::${name}-enabled`, () => {
        // Rebuild window pages — simplified for scaffold
        // Full implementation in ADR-0017
      });
    }
  }

  private _buildProviderPage(settings: Gio.Settings, name: string): Adw.PreferencesPage {
    const page = new Adw.PreferencesPage({
      title: PROVIDER_LABELS[name] ?? name,
      icon_name: "preferences-system-symbolic",
    });

    const group = new Adw.PreferencesGroup({
      title: _("Settings"),
    });

    const cliRow = new Adw.EntryRow({
      title: _("CLI path"),
      text: settings.get_string(`${name}-cli-path`) ?? "",
    });
    settings.bind(`${name}-cli-path`, cliRow, "text", Gio.SettingsBindFlags.DEFAULT);
    group.add(cliRow);

    page.add(group);
    return page;
  }
}
