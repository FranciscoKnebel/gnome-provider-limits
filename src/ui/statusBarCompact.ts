import Clutter from "gi://Clutter";
import St from "gi://St";

import type { ProviderName } from "../constants.js";
import { ReaderStatus } from "../readers/base.js";
import { statusBadgeText } from "./providerHealth.js";
import type { ProviderAttention } from "./providerHealth.js";
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

interface CompactPlan {
  phase: string;
  placeholderText: string | null;
  placeholderAccessibleText: string;
  badges: readonly CompactBadgePlan[];
}

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
      phase: "empty",
      placeholderText: null,
      placeholderAccessibleText: message.accessibleText,
      badges: [],
    };
  }

  const badges: CompactBadgePlan[] = deriveStatusBarSegments(context).map((segment) => {
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
      phase: "loading",
      placeholderText: message.placeholder,
      placeholderAccessibleText: message.accessibleText,
      badges: [],
    };
  }

  return {
    phase: "ready",
    placeholderText: null,
    placeholderAccessibleText: "",
    badges,
  };
}

/** Rebuilds the compact status bar from one freshly derived plan. */
export class CompactStatusBarRenderer {
  constructor(private readonly parent: St.BoxLayout) {}

  render(context: ProviderViewContext): void {
    this.dispose();
    const plan = planCompact(context);

    if (plan.phase === "loading" && plan.placeholderText) {
      const placeholder = new St.Label({
        text: plan.placeholderText,
        style_class: "provider-limits-status-placeholder provider-limits-tnum",
        y_align: Clutter.ActorAlign.CENTER,
      });
      placeholder.accessible_name = plan.placeholderAccessibleText;
      this.parent.add_child(placeholder);
      return;
    }

    plan.badges.forEach((badge, index) => {
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

  dispose(): void {
    let child = this.parent.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      child.destroy();
      child = next;
    }
  }
}
