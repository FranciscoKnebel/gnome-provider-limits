import Clutter from "gi://Clutter";
import St from "gi://St";

import type { ProviderName } from "../constants.js";
import { ReaderStatus } from "../readers/base.js";
import { displayFacts } from "./displayModel.js";
import type { ProviderAttention } from "./providerHealth.js";
import { StatusBarRenderer, type ZonePlan } from "./statusBarRenderer.js";
import { STYLE_REGISTRY } from "./styles.js";
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
  const phase = phaseResult(context, STYLE_REGISTRY.statusBar.compact, false);
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
    const { health, badges } = displayFacts(model);
    const shortLabel = model.shortDisplayName || model.provider;
    const badgeWord = badges.status;

    if (health.state === "error" || health.state === "unavailable") {
      return {
        provider: model.provider,
        shortLabel,
        metricsText: "!",
        attention: health.attention,
        accessibleText: `${shortLabel} ${badgeWord}`.trim(),
      };
    }

    const joined = model.statusViews.map((view) => view.valueText).join("·");
    const prefix = model.result.status === ReaderStatus.PARTIAL ? "~" : "";
    const metricsText = joined ? `${prefix}${joined}` : prefix;
    const spokenRows = model.statusViews.map((view) => view.accessibleText).join(", ");
    const headerPart = badgeWord ? `${shortLabel} ${badgeWord}` : shortLabel;
    const accessibleText = spokenRows ? `${headerPart}: ${spokenRows}` : headerPart;

    return {
      provider: model.provider,
      shortLabel,
      metricsText,
      attention: health.attention,
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

  protected override renderPlan(plan: CompactPlan): void {
    if (
      this.renderPlaceholder(plan, (placeholder) => {
        const label = new St.Label({
          text: placeholder.placeholder ?? "",
          style_class: "provider-limits-status-placeholder provider-limits-tnum",
          y_align: Clutter.ActorAlign.CENTER,
        });
        label.accessible_name = placeholder.placeholderAccessibleText;
        return label;
      })
    ) {
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
