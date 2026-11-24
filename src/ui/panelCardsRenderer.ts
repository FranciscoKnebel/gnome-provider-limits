import Clutter from "gi://Clutter";
import St from "gi://St";

import type { ProviderDisplayModel } from "./displayModel.js";
import { createErrorLabel } from "./errorLabel.js";
import type { FieldView } from "./fieldViews.js";
import {
  computeBarWidthPx,
  progressResetPresentation,
  type BannerKind,
  type CardBadgeKind,
} from "./panelCards.js";
import {
  addPlaceholderIfNeeded,
  PanelStyleSection,
  type PanelRenderContext,
} from "./panelShell.js";
import { applyHealthToneClass, applyToneClass } from "./tone.js";
import { cardsMessages, cardsRunningMessages, type Translate } from "./viewMessages.js";

interface ProgressRowWidgets {
  track: St.BoxLayout;
  fill: St.BoxLayout;
  fillPercent: number;
  hasValue: boolean;
}

const BADGE_CLASS_BY_KIND: Record<CardBadgeKind, string> = {
  live: "pl-card-badge pl-badge-live",
  cached: "pl-card-badge pl-badge-cached",
  unavailable: "pl-card-badge pl-badge-unavailable",
  error: "pl-card-badge pl-badge-error",
};

function bannerStyleClass(kind: BannerKind): string {
  return kind === "warning"
    ? "pl-diagnostic-banner pl-banner-warning"
    : "pl-diagnostic-banner pl-banner-error";
}

/** Rebuilds the cards panel body from the canonical models and their facts. */
export class CardsPanelSection extends PanelStyleSection {
  private _running = false;

  override setRunning(running: boolean): void {
    this._running = running;
  }

  override render(context: PanelRenderContext): void {
    const messages = this._running ? cardsRunningMessages : cardsMessages;
    if (addPlaceholderIfNeeded(this.shell, context.view, messages)) return;

    for (const model of context.view.models) {
      this._addCard(model, context.view.locale, context.view.t);
    }
  }

