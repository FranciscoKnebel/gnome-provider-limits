import Clutter from "gi://Clutter";
import St from "gi://St";

import { connectRepaint, drawMicroRing } from "./cairoDrawing.js";
import { StatusBarRenderer } from "./statusBarRenderer.js";
import { buildStatusSegment, statusValueLabels } from "./statusBarSegments.js";
import type { ProviderViewContext } from "./viewContext.js";
import { statusGaugesMessages } from "./viewMessages.js";

const MICRO_GAUGE_SIZE = 14;

/** Rebuilds the micro-gauge status bar from one freshly derived view. */
export class GaugesStatusBarRenderer extends StatusBarRenderer {
  protected override renderView(context: ProviderViewContext): void {
    if (
      this.renderPlaceholderFor(context, statusGaugesMessages, (message) => {
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

    this.renderSegments(context.models, (model) =>
      buildStatusSegment(model, { segmentClass: "pl-micro-gauge-segment" }, (current) => {
        const gaugeArea = new St.DrawingArea({
          width: MICRO_GAUGE_SIZE,
          height: MICRO_GAUGE_SIZE,
          style_class: "pl-micro-gauge-canvas",
          y_align: Clutter.ActorAlign.CENTER,
        });
        connectRepaint(gaugeArea, drawMicroRing, current.facts.meter);
        return { beforeName: [gaugeArea], afterName: statusValueLabels(current) };
      }),
    );
  }
}
