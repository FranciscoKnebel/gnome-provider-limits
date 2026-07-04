import Clutter from "gi://Clutter";
import type Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import { Spinner } from "resource:///org/gnome/shell/ui/animation.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import type { ProviderName } from "../constants.js";
import { formatAbsoluteTimestamp } from "../formatters.js";
import { resolveLocale } from "../helpers/locale.js";
import { normalizeProvidersOrder, providerDisplayName } from "../helpers/provider-settings.js";
import type { BaseReader, ReaderResult } from "../readers/base.js";
import { ReaderStatus } from "../readers/base.js";
import { getFieldRows } from "./fieldRows.js";

export class PanelWidget extends PopupMenu.PopupMenuSection {
  private _settings: Gio.Settings;
  private _readers: Map<ProviderName, BaseReader>;
  private _openPreferences: () => void;
  private _onRefresh?: () => void;
  private _running = false;
  private _refreshRow: PopupMenu.PopupBaseMenuItem | null = null;
  private _refreshButtonLabel: St.Label | null = null;
  private _refreshSpinner: Spinner | null = null;

  constructor(
    settings: Gio.Settings,
    readers: Map<ProviderName, BaseReader>,
    openPreferences: () => void,
    onRefresh?: () => void,
  ) {
    super();
    this._settings = settings;
    this._readers = readers;
    this._openPreferences = openPreferences;
    this._onRefresh = onRefresh;
  }

  render(results: Map<ProviderName, ReaderResult>, lastRefreshAt: number | null): void {
    this.removeAll();
    this._refreshRow = null;
    this._refreshButtonLabel = null;
    this._refreshSpinner = null;

    const order = normalizeProvidersOrder(this._settings.get_strv("providers-order"));
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

    this._addRefreshRow(lastRefreshAt, locale);
    const settingsItem = new PopupMenu.PopupMenuItem(_("Settings"));
    settingsItem.connect("activate", () => {
      this._openPreferences();
    });
    this.addMenuItem(settingsItem);
  }

  setRunning(running: boolean): void {
    this._running = running;
    if (this._refreshSpinner) {
      this._refreshSpinner.visible = running;
      if (running) this._refreshSpinner.play();
      else this._refreshSpinner.stop();
    }
    if (this._refreshButtonLabel) {
      this._refreshButtonLabel.text = running ? _("Refreshing…") : _("Force refresh");
    }
    if (this._refreshRow) this._refreshRow.reactive = !running;
  }

  private _addProviderSection(name: ProviderName, result: ReaderResult, locale: string): void {
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

    this._addLastUpdatedRow(result.lastUpdated, locale);
  }

  private _addLastUpdatedRow(lastUpdated: number, locale: string): void {
    if (!Number.isFinite(lastUpdated)) return;
    const row = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
    });
    const label = new St.Label({
      text: `${_("Last updated:")} ${formatAbsoluteTimestamp(lastUpdated, locale)}`,
      style_class: "provider-limits-dim",
      x_expand: true,
      x_align: Clutter.ActorAlign.START,
    });
    row.add_child(label);
    this.addMenuItem(row);
  }

  private _addRefreshRow(lastRefreshAt: number | null, locale: string): void {
    const row = new PopupMenu.PopupBaseMenuItem({ activate: false });
    row.reactive = !this._running;

    const buttonLabel = new St.Label({
      text: this._running ? _("Refreshing…") : _("Force refresh"),
      x_expand: true,
      x_align: Clutter.ActorAlign.START,
    });
    row.add_child(buttonLabel);

    if (lastRefreshAt !== null && Number.isFinite(lastRefreshAt)) {
      const lastRefreshLabel = new St.Label({
        text: `${_("Last refresh:")} ${formatAbsoluteTimestamp(lastRefreshAt, locale)}`,
        style_class: "provider-limits-dim",
        x_align: Clutter.ActorAlign.END,
      });
      row.add_child(lastRefreshLabel);
    }

    const spinner = new Spinner(14, { animate: true, hideOnStop: true });
    spinner.add_style_class_name("provider-limits-refresh-spinner");
    spinner.visible = this._running;
    if (this._running) spinner.play();
    row.add_child(spinner);

    row.connect("button-release-event", () => {
      if (!this._running) this._onRefresh?.();
      return Clutter.EVENT_STOP;
    });

    this._refreshRow = row;
    this._refreshButtonLabel = buttonLabel;
    this._refreshSpinner = spinner;
    this.addMenuItem(row);
  }

  private _getProviderDisplayName(name: ProviderName): string {
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