  private _addCard(model: ProviderDisplayModel, locale: string, t: Translate): void {
    const facts = model.facts;
    const displayName = model.displayName;
    const badgeText = facts.badges.cardText;
    const host = this.shell.addStaticRow();
    host.add_style_class_name("pl-card-host");
    host.accessible_name = `${displayName} (${badgeText})`;

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
      x_expand: facts.lastUpdatedText === null,
      y_align: Clutter.ActorAlign.CENTER,
    });

    const healthDot = new St.BoxLayout({
      style_class: "pl-health-dot",
      y_align: Clutter.ActorAlign.CENTER,
    });
    applyHealthToneClass(healthDot, facts.health.tone);
    leftHeader.add_child(healthDot);

    const titleLabel = new St.Label({
      text: displayName,
      style_class: "provider-limits-panel-header pl-card-title",
      y_align: Clutter.ActorAlign.CENTER,
    });
    titleLabel.accessible_name = displayName;
    leftHeader.add_child(titleLabel);

    const badgeLabel = new St.Label({
      text: badgeText,
      style_class: BADGE_CLASS_BY_KIND[facts.badges.card],
      y_align: Clutter.ActorAlign.CENTER,
    });
    badgeLabel.accessible_name = badgeText;
    leftHeader.add_child(badgeLabel);

    header.add_child(leftHeader);

    if (facts.lastUpdatedText !== null) {
      const lastUpdatedLabel = new St.Label({
        text: facts.lastUpdatedText,
        style_class: "provider-limits-dim pl-card-updated",
        x_expand: true,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER,
      });
      lastUpdatedLabel.accessible_name = facts.lastUpdatedText;
      header.add_child(lastUpdatedLabel);
    }

    card.add_child(header);

    const diagnostic = facts.diagnostic;
    if (diagnostic.kind !== null) {
      const bannerBox = new St.BoxLayout({
        style_class: bannerStyleClass(diagnostic.kind),
        x_expand: true,
      });
      const bannerLabel = new St.Label({
        text: diagnostic.text,
        style_class: "pl-diagnostic-text",
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
      });
      bannerLabel.clutter_text.line_wrap = true;
      bannerLabel.accessible_name = diagnostic.text;
      bannerBox.add_child(bannerLabel);
      card.add_child(bannerBox);
    }

    for (const view of facts.views.limit.progress) {
      this._buildProgressRow(card, view, model.resets, locale, t);
    }
    for (const view of facts.views.limit.keyValue) this._buildKeyValueRow(card, view);

    if (
      facts.views.telemetry.keyValue.length > 0 &&
      (facts.views.limit.progress.length > 0 || facts.views.limit.keyValue.length > 0)
    ) {
      card.add_child(
        new St.BoxLayout({
          style_class: "pl-card-divider",
          x_expand: true,
        }),
      );
    }

    for (const view of facts.views.telemetry.keyValue) this._buildKeyValueRow(card, view);

    host.add_child(card);
    this.shell.addBodyItem(host);
  }

  private _buildProgressRow(
    parent: St.BoxLayout,
    view: FieldView,
    resets: ProviderDisplayModel["resets"],
    locale: string,
    t: Translate,
  ): void {
    const { resetText, accessibleText, errorText } = progressResetPresentation(
      view,
      resets.get(view.name),
      locale,
      t,
    );
    const label = view.labelText;
    const valueText = view.valueText;
    const tone = view.tone;
    const fillPercent = view.fillPercent ?? 0;
    const hasValue = view.fillPercent !== undefined;

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
      text: label,
      style_class: "provider-limits-field-label pl-progress-label",
      x_expand: true,
      x_align: Clutter.ActorAlign.START,
    });
    labelWidget.accessible_name = label;

    const valueWidget = new St.Label({
      text: valueText,
      style_class: "provider-limits-field-value pl-progress-value",
      x_align: Clutter.ActorAlign.END,
    });
    valueWidget.accessible_name = accessibleText;
    applyToneClass(valueWidget, tone);

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
    applyToneClass(fill, tone);
    track.add_child(fill);
    container.add_child(track);

    if (resetText) {
      const resetLabel = new St.Label({
        text: resetText,
        style_class: "provider-limits-dim pl-progress-meta",
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
      });
      resetLabel.accessible_name = resetText;
      container.add_child(resetLabel);
    }

    if (errorText) {
      const errorLabel = createErrorLabel(errorText, "provider-limits-error pl-field-error");
      errorLabel.x_align = Clutter.ActorAlign.START;
      errorLabel.accessible_name = errorText;
      container.add_child(errorLabel);
    }

    const widgets: ProgressRowWidgets = {
      track,
      fill,
      fillPercent,
      hasValue,
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

  private _buildKeyValueRow(parent: St.BoxLayout, view: FieldView): void {
    const label = view.labelText;
    const valueText = view.valueText;
    const accessibleText = view.accessibleText;
    const tone = view.tone;
    const errorText = view.errorText;

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
      text: label,
      style_class: "provider-limits-field-label pl-kv-label",
      x_expand: true,
      x_align: Clutter.ActorAlign.START,
    });
    labelWidget.accessible_name = label;

    const valueWidget = new St.Label({
      text: valueText,
      style_class: "provider-limits-field-value pl-kv-value",
      x_align: Clutter.ActorAlign.END,
    });
    valueWidget.accessible_name = accessibleText;
    applyToneClass(valueWidget, tone);

    line.add_child(labelWidget);
    line.add_child(valueWidget);
    container.add_child(line);

    if (errorText) {
      const errorLabel = createErrorLabel(errorText, "provider-limits-error pl-field-error");
      errorLabel.x_align = Clutter.ActorAlign.START;
      errorLabel.accessible_name = errorText;
      container.add_child(errorLabel);
    }

    parent.add_child(container);
  }
}
