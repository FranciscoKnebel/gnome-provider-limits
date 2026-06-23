import Clutter from "gi://Clutter";
import type Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import { formatField } from "../formatters.js";
import type { BaseReader, ReaderResult } from "../readers/base.js";
import { ReaderStatus } from "../readers/base.js";

export class PanelWidget {
  private _settings: Gio.Settings;
  private _readers: Map<string, BaseReader>;
  private _section: PopupMenu.PopupMenuSection;
  private _openPreferences: () => void;

  constructor(
    settings: Gio.Settings,
    readers: Map<string, BaseReader>,
    openPreferences: () => void,
  ) {
    this._settings = settings;
    this._readers = readers;
    this._openPreferences = openPreferences;
    this._section = new PopupMenu.PopupMenuSection();
  }

  get section(): PopupMenu.PopupMenuSection {
    return this._section;
  }

  render(results: Map<string, ReaderResult>): void {
    this._section.removeAll();

    const order = this._settings.get_strv("providers-order");
    const locale = this._getLocale();

    for (const name of order) {
      const result = results.get(name);
      if (!result) continue;
      if (result.status === ReaderStatus.DISABLED) continue;

      this._addProviderSection(name, result, locale);
      this._section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    }

    this._addRefreshRow();
    const settingsItem = new PopupMenu.PopupMenuItem(_("Settings"));
    settingsItem.connect("activate", () => {
      this._openPreferences();
    });
    this._section.addMenuItem(settingsItem);
  }

  private _addProviderSection(name: string, result: ReaderResult, locale: string): void {
    const headerText = this._getHeader(name, result);
    const header = new PopupMenu.PopupMenuItem(headerText, {
      reactive: false,
      can_focus: false,
    });
    header.add_style_class_name("provider-limits-panel-header");
    this._section.addMenuItem(header);

    if (result.status === ReaderStatus.ERROR) {
      const errorRow = new PopupMenu.PopupMenuItem(result.lastError ?? _("Error"), {
        reactive: false,
        can_focus: false,
      });
      errorRow.add_style_class_name("provider-limits-dim");
      this._section.addMenuItem(errorRow);
      return;
    }

    const reader = this._readers.get(name);
    const panelFields = this._settings.get_strv(`${name}-panel-fields`);

    for (const fieldName of panelFields) {
      const fieldDef = reader?.FIELDS.find((f) => f.name === fieldName);
      if (!fieldDef) continue;

      const field = result.fields.find((f) => f.name === fieldName);
      if (!field) continue;

      const valueText = formatField({
        type: fieldDef.type,
        value: field.value,
        zone: "panel",
        locale,
      });

      const row = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false,
      });

      const labelLabel = new St.Label({
        text: fieldDef.label,
        style_class: "provider-limits-field-label",
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
      });

      const valueLabel = new St.Label({
        text: valueText,
        style_class: "provider-limits-field-value",
        x_align: Clutter.ActorAlign.END,
      });

      row.add_child(labelLabel);
      row.add_child(valueLabel);
      this._section.addMenuItem(row);
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
      // TODO: trigger refresh
    });
    this._section.addMenuItem(row);
  }

  private _getHeader(name: string, result: ReaderResult): string {
    const label = this._getProviderDisplayName(name);
    const statusText = this._statusText(result.status);
    return `${label}  ${statusText}`;
  }

  private _getProviderDisplayName(name: string): string {
    const label = this._settings.get_string(`${name}-display-name`);
    return label || name;
  }

  private _statusText(status: ReaderStatus): string {
    switch (status) {
      case ReaderStatus.OK:
        return "";
      case ReaderStatus.PARTIAL:
        return "(partial)";
      case ReaderStatus.ERROR:
        return "(error)";
      case ReaderStatus.UNAVAILABLE:
        return "(unavailable)";
      default:
        return "";
    }
  }

  private _getLocale(): string {
    const lang = this._settings.get_string("language");
    if (lang && lang.trim()) return lang.trim();
    const envLang = GLib.getenv("LC_MESSAGES") ?? GLib.getenv("LANG") ?? "en";
    return envLang.split(".")[0];
  }
}
