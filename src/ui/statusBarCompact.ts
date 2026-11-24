import Clutter from "gi://Clutter";
import St from "gi://St";

import { ReaderStatus } from "../readers/base.js";
import { StatusBarRenderer } from "./statusBarRenderer.js";
import { buildStatusSegment } from "./statusBarSegments.js";
import type { ProviderViewContext } from "./viewContext.js";
import { statusCompactMessages } from "./viewMessages.js";

/** Rebuilds the compact status bar from one freshly derived view. */
export class CompactStatusBarRenderer extends StatusBarRenderer {
  protected override renderView(context: ProviderViewContext): void {
    if (
      this.renderPlaceholderFor(context, statusCompactMessages, (message) => {
        const label = new St.Label({
          text: message.placeholder,
          style_class: "provider-limits-status-placeholder provider-limits-tnum",
          y_align: Clutter.ActorAlign.CENTER,
        });
        label.accessible_name = message.accessibleText;
        return label;
      })
    ) {
      return;
    }

    this.renderSegments(context.models, (model, index) => {
      const { health, badges } = model.facts;
      const shortLabel = model.shortDisplayName || model.provider;
      const badgeWord = badges.status;
      let metricsText: string;
      let accessibleText: string;

      if (health.state === "error" || health.state === "unavailable") {
        metricsText = "!";
        accessibleText = `${shortLabel} ${badgeWord}`.trim();
      } else {
        const joined = model.statusViews.map((view) => view.valueText).join("·");
        const prefix = model.status === ReaderStatus.PARTIAL ? "~" : "";
        metricsText = joined ? `${prefix}${joined}` : prefix;
        const spokenRows = model.statusViews.map((view) => view.accessibleText).join(", ");
        const headerPart = badgeWord ? `${shortLabel} ${badgeWord}` : shortLabel;
        accessibleText = spokenRows ? `${headerPart}: ${spokenRows}` : headerPart;
      }

      return buildStatusSegment(
        model,
        {
          segmentClass:
            index > 0
              ? "provider-limits-status-segment provider-limits-status-segment-divided"
              : "provider-limits-status-segment",
          nameText: shortLabel,
          nameAccessible: true,
          accessibleName: accessibleText,
          attention: health.attention,
        },
        () => {
          if (!metricsText) return { beforeName: [], afterName: [] };
          const metricsLabel = new St.Label({
            text: metricsText,
            style_class: "provider-limits-status-metrics provider-limits-tnum",
            y_align: Clutter.ActorAlign.CENTER,
          });
          metricsLabel.accessible_name = accessibleText;
          return { beforeName: [], afterName: [metricsLabel] };
        },
      );
    });
  }
}
