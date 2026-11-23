import Clutter from "gi://Clutter";
import type Gio from "gi://Gio";
import St from "gi://St";

import type { ProviderName } from "../constants.js";
import type { FieldDef } from "../readers/base.js";
import { planPanel } from "./cardPlan.js";
import type {
  BannerKind,
  CardBadgeKind,
  CardKeyValueRow,
  CardProgressRow,
  ProviderCardPlan,
} from "./cardPlan.js";
import { clampPercent } from "./fieldRows.js";
import type { PanelRenderContext, PanelShell, PanelStyleSection } from "./panelShell.js";
import { applyHealthToneClass, applyToneClass } from "./tone.js";

export function computeBarWidthPx(
  trackWidth: number,
  fillPercent: number,
  fallbackTrackWidth = 260,
): number {
  const clamped = clampPercent(fillPercent) ?? 0;
  if (clamped <= 0) return 0;
  const effectiveTrack = trackWidth > 0 ? trackWidth : fallbackTrackWidth;
  return Math.min(effectiveTrack, Math.max(4, Math.round((effectiveTrack * clamped) / 100)));
}

interface ProgressRowWidgets {
  track: St.BoxLayout;
  fill: St.BoxLayout;
  fillPercent: number;
  hasValue: boolean;
}

function badgeStyleClass(kind: CardBadgeKind): string {
  switch (kind) {
    case "live":
      return "pl-card-badge pl-badge-live";
    case "cached":
      return "pl-card-badge pl-badge-cached";
    case "unavailable":
      return "pl-card-badge pl-badge-unavailable";
    case "error":
      return "pl-card-badge pl-badge-error";
  }
}

function bannerStyleClass(kind: BannerKind): string {
  return kind === "warning"
    ? "pl-diagnostic-banner pl-banner-warning"
    : "pl-diagnostic-banner pl-banner-error";
}

/** Rebuilds the cards panel body from one freshly derived plan. */
export class CardsPanelSection implements PanelStyleSection {
  readonly shell: PanelShell;

  constructor(
    _settings: Gio.Settings,
    _fieldDefs: Readonly<Record<ProviderName, readonly FieldDef[]>>,
    shell: PanelShell,
  ) {
    this.shell = shell;
  }

  destroy(): void {
    this.shell.destroy();
  }

  render(context: PanelRenderContext): void {
    const plan = planPanel(context.view, this.shell.isRunning());
    this.shell.clearBody();

    if (plan.phase !== "ready" && plan.emptyTitle) {
      this.shell.addEmptyStateRow(plan.emptyTitle, plan.emptySubtitle ?? undefined);
    } else {
      for (const cardPlan of plan.cards) this._addCard(cardPlan);
    }
  }

  setRunning(running: boolean): void {
    this.shell.setRunning(running);
  }

