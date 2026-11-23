import Clutter from "gi://Clutter";
import St from "gi://St";

import type { ProviderName } from "../constants.js";
import { ReaderStatus } from "../readers/base.js";
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
  const tr = (text: string) => context.t(text);

  const message = viewMessages({
    phase: context.phase,
    surface: "compact",
    t: context.t,
    running: false,
  });

  if (context.phase === "empty") {
    return {
      kind: "placeholder",
      phase: "empty",
      placeholder: null,
      placeholderAccessibleText: message.accessibleText,
      showPlaceholder: false,
    };
  }

  const segments: CompactBadgePlan[] = deriveStatusBarSegments(context).map((segment) => {
    const shortLabel = segment.displayName || segment.provider;
    const badgeWord = statusBadgeText(segment.health, tr);

    if (segment.health.state === "error" || segment.health.state === "unavailable") {
      return {
        provider: segment.provider,
        shortLabel,
        metricsText: "!",
        attention: segment.health.attention,
        accessibleText: `${shortLabel} ${badgeWord}`.trim(),
      };
    }

    const joined = segment.views.map((view) => view.valueText).join("·");
    const prefix = segment.result.status === ReaderStatus.PARTIAL ? "~" : "";
    const metricsText = joined ? `${prefix}${joined}` : prefix;
    const spokenRows = segment.views.map((view) => view.accessibleText).join(", ");
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

  if (context.phase === "loading") {
    return {
      kind: "placeholder",
      phase: "loading",
      placeholder: message.placeholder,
      placeholderAccessibleText: message.accessibleText,
      showPlaceholder: true,
    };
  }

  return { kind: "segments", segments };
}

/** Rebuilds the compact status bar from one freshly derived plan. */
export class CompactStatusBarRenderer extends StatusBarRenderer<CompactPlan> {
  protected plan(context: ProviderViewContext): CompactPlan {
    return planCompact(context);
  }

  protected renderPlan(plan: CompactPlan): void {
    if (plan.kind === "placeholder") {
      if (plan.placeholder === null) return;
      const placeholder = new St.Label({
        text: plan.placeholder,
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
