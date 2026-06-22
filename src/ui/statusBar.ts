import Clutter from "gi://Clutter";
import type Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";

import { formatField } from "../formatters.js";
import type { FieldType, ReaderResult } from "../readers/base.js";
import { ReaderStatus } from "../readers/base.js";

export class StatusBarWidget extends St.BoxLayout {
  private _settings: Gio.Settings;
  private _providerWidgets: Map<string, St.Label>;

  constructor(settings: Gio.Settings) {
    super({
      style_class: "provider-limits-status-bar",
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._settings = settings;
    this._providerWidgets = new Map();
  }

  render(results: Map<string, ReaderResult>): void {
    const order = this._settings.get_strv("providers-order");
    const locale = this._getLocale();

    // Clear existing
    for (const widget of this._providerWidgets.values()) {
      this.remove_child(widget);
    }
    this._providerWidgets.clear();

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
      const label = new St.Label({
        text: this._getProviderLabel(name),
        style_class: "provider-limits-provider-label",
        y_align: Clutter.ActorAlign.CENTER,
      });
      this.add_child(label);

      // Fields
      const statusFields = this._settings.get_strv(`${name}-status-fields`);
      for (const fieldName of statusFields) {
        const field = result.fields.find((f) => f.name === fieldName);
        if (!field) continue;

        const text = formatField({
          type: this._getFieldType(name, fieldName),
          value: field.value,
          zone: "status",
          locale,
        });

        const fieldLabel = new St.Label({
          text,
          y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(fieldLabel);
      }
    }
  }

  private _getLocale(): string {
    const lang = this._settings.get_string("language");
    if (lang && lang.trim()) return lang.trim();

    const envLang = GLib.getenv("LC_MESSAGES") ?? GLib.getenv("LANG") ?? "en";
    return envLang.split(".")[0].replace("_", "_");
  }

  private _getProviderLabel(name: string): string {
    const labels: Record<string, string> = {
      codex: "codex",
      claude: "claude",
      opencode: "opc",
    };
    return labels[name] ?? name;
  }

  private _getFieldType(providerName: string, fieldName: string): FieldType {
    // TODO: look up from reader.FIELDS — for scaffold, return 'text'
    void providerName;
    void fieldName;
    return "text";
  }
}
