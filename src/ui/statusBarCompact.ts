import Clutter from "gi://Clutter";
import St from "gi://St";

import { PROVIDER_NAMES, type ProviderName } from "../constants.js";
import { gettext as _ } from "../helpers/gettext.js";
import type { FieldDef } from "../readers/base.js";
import { planStatusBar } from "./matrixPlan.js";
import type { StatusBarPlan as MatrixStatusBarPlan } from "./matrixPlan.js";
import type { StatusBarRenderContext, StatusBarRenderer } from "./statusBar.js";
import { applyStatusAttentionClass } from "./tone.js";

interface CompactPooledSegment {
  box: St.BoxLayout;
  nameLabel: St.Label;
  metricsLabel: St.Label | null;
}

export class CompactStatusBarRenderer implements StatusBarRenderer {
  private _segments: CompactPooledSegment[] = [];
  private _placeholder: St.Label | null = null;
  private _context: StatusBarRenderContext | null = null;
  private _plan: MatrixStatusBarPlan | null = null;

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

  private _planFor(context: StatusBarRenderContext): MatrixStatusBarPlan {
    if (this._context === context && this._plan) return this._plan;

    const enabledProviders = new Set<ProviderName>();
    const shortLabels = {} as Record<ProviderName, string>;
    const statusFields = {} as Record<ProviderName, readonly string[]>;
    const fieldDefs: Partial<Record<ProviderName, readonly FieldDef[]>> = {};

    for (const name of PROVIDER_NAMES) {
      if (context.isEnabled(name)) enabledProviders.add(name);
      shortLabels[name] = context.shortDisplayName(name);
      statusFields[name] = context.statusFields(name);
      fieldDefs[name] = context.fieldDefs(name);
    }

    this._plan = planStatusBar({
      order: context.order,
      enabledProviders,
      results: context.results,
      shortLabels,
      statusFields,
      fieldDefs,
      locale: context.locale,
      t: (text) => context.t(text),
    });
    this._context = context;
    return this._plan;
  }
}
