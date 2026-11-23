import Clutter from "gi://Clutter";
import St from "gi://St";

import type { ProviderName } from "../constants.js";
import { gettext as _ } from "../helpers/gettext.js";
import { ReaderStatus } from "../readers/base.js";
import { disposeCairoContext, drawMicroRing, isCairoContext } from "./cairoDrawing.js";
import { computeStatusMicroMeter } from "./cockpitModel.js";
import type { FieldView, StatusBarZonePlan } from "./fieldViews.js";
import { deriveStatusBarSegments } from "./fieldViews.js";
import type { MicroMeterSpec } from "./gaugeTypes.js";
import { sectionKey, structureKey } from "./renderStructure.js";
import { StatusBarRenderer } from "./statusBarRenderer.js";
import { applyToneClass } from "./tone.js";
import type { ProviderViewContext } from "./viewContext.js";

const MICRO_GAUGE_SIZE = 14;

interface GaugeSegmentPlan {
  provider: ProviderName;
  displayName: string;
  status: ReaderStatus;
  meter: MicroMeterSpec;
  rows: readonly FieldView[];
  key: string;
}

type GaugesPlan = StatusBarZonePlan<GaugeSegmentPlan>;

interface GaugeSegmentWidgets {
  meter: MicroMeterSpec;
  gaugeArea: St.DrawingArea;
  values: St.Label[];
}

function planGauges(context: ProviderViewContext): GaugesPlan {
  if (context.phase !== "ready") {
    return {
      kind: "placeholder",
      hasEnabled: context.phase === "loading",
      key: structureKey([context.locale, context.phase]),
    };
  }

  const segments: GaugeSegmentPlan[] = deriveStatusBarSegments(context).map((segment) => ({
    provider: segment.provider,
    displayName: segment.displayName,
    status: segment.result.status,
    meter: computeStatusMicroMeter(
      segment.fieldDefs,
      segment.result,
      segment.statusFields,
      context.locale,
    ),
    rows: segment.views,
    key: sectionKey({
      provider: segment.provider,
      displayName: segment.displayName,
      status: segment.result.status,
      locale: context.locale,
      rows: segment.views,
      hasDetail: false,
      hasError: segment.health.state === "error" || segment.health.state === "unavailable",
      hasTimestamp: false,
    }),
  }));

  return {
    kind: "segments",
    segments,
    key: structureKey([context.locale, ...segments.map((segment) => segment.key)]),
  };
}

export class GaugesStatusBarRenderer extends StatusBarRenderer<GaugesPlan> {
  private _segments: GaugeSegmentWidgets[] = [];

  protected plan(context: ProviderViewContext): GaugesPlan {
    return planGauges(context);
  }

  protected build(plan: GaugesPlan): void {
    if (plan.kind === "placeholder") {
      if (!plan.hasEnabled) return;
      const placeholder = new St.Label({
        text: "…",
        style_class: "pl-status-placeholder",
        y_align: Clutter.ActorAlign.CENTER,
      });
      placeholder.accessible_name = _("Refreshing…");
      this.parent.add_child(placeholder);
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
        valueLabel.accessible_name = row.accessibleText;
        applyToneClass(valueLabel, row.tone);
        segment.add_child(valueLabel);
        return valueLabel;
      });

      this.parent.add_child(segment);
      this._segments.push(segmentWidgets);
    }
  }

  protected update(plan: GaugesPlan): void {
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
        valueLabel.accessible_name = row.accessibleText;
        applyToneClass(valueLabel, row.tone);
      });
    });
  }

  protected onDispose(): void {
    this._segments = [];
  }
}
