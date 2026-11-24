import Clutter from "gi://Clutter";
import St from "gi://St";

import { planStatusBar } from "./cardPlan.js";
import type { StatusBarPlan as CardsStatusBarPlan } from "./cardPlan.js";
import type { StatusBarRenderContext, StatusBarRenderer } from "./statusBar.js";
import { applyHealthToneClass, applyToneClass } from "./tone.js";

interface PillWidgets {
  dot: St.BoxLayout;
  values: St.Label[];
}

export class PillsStatusBarRenderer implements StatusBarRenderer {
  private _pills: PillWidgets[] = [];
  private _context: StatusBarRenderContext | null = null;
  private _plan: CardsStatusBarPlan | null = null;

  constructor(private readonly _parent: St.BoxLayout) {}

  statusKey(context: StatusBarRenderContext): string {
    return this._planFor(context).structureKey;
  }

  build(context: StatusBarRenderContext): void {
    const plan = this._planFor(context);

    if (plan.loading) {
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
        text: "…",
        style_class: "pl-status-value pl-status-loading-label",
        y_align: Clutter.ActorAlign.CENTER,
      });
      loadingLabel.accessible_name = plan.loadingAccessibleText;
      loadingPill.add_child(loadingLabel);
      this._parent.add_child(loadingPill);
      return;
    }

    for (const pillPlan of plan.pills) {
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

      const values = pillPlan.rows.map((row) => {
        const valueLabel = new St.Label({
          text: row.valueText,
          style_class: "pl-status-value",
          y_align: Clutter.ActorAlign.CENTER,
        });
        valueLabel.accessible_name = row.accessibleText ?? `${row.label}: ${row.valueText}`;
        applyToneClass(valueLabel, row.tone);
        pill.add_child(valueLabel);
        return valueLabel;
      });

      this._parent.add_child(pill);
      this._pills.push({ dot, values });
    }
  }

  update(context: StatusBarRenderContext): void {
    const plan = this._planFor(context);
    plan.pills.forEach((pillPlan, index) => {
      const widgets = this._pills[index];
      if (!widgets) return;

      applyHealthToneClass(widgets.dot, pillPlan.healthTone);

      pillPlan.rows.forEach((row, rowIndex) => {
        const valueLabel = widgets.values[rowIndex];
        if (!valueLabel) return;
        valueLabel.text = row.valueText;
        valueLabel.accessible_name = row.accessibleText ?? `${row.label}: ${row.valueText}`;
        applyToneClass(valueLabel, row.tone);
      });
    });
  }

  dispose(): void {
    let child = this._parent.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      child.destroy();
      child = next;
    }
    this._pills = [];
    this._context = null;
    this._plan = null;
  }

  private _planFor(context: StatusBarRenderContext): CardsStatusBarPlan {
    if (this._context !== context || !this._plan) {
      this._plan = planStatusBar({
        order: context.order,
        results: context.results,
        hasEnabledProviders: context.hasEnabledProviders,
        locale: context.locale,
        getShortDisplayName: (name) => context.shortDisplayName(name),
        getStatusFields: (name) => context.statusFields(name),
        getFieldDefs: (name) => context.fieldDefs(name),
        t: (text) => context.t(text),
      });
      this._context = context;
    }
    return this._plan;
  }
}