  private _addCard(plan: ProviderCardPlan): void {
    const host = this.shell.addStaticRow();
    host.add_style_class_name("pl-card-host");
    host.accessible_name = `${plan.displayName} (${plan.badgeText})`;

    const card = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      style_class: "pl-provider-card",
    });

    const header = new St.BoxLayout({
      x_expand: true,
      style_class: "pl-card-header",
    });

    const leftHeader = new St.BoxLayout({
      style_class: "pl-card-header-left",
      x_expand: plan.lastUpdatedText === null,
      y_align: Clutter.ActorAlign.CENTER,
    });

    const healthDot = new St.BoxLayout({
      style_class: "pl-health-dot",
      y_align: Clutter.ActorAlign.CENTER,
    });
    applyHealthToneClass(healthDot, plan.healthTone);
    leftHeader.add_child(healthDot);

    const titleLabel = new St.Label({
      text: plan.displayName,
      style_class: "provider-limits-panel-header pl-card-title",
      y_align: Clutter.ActorAlign.CENTER,
    });
    titleLabel.accessible_name = plan.displayName;
    leftHeader.add_child(titleLabel);

    const badgeLabel = new St.Label({
      text: plan.badgeText,
      style_class: badgeStyleClass(plan.badgeKind),
      y_align: Clutter.ActorAlign.CENTER,
    });
    badgeLabel.accessible_name = plan.badgeText;
    leftHeader.add_child(badgeLabel);

    header.add_child(leftHeader);

    if (plan.lastUpdatedText !== null) {
      const lastUpdatedLabel = new St.Label({
        text: plan.lastUpdatedText,
        style_class: "provider-limits-dim pl-card-updated",
        x_expand: true,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER,
      });
      lastUpdatedLabel.accessible_name = plan.lastUpdatedText;
      header.add_child(lastUpdatedLabel);
    }

    card.add_child(header);

    if (plan.bannerKind !== null && plan.bannerText !== null) {
      const bannerBox = new St.BoxLayout({
        style_class: bannerStyleClass(plan.bannerKind),
        x_expand: true,
      });
      const bannerLabel = new St.Label({
        text: plan.bannerText,
        style_class: "pl-diagnostic-text",
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
      });
      bannerLabel.clutter_text.line_wrap = true;
      bannerLabel.accessible_name = plan.bannerText;
      bannerBox.add_child(bannerLabel);
      card.add_child(bannerBox);
    }

    for (const row of plan.limitProgressRows) this._buildProgressRow(card, row);
    for (const row of plan.limitMetaRows) this._buildKeyValueRow(card, row);

    if (
      plan.telemetryRows.length > 0 &&
      (plan.limitProgressRows.length > 0 || plan.limitMetaRows.length > 0)
    ) {
      card.add_child(
        new St.BoxLayout({
          style_class: "pl-card-divider",
          x_expand: true,
        }),
      );
    }

    for (const row of plan.telemetryRows) this._buildKeyValueRow(card, row);

    host.add_child(card);
    this.shell.addBodyItem(host);
  }

  private _buildProgressRow(parent: St.BoxLayout, row: CardProgressRow): void {
    const container = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      style_class: "pl-progress-row",
    });

    const top = new St.BoxLayout({
      x_expand: true,
      style_class: "pl-progress-header",
    });

    const labelWidget = new St.Label({
      text: row.label,
      style_class: "provider-limits-field-label pl-progress-label",
      x_expand: true,
      x_align: Clutter.ActorAlign.START,
    });
    labelWidget.accessible_name = row.label;

    const valueWidget = new St.Label({
      text: row.valueText,
      style_class: "provider-limits-field-value pl-progress-value",
      x_align: Clutter.ActorAlign.END,
    });
    valueWidget.accessible_name = row.accessibleText;
    applyToneClass(valueWidget, row.tone);

    top.add_child(labelWidget);
    top.add_child(valueWidget);
    container.add_child(top);

    const track = new St.BoxLayout({
      style_class: "pl-progress-track",
      x_expand: true,
    });
    const fill = new St.BoxLayout({
      style_class: "pl-progress-fill",
      x_align: Clutter.ActorAlign.START,
      y_expand: true,
    });
    applyToneClass(fill, row.tone);
    track.add_child(fill);
    container.add_child(track);

    if (row.resetText) {
      const resetLabel = new St.Label({
        text: row.resetText,
        style_class: "provider-limits-dim pl-progress-meta",
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
      });
      resetLabel.accessible_name = row.resetText;
      container.add_child(resetLabel);
    }

    if (row.errorText) {
      const errorLabel = new St.Label({
        text: row.errorText,
        style_class: "provider-limits-error pl-field-error",
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
      });
      errorLabel.clutter_text.line_wrap = true;
      errorLabel.accessible_name = row.errorText;
      container.add_child(errorLabel);
    }

    const widgets: ProgressRowWidgets = {
      track,
      fill,
      fillPercent: row.fillPercent,
      hasValue: row.hasValue,
    };

    this._syncProgressFill(widgets);
    track.connect("notify::width", () => {
      this._syncProgressFill(widgets);
    });

    parent.add_child(container);
  }

  private _syncProgressFill(widgets: ProgressRowWidgets): void {
    if (!widgets.hasValue || widgets.fillPercent <= 0) {
      widgets.fill.visible = false;
      widgets.fill.width = 0;
      return;
    }

    widgets.fill.visible = true;
    const trackWidth = typeof widgets.track.width === "number" ? widgets.track.width : 0;
    const targetWidth = computeBarWidthPx(trackWidth, widgets.fillPercent);
    if (widgets.fill.width !== targetWidth) {
      widgets.fill.width = targetWidth;
    }
  }

  private _buildKeyValueRow(parent: St.BoxLayout, row: CardKeyValueRow): void {
    const container = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      style_class: "pl-kv-row",
    });

    const line = new St.BoxLayout({
      x_expand: true,
      style_class: "pl-kv-line",
    });

    const labelWidget = new St.Label({
      text: row.label,
      style_class: "provider-limits-field-label pl-kv-label",
      x_expand: true,
      x_align: Clutter.ActorAlign.START,
    });
    labelWidget.accessible_name = row.label;

    const valueWidget = new St.Label({
      text: row.valueText,
      style_class: "provider-limits-field-value pl-kv-value",
      x_align: Clutter.ActorAlign.END,
    });
    valueWidget.accessible_name = row.accessibleText;
    applyToneClass(valueWidget, row.tone);

    line.add_child(labelWidget);
    line.add_child(valueWidget);
    container.add_child(line);

    if (row.errorText) {
      const errorLabel = new St.Label({
        text: row.errorText,
        style_class: "provider-limits-error pl-field-error",
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
      });
      errorLabel.clutter_text.line_wrap = true;
      errorLabel.accessible_name = row.errorText;
      container.add_child(errorLabel);
    }

    parent.add_child(container);
  }
}
