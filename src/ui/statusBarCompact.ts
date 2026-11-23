import Clutter from "gi://Clutter";
import St from "gi://St";

import type { ProviderName } from "../constants.js";
import { ReaderStatus } from "../readers/base.js";
import { formatViewText } from "./fieldViews.js";
import { statusBadgeText } from "./providerHealth.js";
import type { ProviderAttention } from "./providerHealth.js";
import { StatusBarRenderer, type ZonePlan } from "./statusBarRenderer.js";
import { applyStatusAttentionClass } from "./tone.js";
import type { ProviderViewContext } from "./viewContext.js";
import { phaseResult } from "./viewMessages.js";

interface CompactBadgePlan {
  provider: ProviderName;
  shortLabel: string;
  metricsText: string;
  attention: ProviderAttention;
  accessibleText: string;
}

type CompactPlan = ZonePlan<CompactBadgePlan>;

function planCompact(context: ProviderViewContext): CompactPlan {
  const phase = phaseResult(context, "compact", false);
  if (phase.kind === "placeholder") {
    return {
      kind: "placeholder",
      phase: phase.phase,
      placeholder: phase.message.placeholder,
      placeholderAccessibleText: phase.message.accessibleText,
      showPlaceholder: phase.message.showPlaceholder,
    };
  }

  const segments: CompactBadgePlan[] = context.models.map((model) => {
    const shortLabel = model.shortDisplayName || model.provider;
    const badgeWord = statusBadgeText(model.health, context.t);

    if (model.health.state === "error" || model.health.state === "unavailable") {
      return {
        provider: model.provider,
        shortLabel,
        metricsText: "!",
        attention: model.health.attention,
        accessibleText: `${shortLabel} ${badgeWord}`.trim(),
      };
    }

    const viewTexts = model.statusViews.map((view) =>
      formatViewText(view, "status", context.locale, context.t),
    );
    const joined = viewTexts.map((text) => text.valueText).join("·");
    const prefix = model.result.status === ReaderStatus.PARTIAL ? "~" : "";
    const metricsText = joined ? `${prefix}${joined}` : prefix;
    const spokenRows = viewTexts.map((text) => text.accessibleText).join(", ");
    const headerPart = badgeWord ? `${shortLabel} ${badgeWord}` : shortLabel;
    const accessibleText = spokenRows ? `${headerPart}: ${spokenRows}` : headerPart;

    return {
      provider: model.provider,
      shortLabel,
      metricsText,
      attention: model.health.attention,
      accessibleText,
    };
  });

  return { kind: "segments", segments };
}

/** Rebuilds the compact status bar from one freshly derived plan. */
export class CompactStatusBarRenderer extends StatusBarRenderer<CompactPlan> {
  protected plan(context: ProviderViewContext): CompactPlan {
    return planCompact(context);
  }

  protected renderPlan(plan: CompactPlan): void {
    if (plan.kind === "placeholder") {
      if (!plan.showPlaceholder) return;
      const placeholder = new St.Label({
        text: plan.placeholder ?? "",
        style_class: "provider-limits-status-placeholder provider-limits-tnum",
        y_align: Clutter.ActorAlign.CENTER,
      });
      placeholder.accessible_name = plan.placeholderAccessibleText;
      this.parent.add_child(placeholder);
      return;
    }

    plan.segments.forEach((badge, index) => {
      const segment = new St.BoxLayout({
        style_class:
          index > 0
            ? "provider-limits-status-segment provider-limits-status-segment-divided"
            : "provider-limits-status-segment",
        y_align: Clutter.ActorAlign.CENTER,
      });
      segment.accessible_name = badge.accessibleText;

      const nameLabel = new St.Label({
        text: badge.shortLabel,
        style_class: "provider-limits-provider-label",
        y_align: Clutter.ActorAlign.CENTER,
      });
      nameLabel.accessible_name = badge.shortLabel;
      segment.add_child(nameLabel);

      let metricsLabel: St.Label | null = null;
      if (badge.metricsText) {
        metricsLabel = new St.Label({
          text: badge.metricsText,
          style_class: "provider-limits-status-metrics provider-limits-tnum",
          y_align: Clutter.ActorAlign.CENTER,
        });
        metricsLabel.accessible_name = badge.accessibleText;
        segment.add_child(metricsLabel);
      }

      applyStatusAttentionClass(segment, metricsLabel ?? nameLabel, badge.attention);
      this.parent.add_child(segment);
    });
  }
}
