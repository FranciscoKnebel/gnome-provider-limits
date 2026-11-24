import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk?version=4.0";

import {
  DEFAULT_PANEL_STYLE,
  DEFAULT_STATUS_BAR_STYLE,
  PANEL_STYLES,
  STATUS_BAR_STYLES,
  isPanelStyle,
  isStatusBarStyle,
  type PanelStyle,
  type StatusBarStyle,
} from "../styles.js";
import { gettext as _ } from "./gettext.js";
import { bindSetting, unbindSettings } from "./shared.js";
import type { SettingsBinding } from "./shared.js";

function bindEnumCombo<Value extends string>(
  settings: Gio.Settings,
  key: string,
  values: readonly Value[],
  labels: readonly string[],
  guard: (value: string) => value is Value,
  fallback: Value,
  row: Adw.ComboRow,
  changedIds: number[],
): void {
  row.model = Gtk.StringList.new([...labels]);
  const fallbackIndex = Math.max(0, values.indexOf(fallback));

  const updateFromSettings = () => {
    const value = settings.get_string(key);
    const index = guard(value) ? values.indexOf(value) : -1;
    const selected = index >= 0 ? index : fallbackIndex;
    if (row.selected !== selected) row.selected = selected;
  };

  updateFromSettings();

  row.connect("notify::selected", (combo: Adw.ComboRow) => {
    const value = values[combo.selected] ?? fallback;
    if (settings.get_string(key) !== value) {
      settings.set_string(key, value);
    }
  });

  changedIds.push(settings.connect(`changed::${key}`, updateFromSettings));
}

export interface LanguageEntry {
  code: string;
  name: string;
}

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
        60,
        3600,
        60,
      );
      group.add(longRow);

      const stableRow = this._createSpinRow(
        "refresh-stable-reads-threshold",
        _("Stable reads threshold"),
        _("Number of consecutive identical reads before switching to the long interval."),
        1,
        10,
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

      const statusStyleLabels: Record<StatusBarStyle, string> = {
        pills: _("Capsule pills"),
        gauges: _("Micro-ring gauges"),
        compact: _("Compact text"),
      };
      const statusStyleValues = STATUS_BAR_STYLES.map((style) => statusStyleLabels[style]);
      const statusStyleRow = new Adw.ComboRow({
        title: _("Status bar style"),
        subtitle: _("Visual presentation of metrics in the top bar."),
      });
      bindEnumCombo(
        this._settings,
        "status-bar-style",
        STATUS_BAR_STYLES,
        statusStyleValues,
        isStatusBarStyle,
        DEFAULT_STATUS_BAR_STYLE,
        statusStyleRow,
        this._settingsChangedIds,
      );
      group.add(statusStyleRow);

      const panelStyleLabels: Record<PanelStyle, string> = {
        gauges: _("Tabbed cockpit & gauges"),
        cards: _("Quick settings cards"),
        compact: _("Collapsible matrix HUD"),
      };
      const panelStyleValues = PANEL_STYLES.map((style) => panelStyleLabels[style]);
      const panelStyleRow = new Adw.ComboRow({
        title: _("Dropdown panel style"),
        subtitle: _("Visual presentation of details in the dropdown panel."),
      });
      bindEnumCombo(
        this._settings,
        "panel-style",
        PANEL_STYLES,
        panelStyleValues,
        isPanelStyle,
        DEFAULT_PANEL_STYLE,
        panelStyleRow,
        this._settingsChangedIds,
      );
      group.add(panelStyleRow);

      const positionValues = ["left", "right"] as const;
      type Position = (typeof positionValues)[number];
      const positionRow = new Adw.ComboRow({
        title: _("Status bar position"),
        subtitle: _(
          "Choose whether the status bar appears on the left or right side of the top bar.",
        ),
      });
      bindEnumCombo(
        this._settings,
        "status-bar-position",
        positionValues,
        [_("Left"), _("Right")],
        (value): value is Position => value === "left" || value === "right",
        "right",
        positionRow,
        this._settingsChangedIds,
      );
      group.add(positionRow);

      return group;
    }

    private _buildLanguageGroup(): Adw.PreferencesGroup {
      const group = new Adw.PreferencesGroup({
        title: _("Language"),
      });

      const sorted = this._languages.toSorted((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      );
      const items = [_("Follow system"), ...sorted.map((l) => l.name)];
      const model = Gtk.StringList.new(items);
      const row = new Adw.ComboRow({
        title: _("Display language"),
        subtitle: _("Choose an explicit language or follow the system locale."),
        model,
      });

      const currentCode = this._settings.get_string("language");
      const currentIndex = sorted.findIndex((l) => l.code === currentCode);
      row.selected = currentIndex >= 0 ? currentIndex + 1 : 0;

      row.connect("notify::selected", (combo: Adw.ComboRow) => {
        const newCode = combo.selected === 0 ? "" : (sorted[combo.selected - 1]?.code ?? "");
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
