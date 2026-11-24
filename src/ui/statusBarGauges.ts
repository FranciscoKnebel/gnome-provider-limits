import Clutter from "gi://Clutter";
import St from "gi://St";

import type { ProviderName } from "../constants.js";
import { gettext as _ } from "../helpers/gettext.js";
import { ReaderStatus } from "../readers/base.js";
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
import type { StatusBarRenderContext, StatusBarRenderer } from "./statusBar.js";
import { applyToneClass } from "./tone.js";

const MICRO_GAUGE_SIZE = 14;

interface GaugeSegmentPlan {
  provider: ProviderName;
  displayName: string;
  status: ReaderStatus;
  meter: MicroMeterSpec;
  rows: FieldRow[];
  key: string;
}

type GaugesPlan =
  | { readonly kind: "placeholder"; readonly hasEnabled: boolean; readonly key: string }
  | { readonly kind: "segments"; readonly segments: GaugeSegmentPlan[]; readonly key: string };

interface GaugeSegmentWidgets {
  meter: MicroMeterSpec;
  gaugeArea: St.DrawingArea;
  values: St.Label[];
}

export class GaugesStatusBarRenderer implements StatusBarRenderer {
  private _segments: GaugeSegmentWidgets[] = [];
  private _context: StatusBarRenderContext | null = null;
  private _plan: GaugesPlan | null = null;

  constructor(private readonly _parent: St.BoxLayout) {}

  statusKey(context: StatusBarRenderContext): string {
    return this._planFor(context).key;
  }

  build(context: StatusBarRenderContext): void {
    const plan = this._planFor(context);

    if (plan.kind === "placeholder") {
      if (!plan.hasEnabled) return;
      const placeholder = new St.Label({
        text: "…",
        style_class: "pl-status-placeholder",
        y_align: Clutter.ActorAlign.CENTER,
      });
      placeholder.accessible_name = _("Refreshing…");
      this._parent.add_child(placeholder);
      return;
    }

    for (const segmentPlan of plan.segments) {
      const segment = new St.BoxLayout({
        style_class: "pl-micro-gauge-segment",
        y_align: Clutter.ActorAlign.CENTER,
      });

      const gaugeArea = new St.DrawingArea({
        width: MICRO_GAUGE_SIZE,
        height: MICRO_GAUGE_SIZE,
        style_class: "pl-micro-gauge-canvas",
        y_align: Clutter.ActorAlign.CENTER,
      });
      const segmentWidgets: GaugeSegmentWidgets = {
        meter: segmentPlan.meter,
        gaugeArea,
        values: [],
      };

      gaugeArea.connect("repaint", (area: St.DrawingArea) => {
        const rawCr = area.get_context();
        if (!isCairoContext(rawCr)) return;
        try {
          const [w, h] = area.get_surface_size();
          drawMicroRing(rawCr, w, h, segmentWidgets.meter);
        } finally {
          disposeCairoContext(rawCr);
        }
      });
      segment.add_child(gaugeArea);

      const nameLabel = new St.Label({
        text: segmentPlan.displayName,
        style_class: "provider-limits-provider-label",
        y_align: Clutter.ActorAlign.CENTER,
      });
      segment.add_child(nameLabel);

      segmentWidgets.values = segmentPlan.rows.map((row) => {
        const valueLabel = new St.Label({
          text: row.valueText,
          style_class: "pl-status-value",
          y_align: Clutter.ActorAlign.CENTER,
        });
        valueLabel.accessible_name = row.accessibleText ?? `${row.label}: ${row.valueText}`;
        applyToneClass(valueLabel, row.tone);
        segment.add_child(valueLabel);
        return valueLabel;
      });

      this._parent.add_child(segment);
      this._segments.push(segmentWidgets);
    }
  }

  update(context: StatusBarRenderContext): void {
    const plan = this._planFor(context);
    if (plan.kind === "placeholder") return;

    plan.segments.forEach((segmentPlan, index) => {
      const widgets = this._segments[index];
      if (!widgets) return;

      widgets.meter = segmentPlan.meter;
      widgets.gaugeArea.queue_repaint();

      segmentPlan.rows.forEach((row, rowIndex) => {
        const valueLabel = widgets.values[rowIndex];
        if (!valueLabel) return;
        valueLabel.text = row.valueText;
        valueLabel.accessible_name = row.accessibleText ?? `${row.label}: ${row.valueText}`;
        applyToneClass(valueLabel, row.tone);
      });
    });
  }

  dispose(): void {
    let child = this._parent.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      child.destroy();
      child = next;
    }
    this._segments = [];
    this._context = null;
    this._plan = null;
  }

  private _planFor(context: StatusBarRenderContext): GaugesPlan {
    if (this._context === context && this._plan) return this._plan;

    if (context.results.size === 0) {
      this._plan = {
        kind: "placeholder",
        hasEnabled: context.hasEnabledProviders,
        key: structureKey([context.locale, context.hasEnabledProviders ? "loading" : "empty"]),
      };
      this._context = context;
      return this._plan;
    }

    const segments: GaugeSegmentPlan[] = [];
    for (const name of context.order) {
      const result = context.results.get(name);
      if (!result || result.status === ReaderStatus.DISABLED) continue;

      const statusFields = context.statusFields(name);
      const displayName = context.shortDisplayName(name);
      const fieldDefs = context.fieldDefs(name);
      const meter = computeStatusMicroMeter(fieldDefs, result, statusFields);
      const rows = getFieldRows(fieldDefs, result, statusFields, "status", context.locale, (text) =>
        context.t(text),
      );

      segments.push({
        provider: name,
        displayName,
        status: result.status,
        meter,
        rows,
        key: sectionKey({
          provider: name,
          displayName,
          status: result.status,
          locale: context.locale,
          rows,
          hasDetail: false,
          hasError:
            result.status === ReaderStatus.ERROR || result.status === ReaderStatus.UNAVAILABLE,
          hasTimestamp: false,
        }),
      });
    }

    this._plan = {
      kind: "segments",
      segments,
      key: structureKey([context.locale, ...segments.map((segment) => segment.key)]),
    };
    this._context = context;
    return this._plan;
  }
}
