import Clutter from "gi://Clutter";
import type Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";

import type { ProviderName } from "../constants.js";
import { gettext as _ } from "../helpers/gettext.js";
import { resolveLocale } from "../helpers/locale.js";
import { normalizeProvidersOrder, providerDisplayName } from "../helpers/provider-settings.js";
import type { BaseReader, FieldDef, ReaderResult } from "../readers/base.js";
import { computeBarWidthPx, planPanel } from "./cardPlan.js";
import type {
  BannerKind,
  CardBadgeKind,
  CardKeyValueRow,
  CardProgressRow,
  PanelEmptyState,
  PanelPlan,
  ProviderCardPlan,
} from "./cardPlan.js";
import type { PanelShell, PanelStyleSection } from "./panelShell.js";
import { applyHealthToneClass, applyToneClass } from "./tone.js";

interface ProgressRowWidgets {
  value: St.Label;
  track: St.BoxLayout;
  fill: St.BoxLayout;
  fillPercent: number;
  hasValue: boolean;
  resetLabel: St.Label | null;
  errorLabel: St.Label | null;
}

interface KeyValueRowWidgets {
  value: St.Label;
  errorLabel: St.Label | null;
}

interface CardWidgets {
  healthDot: St.BoxLayout;
  badgeLabel: St.Label;
  lastUpdatedLabel: St.Label | null;
  bannerLabel: St.Label | null;
  progressRows: ProgressRowWidgets[];
  limitMetaRows: KeyValueRowWidgets[];
  telemetryRows: KeyValueRowWidgets[];
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

export class CardsPanelSection implements PanelStyleSection {
  private _settings: Gio.Settings;
  private _readers: Map<ProviderName, BaseReader>;
  private readonly _fieldDefs: Readonly<Record<ProviderName, readonly FieldDef[]>>;
  private _running = false;
  private _cards: CardWidgets[] = [];
  private _emptyState: PanelEmptyState = "none";
  private _emptyTitleLabel: St.Label | null = null;
  private _structureKey: string | null = null;
  readonly shell: PanelShell;

  constructor(
    settings: Gio.Settings,
    readers: Map<ProviderName, BaseReader>,
    fieldDefs: Readonly<Record<ProviderName, readonly FieldDef[]>>,
    shell: PanelShell,
  ) {
    this._settings = settings;
    this._readers = readers;
    this._fieldDefs = fieldDefs;
    this.shell = shell;
  }

  destroy(): void {
    this.shell.destroy();
  }

  render(results: Map<ProviderName, ReaderResult>, lastRefreshAt: number | null): void {
    const order = normalizeProvidersOrder(this._settings.get_strv("providers-order"));
    const locale = resolveLocale(
      this._settings.get_string("language"),
      GLib.getenv("LC_MESSAGES"),
      GLib.getenv("LANG"),
    );
    const hasEnabledProviders =
      this._readers.size > 0 || order.some((name) => this._settings.get_boolean(`${name}-enabled`));

    const plan = planPanel({
      order,
      results,
      hasEnabledProviders,
      running: this._running,
      locale,
      getDisplayName: (name) => providerDisplayName(this._settings, name),
      getPanelFields: (name) => this._settings.get_strv(`${name}-panel-fields`),
      getFieldDefs: (name) => this._fieldDefs[name],
      t: _,
    });

    if (plan.structureKey !== this._structureKey) {
      this._rebuild(plan, lastRefreshAt);
      this._structureKey = plan.structureKey;
      return;
    }

    this._update(plan, lastRefreshAt);
  }

  setLastRefreshAt(lastRefreshAt: number | null): void {
    this.shell.setLastRefreshAt(lastRefreshAt);
  }

  setRunning(running: boolean): void {
    this._running = running;
    this.shell.setRunning(running);
    if (this._emptyState === "loading" && this._emptyTitleLabel) {
      this._emptyTitleLabel.text = running
        ? _("Loading provider limits…")
        : _("Waiting for provider data…");
      this._emptyTitleLabel.accessible_name = this._emptyTitleLabel.text;
    }
  }

  private _rebuild(plan: PanelPlan, lastRefreshAt: number | null): void {
    this.shell.clearBody();
    this._cards = [];
    this._emptyState = plan.emptyState;
    this._emptyTitleLabel = null;

    if (plan.emptyState !== "none" && plan.emptyTitle) {
      this._emptyTitleLabel = this.shell.addEmptyStateRow(
        plan.emptyTitle,
        plan.emptySubtitle ?? undefined,
      );
    } else {
      for (const cardPlan of plan.cards) {
        this._cards.push(this._addCard(cardPlan));
      }
    }

    this.setRunning(this._running);
    this.setLastRefreshAt(lastRefreshAt);
  }

