import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import St from "gi://St";

import { resolveLocale } from "../helpers/locale.js";
import { providerDisplayNameShort } from "../helpers/provider-settings.js";
import type { BaseReader, ReaderResult } from "../readers/base.js";
import { ReaderStatus } from "../readers/base.js";
import { getFieldRows } from "./fieldRows.js";

export const StatusBarWidget = GObject.registerClass(
  class StatusBarWidget extends St.BoxLayout {
    declare _settings: Gio.Settings;
    declare _readers: Map<string, BaseReader>;

    _init(settings: Gio.Settings, readers: Map<string, BaseReader>) {
      super._init({
        style_class: "provider-limits-status-bar",
        y_align: Clutter.ActorAlign.CENTER,
      });
      this._settings = settings;
      this._readers = readers;
    }

    render(results: Map<string, ReaderResult>): void {
      const order = this._settings.get_strv("providers-order");
      const locale = resolveLocale(
        this._settings.get_string("language"),
        GLib.getenv("LC_MESSAGES"),
        GLib.getenv("LANG"),
      );

      // Destroy all existing children to avoid accumulation on re-render
      let child = this.get_first_child();
      while (child) {
        const next = child.get_next_sibling();
        child.destroy();
        child = next;
      }

      let isFirst = true;

      for (const name of order) {
        const result = results.get(name);
        if (!result) continue;
        if (result.status === ReaderStatus.DISABLED) continue;

        // Separator between providers
        if (!isFirst) {
          const sep = new St.Label({
            text: " · ",
            style_class: "provider-limits-separator",
            y_align: Clutter.ActorAlign.CENTER,
          });
          this.add_child(sep);
        }
        isFirst = false;

        // Provider label
        const labelText = this._getProviderLabel(name);
        const label = new St.Label({
          text: labelText,
          style_class: "provider-limits-provider-label",
          y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(label);

        // Fields
        const reader = this._readers.get(name);
        const fieldNames = this._settings.get_strv(`${name}-status-fields`);
        const rows = getFieldRows(reader, result, fieldNames, "status", locale);

        for (const rowData of rows) {
          const fieldLabel = new St.Label({
            text: rowData.valueText,
            y_align: Clutter.ActorAlign.CENTER,
          });
          this.add_child(fieldLabel);
        }
      }
    }

    private _getProviderLabel(name: string): string {
      return providerDisplayNameShort(this._settings, name);
    }
  },
);
