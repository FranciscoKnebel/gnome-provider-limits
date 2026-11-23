import Clutter from "gi://Clutter";
import St from "gi://St";

import type { ProviderName } from "../constants.js";
import { ReaderStatus } from "../readers/base.js";
import { connectRepaint, drawMicroRing } from "./cairoDrawing.js";
import { displayFacts } from "./displayModel.js";
import type { FieldView } from "./fieldViews.js";
import type { GaugeSpec } from "./gaugeTypes.js";
import { StatusBarRenderer, type ZonePlan } from "./statusBarRenderer.js";
import { STYLE_REGISTRY } from "./styles.js";
import { applyToneClass } from "./tone.js";
import type { ProviderViewContext } from "./viewContext.js";
import { phaseResult } from "./viewMessages.js";

const MICRO_GAUGE_SIZE = 14;

interface GaugeRowPlan {
  readonly view: FieldView;
  readonly valueText: string;
  readonly accessibleText: string;
}

interface GaugeSegmentPlan {
  provider: ProviderName;
  displayName: string;
  status: ReaderStatus;
  meter: GaugeSpec;
  rows: readonly GaugeRowPlan[];
}

type GaugesPlan = ZonePlan<GaugeSegmentPlan>;

function planGauges(context: ProviderViewContext): GaugesPlan {
  const phase = phaseResult(context, STYLE_REGISTRY.statusBar.gauges, false);
  if (phase.kind === "placeholder") {
    return {
      kind: "placeholder",
      phase: phase.phase,
      placeholder: phase.message.placeholder,
      placeholderAccessibleText: phase.message.accessibleText,
      showPlaceholder: phase.message.showPlaceholder,
    };
  }

  const segments: GaugeSegmentPlan[] = context.models.map((model) => ({
    provider: model.provider,
    displayName: model.shortDisplayName,
    status: model.result.status,
    meter: displayFacts(model).meter,
    rows: model.statusViews.map((view) => ({
      view,
      valueText: view.valueText,
      accessibleText: view.accessibleText,
    })),
  }));

  return { kind: "segments", segments };
}

/** Rebuilds the micro-gauge status bar from one freshly derived plan. */
export class GaugesStatusBarRenderer extends StatusBarRenderer<GaugesPlan> {
  protected plan(context: ProviderViewContext): GaugesPlan {
    return planGauges(context);
  }

  protected override renderPlan(plan: GaugesPlan): void {
    if (
      this.renderPlaceholder(plan, (placeholder) => {
        const label = new St.Label({
          text: placeholder.placeholder ?? "",
          style_class: "pl-status-placeholder",
          y_align: Clutter.ActorAlign.CENTER,
        });
        label.accessible_name = placeholder.placeholderAccessibleText;
        return label;
      })
    ) {
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
      connectRepaint(gaugeArea, drawMicroRing, segmentPlan.meter);
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
        applyToneClass(valueLabel, row.view.tone);
        segment.add_child(valueLabel);
      }

      this.parent.add_child(segment);
    }
  }
}
