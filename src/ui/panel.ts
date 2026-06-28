import Clutter from "gi://Clutter";
import type Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import { resolveLocale } from "../helpers/locale.js";
import { providerDisplayName } from "../helpers/provider-settings.js";
import type { BaseReader, ReaderResult } from "../readers/base.js";
import { ReaderStatus } from "../readers/base.js";
import { getFieldRows } from "./fieldRows.js";

export class PanelWidget extends PopupMenu.PopupMenuSection {
  private _settings: Gio.Settings;
  private _readers: Map<string, BaseReader>;
  private _openPreferences: () => void;
  private _onRefresh?: () => void;

  constructor(
    settings: Gio.Settings,
    readers: Map<string, BaseReader>,
    openPreferences: () => void,
    onRefresh?: () => void,
  ) {
    super();
    this._settings = settings;
    this._readers = readers;
    this._openPreferences = openPreferences;
    this._onRefresh = onRefresh;
  }

  render(results: Map<string, ReaderResult>): void {
    this.removeAll();

    const order = this._settings.get_strv("providers-order");
    const locale = resolveLocale(
      this._settings.get_string("language"),
      GLib.getenv("LC_MESSAGES"),
      GLib.getenv("LANG"),
    );

    for (const name of order) {
      const result = results.get(name);
      if (!result) continue;
      if (result.status === ReaderStatus.DISABLED) continue;

      this._addProviderSection(name, result, locale);
      this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    }

    this._addRefreshRow();
    const settingsItem = new PopupMenu.PopupMenuItem(_("Settings"));
    settingsItem.connect("activate", () => {
      this._openPreferences();
    });
    this.addMenuItem(settingsItem);
  }

  private _addProviderSection(name: string, result: ReaderResult, locale: string): void {
    const displayName = this._getProviderDisplayName(name);
    const headerText = this._buildHeaderText(displayName, result.status);
    const header = new PopupMenu.PopupMenuItem(headerText, {
      reactive: false,
      can_focus: false,
    });
    header.add_style_class_name("provider-limits-panel-header");
    this.addMenuItem(header);

    if (result.status === ReaderStatus.ERROR) {
      const errorRow = new PopupMenu.PopupMenuItem(result.lastError ?? _("Error"), {
        reactive: false,
        can_focus: false,
      });
      errorRow.add_style_class_name("provider-limits-dim");
      this.addMenuItem(errorRow);
      return;
    }

    const reader = this._readers.get(name);
    const fieldNames = this._settings.get_strv(`${name}-panel-fields`);
    const rows = getFieldRows(reader, result, fieldNames, "panel", locale, _);

    for (const rowData of rows) {
      const row = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false,
      });

      const labelLabel = new St.Label({
        text: _(rowData.label),
        style_class: "provider-limits-field-label",
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
      });

      const valueLabel = new St.Label({
        text: rowData.valueText,
        style_class: "provider-limits-field-value",
        x_align: Clutter.ActorAlign.END,
      });

      row.add_child(labelLabel);
      row.add_child(valueLabel);
      this.addMenuItem(row);
    }
  }

  private _addRefreshRow(): void {
    const row = new PopupMenu.PopupBaseMenuItem();
    row.add_child(
      new St.Label({
        text: _("Force refresh"),
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
      }),
    );
    row.connect("activate", () => {
      this._onRefresh?.();
    });
    this.addMenuItem(row);
  }

  private _getProviderDisplayName(name: string): string {
    return providerDisplayName(this._settings, name);
  }

  private _buildHeaderText(displayName: string, status: ReaderStatus): string {
    const suffix = this._statusText(status);
    return suffix ? `${displayName}  ${suffix}` : displayName;
  }

  private _statusText(status: ReaderStatus): string {
    switch (status) {
      case ReaderStatus.OK:
        return "";
      case ReaderStatus.PARTIAL:
        return _("(partial)");
      case ReaderStatus.ERROR:
        return _("(error)");
      case ReaderStatus.UNAVAILABLE:
        return _("(unavailable)");
      default:
        return "";
    }
  }
}
