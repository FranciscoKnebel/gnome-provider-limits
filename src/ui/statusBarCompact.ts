import Clutter from "gi://Clutter";
import St from "gi://St";

import type { ProviderName } from "../constants.js";
import { gettext as _ } from "../helpers/gettext.js";
import { ReaderStatus } from "../readers/base.js";
import { deriveStatusBarSegments, statusBadgeText, toAttention } from "./fieldViews.js";
import type { ProviderAttention } from "./providerTypes.js";
import { structureKey } from "./renderStructure.js";
import type { StatusBarRenderContext, StatusBarRenderer } from "./statusBar.js";
import { applyStatusAttentionClass } from "./tone.js";

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
  state: "empty" | "loading" | "ready";
  placeholderText: string | null;
  badges: readonly CompactBadgePlan[];
  key: string;
}

function planCompact(context: StatusBarRenderContext): CompactPlan {
  const tr = (text: string) => context.t(text);

  if (!context.order.some((name) => context.isEnabled(name))) {
    return {
      state: "empty",
      placeholderText: null,
      badges: [],
      key: structureKey(["empty", context.locale]),
    };
  }

  const badges: CompactBadgePlan[] = deriveStatusBarSegments(context)
    .filter((segment) => context.isEnabled(segment.provider))
    .map((segment) => {
      const shortLabel = segment.displayName || segment.provider;
      const badgeWord = statusBadgeText(segment.health, tr);

      if (segment.health.state === "error" || segment.health.state === "unavailable") {
        return {
          provider: segment.provider,
          shortLabel,
          metricsText: "!",
          attention: toAttention(segment.health),
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
        attention: toAttention(segment.health),
        accessibleText,
        key: JSON.stringify([segment.provider, shortLabel, metricsText ? 1 : 0]),
      };
    });

  if (badges.length === 0 && context.results.size === 0) {
    return {
      state: "loading",
      placeholderText: "…",
      badges: [],
      key: structureKey(["loading", context.locale]),
    };
  }

  return {
    state: "ready",
    placeholderText: null,
    badges,
    key: structureKey(["ready", context.locale, ...badges.map((badge) => badge.key)]),
  };
}

export class CompactStatusBarRenderer implements StatusBarRenderer {
  private _segments: CompactPooledSegment[] = [];
  private _placeholder: St.Label | null = null;
  private _context: StatusBarRenderContext | null = null;
  private _plan: CompactPlan | null = null;

  constructor(private readonly _parent: St.BoxLayout) {}

  statusKey(context: StatusBarRenderContext): string {
    return this._planFor(context).key;
  }

  build(context: StatusBarRenderContext): void {
    const plan = this._planFor(context);

    if (plan.state === "loading" && plan.placeholderText) {
      const placeholder = new St.Label({
        text: plan.placeholderText,
        style_class: "provider-limits-status-placeholder provider-limits-tnum",
        y_align: Clutter.ActorAlign.CENTER,
      });
      placeholder.accessible_name = _("Reading provider limits…");
      this._parent.add_child(placeholder);
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
      this._parent.add_child(segment);
      this._segments.push({ box: segment, nameLabel, metricsLabel });
    });
  }

  update(context: StatusBarRenderContext): void {
    const plan = this._planFor(context);

    if (plan.state === "loading" && this._placeholder && plan.placeholderText) {
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

  dispose(): void {
    let child = this._parent.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      child.destroy();
      child = next;
    }
    this._segments = [];
    this._placeholder = null;
    this._context = null;
    this._plan = null;
  }

  private _planFor(context: StatusBarRenderContext): CompactPlan {
    if (this._context === context && this._plan) return this._plan;
    this._plan = planCompact(context);
    this._context = context;
    return this._plan;
  }
}