  private _update(plan: PanelPlan, lastRefreshAt: number | null): void {
    if (plan.emptyState !== "none" && this._emptyTitleLabel && plan.emptyTitle) {
      this._emptyTitleLabel.text = plan.emptyTitle;
      this._emptyTitleLabel.accessible_name = plan.emptyTitle;
    }

    plan.cards.forEach((cardPlan, index) => {
      const card = this._cards[index];
      if (!card) return;

      applyHealthToneClass(card.healthDot, cardPlan.healthTone);
      card.badgeLabel.text = cardPlan.badgeText;
      card.badgeLabel.accessible_name = cardPlan.badgeText;

      if (card.lastUpdatedLabel && cardPlan.lastUpdatedText) {
        card.lastUpdatedLabel.text = cardPlan.lastUpdatedText;
        card.lastUpdatedLabel.accessible_name = cardPlan.lastUpdatedText;
      }

      if (card.bannerLabel && cardPlan.bannerText) {
        card.bannerLabel.text = cardPlan.bannerText;
        card.bannerLabel.accessible_name = cardPlan.bannerText;
      }

      cardPlan.limitProgressRows.forEach((row, rowIndex) => {
        const widgets = card.progressRows[rowIndex];
        if (!widgets) return;
        widgets.value.text = row.valueText;
        widgets.value.accessible_name = row.accessibleText;
        applyToneClass(widgets.value, row.tone);
        applyToneClass(widgets.fill, row.tone);
        widgets.fillPercent = row.fillPercent;
        widgets.hasValue = row.hasValue;
        this._syncProgressFill(widgets);

        if (widgets.resetLabel && row.resetText) {
          widgets.resetLabel.text = row.resetText;
          widgets.resetLabel.accessible_name = row.resetText;
        }
        if (widgets.errorLabel && row.errorText) {
          widgets.errorLabel.text = row.errorText;
          widgets.errorLabel.accessible_name = row.errorText;
        }
      });

      this._updateKeyValueRows(card.limitMetaRows, cardPlan.limitMetaRows);
      this._updateKeyValueRows(card.telemetryRows, cardPlan.telemetryRows);
    });

    this.setLastRefreshAt(lastRefreshAt);
  }

  private _updateKeyValueRows(
    widgetRows: readonly KeyValueRowWidgets[],
    planRows: readonly CardKeyValueRow[],
  ): void {
    planRows.forEach((row, rowIndex) => {
      const widgets = widgetRows[rowIndex];
      if (!widgets) return;
      widgets.value.text = row.valueText;
      widgets.value.accessible_name = row.accessibleText;
      applyToneClass(widgets.value, row.tone);
      if (widgets.errorLabel && row.errorText) {
        widgets.errorLabel.text = row.errorText;
        widgets.errorLabel.accessible_name = row.errorText;
      }
    });
  }

  private _addCard(plan: ProviderCardPlan): CardWidgets {
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

    let lastUpdatedLabel: St.Label | null = null;
    if (plan.lastUpdatedText !== null) {
      lastUpdatedLabel = new St.Label({
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

    let bannerLabel: St.Label | null = null;
    if (plan.bannerKind !== null && plan.bannerText !== null) {
      const bannerBox = new St.BoxLayout({
        style_class: bannerStyleClass(plan.bannerKind),
        x_expand: true,
      });
      bannerLabel = new St.Label({
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

    const progressRows = plan.limitProgressRows.map((row) => this._buildProgressRow(card, row));
    const limitMetaRows = plan.limitMetaRows.map((row) => this._buildKeyValueRow(card, row));

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

    const telemetryRows = plan.telemetryRows.map((row) => this._buildKeyValueRow(card, row));

    host.add_child(card);
    this.shell.addBodyItem(host);

    return {
      healthDot,
      badgeLabel,
      lastUpdatedLabel,
      bannerLabel,
      progressRows,
      limitMetaRows,
      telemetryRows,
    };
  }

  private _buildProgressRow(parent: St.BoxLayout, row: CardProgressRow): ProgressRowWidgets {
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

    let resetLabel: St.Label | null = null;
    if (row.resetText) {
      resetLabel = new St.Label({
        text: row.resetText,
        style_class: "provider-limits-dim pl-progress-meta",
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
      });
      resetLabel.accessible_name = row.resetText;
      container.add_child(resetLabel);
    }

    let errorLabel: St.Label | null = null;
    if (row.errorText) {
      errorLabel = new St.Label({
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
      value: valueWidget,
      track,
      fill,
      fillPercent: row.fillPercent,
      hasValue: row.hasValue,
      resetLabel,
      errorLabel,
    };

    this._syncProgressFill(widgets);
    track.connect("notify::width", () => {
      this._syncProgressFill(widgets);
    });

    parent.add_child(container);
    return widgets;
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

  private _buildKeyValueRow(parent: St.BoxLayout, row: CardKeyValueRow): KeyValueRowWidgets {
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

    let errorLabel: St.Label | null = null;
    if (row.errorText) {
      errorLabel = new St.Label({
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
    return { value: valueWidget, errorLabel };
  }
}
