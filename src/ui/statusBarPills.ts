import Clutter from "gi://Clutter";
import St from "gi://St";

import type { ProviderName } from "../constants.js";
import { ReaderStatus } from "../readers/base.js";
import type { FieldView } from "./fieldViews.js";
import type { ProviderTone } from "./providerHealth.js";
import { StatusBarRenderer } from "./statusBarRenderer.js";
import type { StatusBarZonePlan } from "./statusBarSegments.js";
import { deriveStatusBarSegments } from "./statusBarSegments.js";
import { applyHealthToneClass, applyToneClass } from "./tone.js";
import type { ProviderViewContext } from "./viewContext.js";
import { viewMessages } from "./viewMessages.js";

interface PillPlan {
  provider: ProviderName;
  displayName: string;
  isPartial: boolean;
  healthTone: ProviderTone;
  stateTag: string | null;
  stateAccessibleText: string | null;
  rows: readonly FieldView[];
}

type PillsPlan = StatusBarZonePlan<PillPlan>;

function planPills(context: ProviderViewContext): PillsPlan {
  const message = viewMessages({
    phase: context.phase,
    surface: "pills",
    t: context.t,
    running: false,
  });
  if (message.showPlaceholder) {
    return {
      kind: "placeholder",
      phase: context.phase,
      placeholder: message.placeholder,
      placeholderAccessibleText: message.accessibleText,
      showPlaceholder: true,
    };
  }

  const segments: PillPlan[] = deriveStatusBarSegments(context).map((segment) => ({
    provider: segment.provider,
    displayName: segment.displayName,
    isPartial: segment.result.status === ReaderStatus.PARTIAL,
    healthTone: segment.health.tone,
    stateTag: segment.health.stateTag,
    stateAccessibleText: segment.health.stateAccessibleText,
    rows: segment.views,
  }));
  return { kind: "segments", segments };
}

/** Rebuilds the status bar pills from one freshly derived plan. */
export class PillsStatusBarRenderer extends StatusBarRenderer<PillsPlan> {
  protected plan(context: ProviderViewContext): PillsPlan {
    return planPills(context);
  }

  protected renderPlan(plan: PillsPlan): void {
    if (plan.kind === "placeholder") {
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
        text: plan.placeholder ?? "",
        style_class: "pl-status-value pl-status-loading-label",
        y_align: Clutter.ActorAlign.CENTER,
      });
      loadingLabel.accessible_name = plan.placeholderAccessibleText;
      loadingPill.add_child(loadingLabel);
      this.parent.add_child(loadingPill);
      return;
    }

    for (const pillPlan of plan.segments) {
      const pill = new St.BoxLayout({
        style_class: pillPlan.isPartial
          ? "pl-status-pill pl-status-pill-partial"
          : "pl-status-pill",
        y_align: Clutter.ActorAlign.CENTER,
      });

      const dot = new St.BoxLayout({
        style_class: "pl-health-dot",
        y_align: Clutter.ActorAlign.CENTER,
      });
      applyHealthToneClass(dot, pillPlan.healthTone);
      pill.add_child(dot);

      const nameLabel = new St.Label({
        text: pillPlan.displayName,
        style_class: "provider-limits-provider-label pl-status-name",
        y_align: Clutter.ActorAlign.CENTER,
      });
      nameLabel.accessible_name = pillPlan.displayName;
      pill.add_child(nameLabel);

      if (pillPlan.stateTag) {
        const stateLabel = new St.Label({
          text: pillPlan.stateTag,
          style_class: pillPlan.isPartial
            ? "pl-status-cached-tag"
            : "provider-limits-error pl-status-error-tag",
          y_align: Clutter.ActorAlign.CENTER,
        });
        stateLabel.accessible_name = pillPlan.stateAccessibleText ?? pillPlan.stateTag;
        pill.add_child(stateLabel);
      }

      for (const row of pillPlan.rows) {
        const valueLabel = new St.Label({
          text: row.valueText,
          style_class: "pl-status-value",
          y_align: Clutter.ActorAlign.CENTER,
        });
        valueLabel.accessible_name = row.accessibleText ?? `${row.label}: ${row.valueText}`;
        applyToneClass(valueLabel, row.tone);
        pill.add_child(valueLabel);
      }

      this.parent.add_child(pill);
    }
  }
}
