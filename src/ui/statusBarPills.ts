import Clutter from "gi://Clutter";
import St from "gi://St";

import { ReaderStatus } from "../readers/base.js";
import { StatusBarRenderer } from "./statusBarRenderer.js";
import { buildStatusSegment, statusValueLabels } from "./statusBarSegments.js";
import { applyHealthToneClass } from "./tone.js";
import type { ProviderViewContext } from "./viewContext.js";
import { pillsMessages } from "./viewMessages.js";

/** Rebuilds the status bar pills from one freshly derived view. */
export class PillsStatusBarRenderer extends StatusBarRenderer {
  protected override renderView(context: ProviderViewContext): void {
    if (
      this.renderPlaceholderFor(context, pillsMessages, (message) => {
        const loadingPill = new St.BoxLayout({
          style_class: "pl-status-pill pl-status-pill-loading",
          y_align: Clutter.ActorAlign.CENTER,
        });
        const dot = new St.BoxLayout({
          style_class: "pl-health-dot",
          y_align: Clutter.ActorAlign.CENTER,
        });
        applyHealthToneClass(dot, "idle");
        loadingPill.add_child(dot);

        const loadingLabel = new St.Label({
          text: message.placeholder,
          style_class: "pl-status-value pl-status-loading-label",
          y_align: Clutter.ActorAlign.CENTER,
        });
        loadingLabel.accessible_name = message.accessibleText;
        loadingPill.add_child(loadingLabel);
        return loadingPill;
      })
    ) {
      return;
    }

    this.renderSegments(context.models, (model) => {
      const { health } = model.facts;
      const isPartial = model.facts.displayStatus === ReaderStatus.PARTIAL;
      const stateTag = health.stateTag;

      return buildStatusSegment(
        model,
        {
          segmentClass: isPartial ? "pl-status-pill pl-status-pill-partial" : "pl-status-pill",
          nameClass: "provider-limits-provider-label pl-status-name",
          nameAccessible: true,
        },
        (current) => {
          const dot = new St.BoxLayout({
            style_class: "pl-health-dot",
            y_align: Clutter.ActorAlign.CENTER,
          });
          applyHealthToneClass(dot, current.facts.health.tone);

          const afterName: St.Widget[] = [];
          if (stateTag) {
            const stateLabel = new St.Label({
              text: stateTag,
              style_class: isPartial
                ? "pl-status-cached-tag"
                : "provider-limits-error pl-status-error-tag",
              y_align: Clutter.ActorAlign.CENTER,
            });
            stateLabel.accessible_name = health.stateAccessibleText ?? stateTag;
            afterName.push(stateLabel);
          }
          afterName.push(...statusValueLabels(current));
          return { beforeName: [dot], afterName };
        },
      );
    });
  }
}
