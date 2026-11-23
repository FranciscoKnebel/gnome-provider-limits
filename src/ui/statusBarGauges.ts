import Clutter from "gi://Clutter";
import St from "gi://St";

import type { ProviderName } from "../constants.js";
import { ReaderStatus } from "../readers/base.js";
import { disposeCairoContext, drawMicroRing, isCairoContext } from "./cairoDrawing.js";
import type { FieldView } from "./fieldViews.js";
import type { MicroMeterSpec } from "./gaugeTypes.js";
import { StatusBarRenderer } from "./statusBarRenderer.js";
import { deriveStatusBarSegments } from "./statusBarSegments.js";
import type { StatusBarZonePlan } from "./statusBarSegments.js";
import { applyToneClass } from "./tone.js";
import type { ProviderViewContext } from "./viewContext.js";
import { viewMessages } from "./viewMessages.js";

const MICRO_GAUGE_SIZE = 14;

interface GaugeSegmentPlan {
  provider: ProviderName;
  displayName: string;
  status: ReaderStatus;
  meter: MicroMeterSpec;
  rows: readonly FieldView[];
}

type GaugesPlan = StatusBarZonePlan<GaugeSegmentPlan>;

function planGauges(context: ProviderViewContext): GaugesPlan {
  if (context.phase !== "ready") {
    const message = viewMessages({
      phase: context.phase,
      surface: "gauges",
      t: context.t,
      running: false,
    });
    return {
      kind: "placeholder",
      phase: context.phase,
      placeholder: message.placeholder,
      placeholderAccessibleText: message.accessibleText,
      showPlaceholder: message.showPlaceholder,
    };
  }

  const segments: GaugeSegmentPlan[] = deriveStatusBarSegments(context).map((segment) => ({
    provider: segment.provider,
    displayName: segment.displayName,
    status: segment.result.status,
    meter: segment.meter,
    rows: segment.views,
  }));

  return { kind: "segments", segments };
}

/** Rebuilds the micro-gauge status bar from one freshly derived plan. */
export class GaugesStatusBarRenderer extends StatusBarRenderer<GaugesPlan> {
  protected plan(context: ProviderViewContext): GaugesPlan {
    return planGauges(context);
  }

  protected renderPlan(plan: GaugesPlan): void {
    if (plan.kind === "placeholder") {
      if (!plan.showPlaceholder) return;
      const placeholder = new St.Label({
        text: plan.placeholder ?? "",
        style_class: "pl-status-placeholder",
        y_align: Clutter.ActorAlign.CENTER,
      });
      placeholder.accessible_name = plan.placeholderAccessibleText;
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
      const meter = segmentPlan.meter;

      gaugeArea.connect("repaint", (area: St.DrawingArea) => {
        const rawCr = area.get_context();
        if (!isCairoContext(rawCr)) return;
        try {
          const [w, h] = area.get_surface_size();
          drawMicroRing(rawCr, w, h, meter);
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

      for (const row of segmentPlan.rows) {
        const valueLabel = new St.Label({
          text: row.valueText,
          style_class: "pl-status-value",
          y_align: Clutter.ActorAlign.CENTER,
        });
        valueLabel.accessible_name = row.accessibleText;
        applyToneClass(valueLabel, row.tone);
        segment.add_child(valueLabel);
      }

      this.parent.add_child(segment);
    }
  }
}
