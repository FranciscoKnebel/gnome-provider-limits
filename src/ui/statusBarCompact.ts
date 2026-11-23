import Clutter from "gi://Clutter";
import St from "gi://St";

import type { ProviderName } from "../constants.js";
import { ReaderStatus } from "../readers/base.js";
import { statusBadgeText } from "./providerHealth.js";
import type { ProviderAttention } from "./providerHealth.js";
import { structureKey } from "./renderStructure.js";
import { StatusBarRenderer } from "./statusBarRenderer.js";
import { deriveStatusBarSegments } from "./statusBarSegments.js";
import { applyStatusAttentionClass } from "./tone.js";
import type { ProviderViewContext, ViewPhase } from "./viewContext.js";
import { viewMessages } from "./viewMessages.js";

interface CompactPooledSegment {
  box: St.BoxLayout;
  nameLabel: St.Label;
  metricsLabel: St.Label | null;
}

interface CompactBadgePlan {
  provider: ProviderName;
  shortLabel: string;
  metricsText: string;
  attention: ProviderAttention;
  accessibleText: string;
  key: string;
}

interface CompactPlan {
  phase: ViewPhase;
  placeholderText: string | null;
  placeholderAccessibleText: string;
  badges: readonly CompactBadgePlan[];
  key: string;
}

function planCompact(context: ProviderViewContext): CompactPlan {
  const tr = (text: string) => context.t(text);

  const message = viewMessages({
    phase: context.phase,
    surface: "compact",
    locale: context.locale,
    t: context.t,
    running: false,
  });

  if (context.phase === "empty") {
    return {
      phase: "empty",
      placeholderText: null,
      placeholderAccessibleText: message.accessibleText,
      badges: [],
      key: structureKey(["empty", context.locale]),
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
        key: JSON.stringify([segment.provider, shortLabel, 1]),
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
      key: JSON.stringify([segment.provider, shortLabel, metricsText ? 1 : 0]),
    };
  });

  if (context.phase === "loading") {
    return {
      phase: "loading",
      placeholderText: message.placeholder,
      placeholderAccessibleText: message.accessibleText,
      badges: [],
      key: structureKey(["loading", context.locale]),
    };
  }

  return {
    phase: "ready",
    placeholderText: null,
    placeholderAccessibleText: "",
    badges,
    key: structureKey(["ready", context.locale, ...badges.map((badge) => badge.key)]),
  };
}

export class CompactStatusBarRenderer extends StatusBarRenderer<CompactPlan> {
  private _segments: CompactPooledSegment[] = [];
  private _placeholder: St.Label | null = null;

  protected plan(context: ProviderViewContext): CompactPlan {
    return planCompact(context);
  }

  protected build(plan: CompactPlan): void {
    if (plan.phase === "loading" && plan.placeholderText) {
      const placeholder = new St.Label({
        text: plan.placeholderText,
        style_class: "provider-limits-status-placeholder provider-limits-tnum",
        y_align: Clutter.ActorAlign.CENTER,
      });
      placeholder.accessible_name = plan.placeholderAccessibleText;
      this.parent.add_child(placeholder);
      this._placeholder = placeholder;
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
      this._segments.push({ box: segment, nameLabel, metricsLabel });
    });
  }

  protected update(plan: CompactPlan): void {
    if (plan.phase === "loading" && this._placeholder && plan.placeholderText) {
      this._placeholder.text = plan.placeholderText;
      return;
    }

    plan.badges.forEach((badge, index) => {
      const pooled = this._segments[index];
      if (!pooled) return;

      pooled.box.accessible_name = badge.accessibleText;
      pooled.nameLabel.text = badge.shortLabel;
      if (pooled.metricsLabel) {
        pooled.metricsLabel.text = badge.metricsText;
        pooled.metricsLabel.accessible_name = badge.accessibleText;
      }
      applyStatusAttentionClass(
        pooled.box,
        pooled.metricsLabel ?? pooled.nameLabel,
        badge.attention,
      );
    });
  }

  protected onDispose(): void {
    this._segments = [];
    this._placeholder = null;
  }
}
