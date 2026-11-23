import Clutter from "gi://Clutter";
import St from "gi://St";

import { ReaderStatus } from "../readers/base.js";
import { StatusBarRenderer } from "./statusBarRenderer.js";
import { applyStatusAttentionClass } from "./tone.js";
import type { ProviderViewContext } from "./viewContext.js";
import { phaseResult, statusCompactMessages } from "./viewMessages.js";

/** Rebuilds the compact status bar from one freshly derived view. */
export class CompactStatusBarRenderer extends StatusBarRenderer {
  protected override renderView(context: ProviderViewContext): void {
    if (
      this.renderPlaceholder(phaseResult(context, statusCompactMessages), (message) => {
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

    context.models.forEach((model, index) => {
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
        const prefix = model.result.status === ReaderStatus.PARTIAL ? "~" : "";
        metricsText = joined ? `${prefix}${joined}` : prefix;
        const spokenRows = model.statusViews.map((view) => view.accessibleText).join(", ");
        const headerPart = badgeWord ? `${shortLabel} ${badgeWord}` : shortLabel;
        accessibleText = spokenRows ? `${headerPart}: ${spokenRows}` : headerPart;
      }

      const segment = new St.BoxLayout({
        style_class:
          index > 0
            ? "provider-limits-status-segment provider-limits-status-segment-divided"
            : "provider-limits-status-segment",
        y_align: Clutter.ActorAlign.CENTER,
      });
      segment.accessible_name = accessibleText;

      const nameLabel = new St.Label({
        text: shortLabel,
        style_class: "provider-limits-provider-label",
        y_align: Clutter.ActorAlign.CENTER,
      });
      nameLabel.accessible_name = shortLabel;
      segment.add_child(nameLabel);

      let metricsLabel: St.Label | null = null;
      if (metricsText) {
        metricsLabel = new St.Label({
          text: metricsText,
          style_class: "provider-limits-status-metrics provider-limits-tnum",
          y_align: Clutter.ActorAlign.CENTER,
        });
        metricsLabel.accessible_name = accessibleText;
        segment.add_child(metricsLabel);
      }

      applyStatusAttentionClass(segment, metricsLabel ?? nameLabel, health.attention);
      this.parent.add_child(segment);
    });
  }
}
