import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import type { ProviderName } from "../constants.js";
import { resolveLocale } from "../helpers/locale.js";
import { normalizeProvidersOrder, providerDisplayNameShort } from "../helpers/provider-settings.js";
import type { BaseReader, ReaderResult } from "../readers/base.js";
import { ReaderStatus } from "../readers/base.js";
import { getFieldRows } from "./fieldRows.js";
import type { FieldRow } from "./fieldRows.js";
import { sectionKey } from "./renderStructure.js";
import { applyToneClass } from "./tone.js";

interface SegmentPlan {
  displayName: string;
  status: ReaderStatus;
  rows: FieldRow[];
  key: string;
}

const STRUCTURE_SEPARATOR = "\u0004";

export const StatusBarWidget = GObject.registerClass(
  class StatusBarWidget extends St.BoxLayout {
    declare _settings: Gio.Settings;
    declare _readers: Map<ProviderName, BaseReader>;
    declare _segments: St.Label[][];
    declare _structureKey: string | null;

    _init(settings: Gio.Settings, readers: Map<ProviderName, BaseReader>) {
      super._init({
        style_class: "provider-limits-status-bar",
        y_align: Clutter.ActorAlign.CENTER,
      });
      this._settings = settings;
      this._readers = readers;
      this._segments = [];
      this._structureKey = null;
      this.accessible_name = _("Provider Limits");
    }

    render(results: Map<ProviderName, ReaderResult>): void {
      const order = normalizeProvidersOrder(this._settings.get_strv("providers-order"));
      const locale = resolveLocale(
        this._settings.get_string("language"),
        GLib.getenv("LC_MESSAGES"),
        GLib.getenv("LANG"),
      );

      const plans: SegmentPlan[] = [];

      for (const name of order) {
        const result = results.get(name);
        if (!result) continue;
        if (result.status === ReaderStatus.DISABLED) continue;

        const displayName = providerDisplayNameShort(this._settings, name);
        const rows = getFieldRows(
          this._readers.get(name),
          result,
          this._settings.get_strv(`${name}-status-fields`),
          "status",
          locale,
          _,
        );

        plans.push({
          displayName,
          status: result.status,
          rows,
          key: sectionKey({
            provider: name,
            displayName,
            status: result.status,
            locale,
            rows,
            hasDetail: false,
            hasError:
              result.status === ReaderStatus.ERROR || result.status === ReaderStatus.UNAVAILABLE,
            hasTimestamp: false,
          }),
        });
      }

      const structureKey = [locale, ...plans.map((plan) => plan.key)].join(STRUCTURE_SEPARATOR);
      if (structureKey !== this._structureKey) {
        this._rebuild(plans);
        this._structureKey = structureKey;
        return;
      }

      this._update(plans);
    }

    private _rebuild(plans: SegmentPlan[]): void {
      let child = this.get_first_child();
      while (child) {
        const next = child.get_next_sibling();
        child.destroy();
        child = next;
      }
      this._segments = [];

      plans.forEach((plan, index) => {
        if (index > 0) {
          this.add_child(
            new St.Label({
              text: " · ",
              style_class: "provider-limits-separator",
              y_align: Clutter.ActorAlign.CENTER,
            }),
          );
        }

        const label = new St.Label({
          text: plan.displayName,
          style_class: "provider-limits-provider-label",
          y_align: Clutter.ActorAlign.CENTER,
        });
        label.accessible_name = plan.displayName;
        this.add_child(label);

        this._addStatusSuffix(plan.status);

        const values = plan.rows.map((row) => {
          const valueLabel = new St.Label({
            text: row.valueText,
            y_align: Clutter.ActorAlign.CENTER,
          });
          this._applyRow(valueLabel, row);
          this.add_child(valueLabel);
          return valueLabel;
        });

        this._segments.push(values);
      });
    }

    private _update(plans: SegmentPlan[]): void {
      plans.forEach((plan, index) => {
        const values = this._segments[index];
        if (!values) return;

        plan.rows.forEach((row, rowIndex) => {
          const valueLabel = values[rowIndex];
          if (!valueLabel) return;
          valueLabel.text = row.valueText;
          this._applyRow(valueLabel, row);
        });
      });
    }

    private _applyRow(label: St.Label, row: FieldRow): void {
      label.accessible_name = row.accessibleText ?? `${row.label}: ${row.valueText}`;
      applyToneClass(label, row.tone);
    }

    private _addStatusSuffix(status: ReaderStatus): void {
      const text = this._statusSuffix(status);
      if (!text) return;

      const suffix = new St.Label({
        text,
        style_class: "provider-limits-error",
        y_align: Clutter.ActorAlign.CENTER,
      });
      suffix.accessible_name = text;
      this.add_child(suffix);
    }

    private _statusSuffix(status: ReaderStatus): string {
      switch (status) {
        case ReaderStatus.ERROR:
          return _("(error)");
        case ReaderStatus.UNAVAILABLE:
          return _("(unavailable)");
        default:
          return "";
      }
    }
  },
);
