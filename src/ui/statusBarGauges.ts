import Clutter from "gi://Clutter";
import St from "gi://St";

import { connectRepaint, drawMicroRing } from "./cairoDrawing.js";
import { StatusBarRenderer } from "./statusBarRenderer.js";
import { applyToneClass } from "./tone.js";
import type { ProviderViewContext } from "./viewContext.js";
import { phaseResult, statusGaugesMessages } from "./viewMessages.js";

const MICRO_GAUGE_SIZE = 14;

/** Rebuilds the micro-gauge status bar from one freshly derived view. */
export class GaugesStatusBarRenderer extends StatusBarRenderer {
  protected override renderView(context: ProviderViewContext): void {
    if (
      this.renderPlaceholder(phaseResult(context, statusGaugesMessages), (message) => {
        const label = new St.Label({
          text: message.placeholder,
          style_class: "pl-status-placeholder",
          y_align: Clutter.ActorAlign.CENTER,
        });
        label.accessible_name = message.accessibleText;
        return label;
      })
    ) {
      return;
    }

    for (const model of context.models) {
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
      connectRepaint(gaugeArea, drawMicroRing, model.facts.meter);
      segment.add_child(gaugeArea);

      const nameLabel = new St.Label({
        text: model.shortDisplayName,
        style_class: "provider-limits-provider-label",
        y_align: Clutter.ActorAlign.CENTER,
      });
      segment.add_child(nameLabel);

      for (const view of model.statusViews) {
        const valueLabel = new St.Label({
          text: view.valueText,
          style_class: "pl-status-value",
          y_align: Clutter.ActorAlign.CENTER,
        });
        valueLabel.accessible_name = view.accessibleText;
        applyToneClass(valueLabel, view.tone);
        segment.add_child(valueLabel);
      }

      this.parent.add_child(segment);
    }
  }
}
