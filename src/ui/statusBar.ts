import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import St from "gi://St";

import type { ProviderName } from "../constants.js";
import { gettext as _ } from "../helpers/gettext.js";
import { resolveLocale } from "../helpers/locale.js";
import { normalizeProvidersOrder, providerDisplayNameShort } from "../helpers/provider-settings.js";
import type { BaseReader, ReaderResult } from "../readers/base.js";
import { ReaderStatus } from "../readers/base.js";
import { PROVIDER_FIELDS } from "../readers/fields.js";
import {
  computeStatusMicroMeter,
  disposeCairoContext,
  drawMicroRing,
  isCairoContext,
} from "./cockpitModel.js";
import type { MicroMeterSpec } from "./cockpitModel.js";
import { getFieldRows } from "./fieldRows.js";
import type { FieldRow } from "./fieldRows.js";
import { sectionKey, structureKey } from "./renderStructure.js";
import { applyToneClass } from "./tone.js";

const MICRO_GAUGE_SIZE = 14;

interface SegmentPlan {
  provider: ProviderName;
  displayName: string;
  status: ReaderStatus;
  meter: MicroMeterSpec;
  rows: FieldRow[];
  key: string;
}

interface SegmentWidgets {
  meter: MicroMeterSpec;
  gaugeArea: St.DrawingArea;
  values: St.Label[];
}

export const StatusBarWidget = GObject.registerClass(
  class StatusBarWidget extends St.BoxLayout {
    declare _settings: Gio.Settings;
    declare _readers: Map<ProviderName, BaseReader>;
    declare _segments: SegmentWidgets[];
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

      if (results.size === 0) {
        const hasEnabled =
          this._readers.size > 0 ||
          order.some((name) => this._settings.get_boolean(`${name}-enabled`));
        const placeholderKey = structureKey([locale, hasEnabled ? "loading" : "empty"]);
        if (placeholderKey !== this._structureKey) {
          this._clearChildren();
          if (hasEnabled) {
            const placeholder = new St.Label({
              text: "…",
              style_class: "pl-status-placeholder",
              y_align: Clutter.ActorAlign.CENTER,
            });
            placeholder.accessible_name = _("Refreshing…");
            this.add_child(placeholder);
          }
          this._structureKey = placeholderKey;
        }
        return;
      }

      const plans: SegmentPlan[] = [];

      for (const name of order) {
        const result = results.get(name);
        if (!result) continue;
        if (result.status === ReaderStatus.DISABLED) continue;

        const reader = this._readers.get(name);
        const fieldsDefs = reader?.FIELDS ?? PROVIDER_FIELDS[name];
        const statusFields = this._settings.get_strv(`${name}-status-fields`);
        const displayName = providerDisplayNameShort(this._settings, name);
        const meter = computeStatusMicroMeter(fieldsDefs, result, statusFields);
        const rows = getFieldRows(reader, result, statusFields, "status", locale, _);

        plans.push({
          provider: name,
          displayName,
          status: result.status,
          meter,
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

      const nextStructureKey = structureKey([locale, ...plans.map((plan) => plan.key)]);
      if (nextStructureKey !== this._structureKey) {
        this._rebuild(plans);
        this._structureKey = nextStructureKey;
        return;
      }

      this._update(plans);
    }

    private _clearChildren(): void {
      let child = this.get_first_child();
      while (child) {
        const next = child.get_next_sibling();
        child.destroy();
        child = next;
      }
      this._segments = [];
    }

    private _rebuild(plans: SegmentPlan[]): void {
      this._clearChildren();

      plans.forEach((plan, index) => {
        if (index > 0) {
          this.add_child(
            new St.Widget({
              style_class: "pl-status-divider",
              y_align: Clutter.ActorAlign.CENTER,
            }),
          );
        }

        const segmentBox = new St.BoxLayout({
          style_class: "pl-status-segment",
          y_align: Clutter.ActorAlign.CENTER,
        });

        const gaugeArea = new St.DrawingArea({
          style_class: "pl-status-gauge",
          width: MICRO_GAUGE_SIZE,
          height: MICRO_GAUGE_SIZE,
          y_align: Clutter.ActorAlign.CENTER,
        });

        const segmentWidgets: SegmentWidgets = {
          meter: plan.meter,
          gaugeArea,
          values: [],
        };

        gaugeArea.connect("repaint", (area: St.DrawingArea) => {
          const rawCr: unknown = area.get_context();
          try {
            if (isCairoContext(rawCr)) {
              const [w, h] = area.get_surface_size();
              drawMicroRing(rawCr, w, h, segmentWidgets.meter);
            }
          } finally {
            disposeCairoContext(rawCr);
          }
        });
        segmentBox.add_child(gaugeArea);

        const label = new St.Label({
          text: plan.displayName,
          style_class: "provider-limits-provider-label pl-status-label",
          y_align: Clutter.ActorAlign.CENTER,
        });
        label.accessible_name = plan.displayName;
        segmentBox.add_child(label);

        const suffixText = this._statusSuffix(plan.status);
        if (suffixText) {
          const suffix = new St.Label({
            text: suffixText,
            style_class: "provider-limits-error pl-status-value",
            y_align: Clutter.ActorAlign.CENTER,
          });
          suffix.accessible_name = suffixText;
          segmentBox.add_child(suffix);
        }

        segmentWidgets.values = plan.rows.map((row) => {
          const valueLabel = new St.Label({
            text: row.valueText,
            style_class: "pl-status-value",
            y_align: Clutter.ActorAlign.CENTER,
          });
          this._applyRow(valueLabel, row);
          segmentBox.add_child(valueLabel);
          return valueLabel;
        });

        this.add_child(segmentBox);
        this._segments.push(segmentWidgets);
        gaugeArea.queue_repaint();
      });
    }

    private _update(plans: SegmentPlan[]): void {
      plans.forEach((plan, index) => {
        const segment = this._segments[index];
        if (!segment) return;

        segment.meter = plan.meter;
        segment.gaugeArea.queue_repaint();

        plan.rows.forEach((row, rowIndex) => {
          const valueLabel = segment.values[rowIndex];
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
