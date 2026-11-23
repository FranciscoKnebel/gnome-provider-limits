import Clutter from "gi://Clutter";
import St from "gi://St";

import type { ProviderName } from "../constants.js";
import { gettext as _ } from "../helpers/gettext.js";
import { ReaderStatus } from "../readers/base.js";
import type { FieldView } from "./fieldViews.js";
import { deriveStatusBarSegments } from "./fieldViews.js";
import type { ProviderTone } from "./providerTypes.js";
import { structureKey } from "./renderStructure.js";
import type { StatusBarRenderContext } from "./statusBar.js";
import { StatusBarRenderer } from "./statusBarRenderer.js";
import { applyHealthToneClass, applyToneClass } from "./tone.js";

interface PillWidgets {
  dot: St.BoxLayout;
  values: St.Label[];
}

interface PillPlan {
  provider: ProviderName;
  displayName: string;
  status: ReaderStatus;
  healthTone: ProviderTone;
  isPartial: boolean;
  stateTag: string | null;
  stateAccessibleText: string | null;
  rows: readonly FieldView[];
  key: string;
}

interface PillsPlan {
  readonly key: string;
  loading: boolean;
  loadingAccessibleText: string;
  pills: readonly PillPlan[];
}

function planPills(context: StatusBarRenderContext): PillsPlan {
  const pills: PillPlan[] = deriveStatusBarSegments(context).map((segment) => ({
    provider: segment.provider,
    displayName: segment.displayName,
    status: segment.result.status,
    healthTone: segment.health.tone,
    isPartial: segment.result.status === ReaderStatus.PARTIAL,
    stateTag: segment.health.stateTag,
    stateAccessibleText: segment.health.stateAccessibleText,
    rows: segment.views,
    key: JSON.stringify([
      segment.provider,
      segment.displayName,
      segment.result.status,
      context.locale,
      segment.health.stateTag ?? "",
      segment.views.map((row) => row.name ?? row.label),
    ]),
  }));

  const loading = pills.length === 0 && context.results.size === 0 && context.hasEnabledProviders;
  return {
    key: structureKey([
      context.locale,
      loading ? "loading" : "ready",
      ...pills.map((pill) => pill.key),
    ]),
    loading,
    loadingAccessibleText: _("Loading provider limits…"),
    pills,
  };
}

export class PillsStatusBarRenderer extends StatusBarRenderer<PillsPlan> {
  private _pills: PillWidgets[] = [];

  protected plan(context: StatusBarRenderContext): PillsPlan {
    return planPills(context);
  }

  protected build(plan: PillsPlan): void {
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
      this.parent.add_child(loadingPill);
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

      this.parent.add_child(pill);
      this._pills.push({ dot, values });
    }
  }

  protected update(plan: PillsPlan): void {
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

  protected onDispose(): void {
    this._pills = [];
  }
}
