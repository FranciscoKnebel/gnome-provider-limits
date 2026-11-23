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

const STATUS_BAR_STYLE_VALUES = ["pills", "gauges", "compact"] as const;
const PANEL_STYLE_VALUES = ["gauges", "cards", "compact"] as const;

export const ProviderLimitsPreferencesPage = GObject.registerClass(
  class ProviderLimitsPreferencesPage extends Adw.PreferencesPage {
    declare _settings: Gio.Settings;
    declare _languages: LanguageEntry[];
    declare _settingsChangedIds: number[];
    declare _destroyCallbacks: (() => void)[];
    declare _bindings: SettingsBinding[];

    _init(settings: Gio.Settings, languages: LanguageEntry[]) {
      super._init({
        title: _("General"),
        icon_name: "preferences-system-symbolic",
      });

      this._settings = settings;
      this._languages = languages;
      this._settingsChangedIds = [];
      this._destroyCallbacks = [];
      this._bindings = [];
      this.connect("destroy", () => this.cleanup());
      this.add(this._buildRefreshGroup());
      this.add(this._buildAppearanceGroup());
      this.add(this._buildLanguageGroup());
    }

    cleanup(): void {
      for (const id of this._settingsChangedIds) {
        this._settings.disconnect(id);
      }
      this._settingsChangedIds = [];

      for (const destroy of this._destroyCallbacks) destroy();
      this._destroyCallbacks = [];

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
        30,
        86400,
        60,
      );
      group.add(longRow);

      const stableRow = this._createSpinRow(
        "refresh-stable-reads-threshold",
        _("Stable reads threshold"),
        _("Number of consecutive identical reads before switching to the long interval."),
        1,
        100,
        1,
      );
      group.add(stableRow);

      return group;
    }

    private _buildAppearanceGroup(): Adw.PreferencesGroup {
      const group = new Adw.PreferencesGroup({
        title: _("Appearance"),
        description: _("Choose the visual styles for the top bar and dropdown menu."),
      });

      // 1. Status Bar Style
      const statusStyleModel = Gtk.StringList.new([
        _("Capsule pills"),
        _("Micro-ring gauges"),
        _("Compact text"),
      ]);
      const statusStyleRow = new Adw.ComboRow({
        title: _("Status bar style"),
        subtitle: _("Visual presentation of metrics in the top bar."),
        model: statusStyleModel,
      });

      const updateStatusStyleFromSettings = () => {
        const val = this._settings.get_string("status-bar-style");
        const idx = STATUS_BAR_STYLE_VALUES.indexOf(
          val as (typeof STATUS_BAR_STYLE_VALUES)[number],
        );
        statusStyleRow.selected = idx >= 0 ? idx : 0;
      };
      updateStatusStyleFromSettings();

      statusStyleRow.connect("notify::selected", (combo: Adw.ComboRow) => {
        const selectedVal = STATUS_BAR_STYLE_VALUES[combo.selected] ?? "pills";
        if (this._settings.get_string("status-bar-style") !== selectedVal) {
          this._settings.set_string("status-bar-style", selectedVal);
        }
      });
      const statusStyleChangedId = this._settings.connect(
        "changed::status-bar-style",
        updateStatusStyleFromSettings,
      );
      this._settingsChangedIds.push(statusStyleChangedId);
      group.add(statusStyleRow);

      // 2. Panel Style
      const panelStyleModel = Gtk.StringList.new([
        _("Tabbed cockpit & gauges"),
        _("Quick settings cards"),
        _("Collapsible matrix HUD"),
      ]);
      const panelStyleRow = new Adw.ComboRow({
        title: _("Dropdown panel style"),
        subtitle: _("Visual presentation of details in the dropdown panel."),
        model: panelStyleModel,
      });

      const updatePanelStyleFromSettings = () => {
        const val = this._settings.get_string("panel-style");
        const idx = PANEL_STYLE_VALUES.indexOf(val as (typeof PANEL_STYLE_VALUES)[number]);
        panelStyleRow.selected = idx >= 0 ? idx : 0;
      };
      updatePanelStyleFromSettings();

      panelStyleRow.connect("notify::selected", (combo: Adw.ComboRow) => {
        const selectedVal = PANEL_STYLE_VALUES[combo.selected] ?? "gauges";
        if (this._settings.get_string("panel-style") !== selectedVal) {
          this._settings.set_string("panel-style", selectedVal);
        }
      });
      const panelStyleChangedId = this._settings.connect(
        "changed::panel-style",
        updatePanelStyleFromSettings,
      );
      this._settingsChangedIds.push(panelStyleChangedId);
      group.add(panelStyleRow);

      // 3. Status Bar Position
      const positionModel = Gtk.StringList.new([_("Left"), _("Right")]);
      const positionRow = new Adw.ComboRow({
        title: _("Status bar position"),
        subtitle: _(
          "Choose whether the status bar appears on the left or right side of the top bar.",
        ),
        model: positionModel,
      });

      positionRow.selected = this._settings.get_string("status-bar-position") === "left" ? 0 : 1;
      positionRow.connect("notify::selected", (combo: Adw.ComboRow) => {
        const position = combo.selected === 0 ? "left" : "right";
        if (this._settings.get_string("status-bar-position") !== position) {
          this._settings.set_string("status-bar-position", position);
        }
      });
      const positionChangedId = this._settings.connect("changed::status-bar-position", () => {
        const position = this._settings.get_string("status-bar-position") === "left" ? 0 : 1;
        if (positionRow.selected !== position) positionRow.selected = position;
      });
      this._settingsChangedIds.push(positionChangedId);
      group.add(positionRow);

      return group;
    }

    private _buildLanguageGroup(): Adw.PreferencesGroup {
      const group = new Adw.PreferencesGroup({
        title: _("Language"),
      });

      const items = [_("Follow system"), ...this._languages.map((l) => l.name)];
      const model = Gtk.StringList.new(items);
      const row = new Adw.ComboRow({
        title: _("Display language"),
        subtitle: _("Choose an explicit language or follow the system locale."),
        model,
      });

      const currentCode = this._settings.get_string("language");
      const currentIndex = this._languages.findIndex((l) => l.code === currentCode);
      row.selected = currentIndex >= 0 ? currentIndex + 1 : 0;

      row.connect("notify::selected", (combo: Adw.ComboRow) => {
        const newCode =
          combo.selected === 0 ? "" : (this._languages[combo.selected - 1]?.code ?? "");
        if (this._settings.get_string("language") !== newCode) {
          this._settings.set_string("language", newCode);
        }
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
        page_increment: step * 10,
        value: this._settings.get_int(key),
      });

      const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment,
      });

      bindSetting(this._settings, key, adjustment, "value", this._bindings);
      return row;
    }
  },
);
