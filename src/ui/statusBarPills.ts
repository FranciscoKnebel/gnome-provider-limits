import Clutter from "gi://Clutter";
import St from "gi://St";

import { ReaderStatus } from "../readers/base.js";
import { StatusBarRenderer } from "./statusBarRenderer.js";
import { applyHealthToneClass, applyToneClass } from "./tone.js";
import type { ProviderViewContext } from "./viewContext.js";
import { phaseResult, pillsMessages } from "./viewMessages.js";

/** Rebuilds the status bar pills from one freshly derived view. */
export class PillsStatusBarRenderer extends StatusBarRenderer {
  protected override renderView(context: ProviderViewContext): void {
    if (
      this.renderPlaceholder(phaseResult(context, pillsMessages), (message) => {
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

    for (const model of context.models) {
      const { health } = model.facts;
      const isPartial = model.result.status === ReaderStatus.PARTIAL;
      const stateTag = health.stateTag;

      const pill = new St.BoxLayout({
        style_class: isPartial ? "pl-status-pill pl-status-pill-partial" : "pl-status-pill",
        y_align: Clutter.ActorAlign.CENTER,
      });

      const dot = new St.BoxLayout({
        style_class: "pl-health-dot",
        y_align: Clutter.ActorAlign.CENTER,
      });
      applyHealthToneClass(dot, health.tone);
      pill.add_child(dot);

      const nameLabel = new St.Label({
        text: model.shortDisplayName,
        style_class: "provider-limits-provider-label pl-status-name",
        y_align: Clutter.ActorAlign.CENTER,
      });
      nameLabel.accessible_name = model.shortDisplayName;
      pill.add_child(nameLabel);

      if (stateTag) {
        const stateLabel = new St.Label({
          text: stateTag,
          style_class: isPartial
            ? "pl-status-cached-tag"
            : "provider-limits-error pl-status-error-tag",
          y_align: Clutter.ActorAlign.CENTER,
        });
        stateLabel.accessible_name = health.stateAccessibleText ?? stateTag;
        pill.add_child(stateLabel);
      }

      for (const view of model.statusViews) {
        const valueLabel = new St.Label({
          text: view.valueText,
          style_class: "pl-status-value",
          y_align: Clutter.ActorAlign.CENTER,
        });
        valueLabel.accessible_name = view.accessibleText;
        applyToneClass(valueLabel, view.tone);
        pill.add_child(valueLabel);
      }

      this.parent.add_child(pill);
    }
  }
}
