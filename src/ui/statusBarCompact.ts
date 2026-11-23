import Clutter from "gi://Clutter";
import St from "gi://St";

import type { ProviderName } from "../constants.js";
import { ReaderStatus } from "../readers/base.js";
import { formatViewText } from "./fieldViews.js";
import { statusBadgeText } from "./providerHealth.js";
import type { ProviderAttention } from "./providerHealth.js";
import { StatusBarRenderer } from "./statusBarRenderer.js";
import type { StatusBarZonePlan } from "./statusBarSegments.js";
import { deriveStatusBarSegments } from "./statusBarSegments.js";
import { applyStatusAttentionClass } from "./tone.js";
import type { ProviderViewContext } from "./viewContext.js";
import { viewMessages } from "./viewMessages.js";

interface CompactBadgePlan {
  provider: ProviderName;
  shortLabel: string;
  metricsText: string;
  attention: ProviderAttention;
  accessibleText: string;
}

type CompactPlan = StatusBarZonePlan<CompactBadgePlan>;

function planCompact(context: ProviderViewContext): CompactPlan {
  const message = viewMessages({
    phase: context.phase,
    surface: "compact",
    running: false,
    t: context.t,
  });

  if (context.phase !== "ready") {
    return {
      kind: "placeholder",
      phase: context.phase,
      placeholder: message.placeholder,
      placeholderAccessibleText: message.accessibleText,
      showPlaceholder: message.showPlaceholder,
    };
  }

  const segments: CompactBadgePlan[] = deriveStatusBarSegments(context).map((segment) => {
    const shortLabel = segment.displayName || segment.provider;
    const badgeWord = statusBadgeText(segment.health, context.t);

    if (segment.health.state === "error" || segment.health.state === "unavailable") {
      return {
        provider: segment.provider,
        shortLabel,
        metricsText: "!",
        attention: segment.health.attention,
        accessibleText: `${shortLabel} ${badgeWord}`.trim(),
      };
    }

    const viewTexts = segment.views.map((view) =>
      formatViewText(view, "status", context.locale, context.t),
    );
    const joined = viewTexts.map((text) => text.valueText).join("·");
    const prefix = segment.result.status === ReaderStatus.PARTIAL ? "~" : "";
    const metricsText = joined ? `${prefix}${joined}` : prefix;
    const spokenRows = viewTexts.map((text) => text.accessibleText).join(", ");
    const headerPart = badgeWord ? `${shortLabel} ${badgeWord}` : shortLabel;
    const accessibleText = spokenRows ? `${headerPart}: ${spokenRows}` : headerPart;

    return {
      provider: segment.provider,
      shortLabel,
      metricsText,
      attention: segment.health.attention,
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
