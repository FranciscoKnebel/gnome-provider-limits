import Clutter from "gi://Clutter";
import type Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";

import type { ProviderName } from "../constants.js";
import { gettext as _ } from "../helpers/gettext.js";
import { bindActivation } from "../helpers/keyboard.js";
import { resolveLocale } from "../helpers/locale.js";
import type { FieldDef } from "../readers/base.js";
import { clampFillRatio } from "./fieldRows.js";
import {
  planPanelMatrix,
  resolveProviderExpanded,
  toggleAllProvidersExpanded,
} from "./matrixPlan.js";
import type { MatrixDetailRow, PanelMatrixPlan, ProviderMatrixPlan } from "./matrixPlan.js";
import type { PanelRenderContext, PanelShell, PanelStyleSection } from "./panelShell.js";
import { applyQuietToneClass, applyToneClass } from "./tone.js";
import { emptyViewContext, type ProviderViewContext } from "./viewContext.js";

interface CompactToolbarControls {
  readonly titleLabel: St.Label;
  readonly expandAllButton: St.Button;
  readonly expandAllLabel: St.Label;
}

/** Rebuilds the compact panel body from one freshly derived plan. */
export class CompactPanelSection implements PanelStyleSection {
  private _settings: Gio.Settings;
  private _lastRefreshAt: number | null = null;
  private _lastView: ProviderViewContext;
  private _expandedOverrides: Map<ProviderName, boolean> = new Map();
  private _controls: CompactToolbarControls;
  readonly shell: PanelShell;

  constructor(
    settings: Gio.Settings,
    fieldDefs: Readonly<Record<ProviderName, readonly FieldDef[]>>,
    shell: PanelShell,
  ) {
    this._settings = settings;
    this.shell = shell;
    this._controls = this._buildToolbar();
    this._lastView = emptyViewContext(fieldDefs, this._currentLocale(), _);
    this.render({ lastRefreshAt: null, view: this._lastView });
  }

  destroy(): void {
    this.shell.destroy();
  }

  render(context: PanelRenderContext): void {
    this._lastRefreshAt = context.lastRefreshAt;
    this._lastView = context.view;
    const plan = this._buildPlan(context.view);

    this.shell.clearBody();
    if (plan.phase !== "ready") {
      if (plan.messageText) this.shell.addEmptyStateRow(plan.messageText);
    } else {
      plan.providers.forEach((providerPlan, index) => {
        this._addProviderSection(providerPlan, index > 0);
      });
    }
    this._syncToolbar(plan);
  }

  setRunning(running: boolean): void {
    this.shell.setRunning(running);
  }

  private _currentLocale(): string {
    return resolveLocale(
      this._settings.get_string("language"),
      GLib.getenv("LC_MESSAGES"),
      GLib.getenv("LANG"),
    );
  }

  private _buildPlan(view: ProviderViewContext): PanelMatrixPlan {
    return planPanelMatrix(view, this._expandedOverrides);
  }

  private _toggleProvider(provider: ProviderName, forceState?: boolean): void {
    const plan = this._buildPlan(this._lastView);
    const enabledCount = plan.providers.length;
    const current = resolveProviderExpanded(provider, enabledCount, this._expandedOverrides);
    const next = forceState ?? !current;
    if (next === current) return;
    this._expandedOverrides.set(provider, next);
    this.render({ lastRefreshAt: this._lastRefreshAt, view: this._lastView });
  }

  private _toggleAllProviders(): void {
    const plan = this._buildPlan(this._lastView);
    if (!plan.canToggleAll) return;
    const providers = plan.providers.map((p) => p.provider);
    this._expandedOverrides = toggleAllProvidersExpanded(
      providers,
      providers.length,
      this._expandedOverrides,
    );
    this.render({ lastRefreshAt: this._lastRefreshAt, view: this._lastView });
  }

  /** The compact toolbar is owned here; the shell only supplies the shared footer actors. */
  private _buildToolbar(): CompactToolbarControls {
    const footer = this.shell.footer;

    const leftBox = new St.BoxLayout({
      style_class: "provider-limits-hud-toolbar-left",
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    const titleLabel = new St.Label({
      text: _("Provider Limits"),
      style_class: "provider-limits-hud-title",
      y_align: Clutter.ActorAlign.CENTER,
    });
    titleLabel.accessible_name = titleLabel.text;
    leftBox.add_child(titleLabel);
    leftBox.add_child(footer.lastRefreshLabel);

    const actionsBox = new St.BoxLayout({
      style_class: "provider-limits-hud-actions",
      y_align: Clutter.ActorAlign.CENTER,
    });
    const expandAllLabel = new St.Label({
      text: "▾",
      style_class: "provider-limits-toolbar-glyph",
      y_align: Clutter.ActorAlign.CENTER,
    });
    const expandAllButton = new St.Button({
      child: expandAllLabel,
      style_class: "provider-limits-icon-button",
      reactive: true,
      can_focus: true,
      visible: false,
      y_align: Clutter.ActorAlign.CENTER,
    });
    expandAllButton.accessible_name = _("Expand all");
    bindActivation(expandAllButton, () => this._toggleAllProviders(), {
      pointerSignals: ["clicked"],
    });
    actionsBox.add_child(expandAllButton);
    actionsBox.add_child(footer.refreshControl);
    actionsBox.add_child(footer.settingsControl);

    footer.row.add_child(leftBox);
    footer.row.add_child(actionsBox);

    return { titleLabel, expandAllButton, expandAllLabel };
  }

  private _syncToolbar(plan: PanelMatrixPlan): void {
    this._controls.titleLabel.text = _("Provider Limits");
    this._controls.titleLabel.accessible_name = this._controls.titleLabel.text;

    this._controls.expandAllButton.visible = plan.canToggleAll;
    this._controls.expandAllLabel.text = plan.allExpanded ? "▴" : "▾";
    this._controls.expandAllButton.accessible_name = plan.allExpanded
      ? _("Collapse all")
      : _("Expand all");
  }

  private _addProviderSection(plan: ProviderMatrixPlan, divided: boolean): void {
    const headerRow = this.shell.addStaticRow();
    headerRow.add_style_class_name("provider-limits-matrix-header");
    if (divided) {
      headerRow.add_style_class_name("provider-limits-matrix-group-divided");
    }
    headerRow.accessible_name = plan.headerAccessibleName;
    bindActivation(headerRow, () => this._toggleProvider(plan.provider), {
      pointerSignals: ["button-release-event"],
      onOtherKey: (event) => {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Left) {
          this._toggleProvider(plan.provider, false);
          return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_Right) {
          this._toggleProvider(plan.provider, true);
          return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
      },
    });

    const headerStack = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      style_class: "provider-limits-header-stack",
    });

    const topLine = new St.BoxLayout({
      x_expand: true,
      style_class: "provider-limits-header-line",
      y_align: Clutter.ActorAlign.CENTER,
    });

    const leftTitleBox = new St.BoxLayout({
      x_expand: true,
      style_class: "provider-limits-header-left",
      y_align: Clutter.ActorAlign.CENTER,
    });

    const chevronLabel = new St.Label({
      text: plan.chevron,
      style_class: "provider-limits-chevron",
      y_align: Clutter.ActorAlign.CENTER,
    });
    leftTitleBox.add_child(chevronLabel);

    const titleLabel = new St.Label({
      text: plan.displayName,
      style_class: "provider-limits-panel-header",
      y_align: Clutter.ActorAlign.CENTER,
    });
    leftTitleBox.add_child(titleLabel);

    if (plan.statusBadge) {
      const badgeLabel = new St.Label({
        text: plan.statusBadge,
        style_class: "provider-limits-status-badge",
        y_align: Clutter.ActorAlign.CENTER,
      });
      applyQuietToneClass(badgeLabel, plan.status === "partial" ? "warning" : "error");
      leftTitleBox.add_child(badgeLabel);
    }

    const rightSummaryBox = new St.BoxLayout({
      style_class: "provider-limits-header-right",
      x_align: Clutter.ActorAlign.END,
      y_align: Clutter.ActorAlign.CENTER,
    });

    if (plan.fiveSegmentBar) {
      const fiveSegLabel = new St.Label({
        text: plan.fiveSegmentBar,
        style_class: "provider-limits-micro-bar",
        y_align: Clutter.ActorAlign.CENTER,
      });
      applyQuietToneClass(fiveSegLabel, plan.headerTone);
      rightSummaryBox.add_child(fiveSegLabel);
    }

    const summaryLabel = new St.Label({
      text: plan.primarySummary,
      style_class: "provider-limits-header-summary provider-limits-tnum",
      x_align: Clutter.ActorAlign.END,
      y_align: Clutter.ActorAlign.CENTER,
    });
    applyQuietToneClass(summaryLabel, plan.headerTone);
    rightSummaryBox.add_child(summaryLabel);

    topLine.add_child(leftTitleBox);
    topLine.add_child(rightSummaryBox);
    headerStack.add_child(topLine);

    const hairlineTrack = new St.BoxLayout({
      style_class: "provider-limits-hairline-track",
      x_expand: true,
    });
    const hairlineFill = new St.Widget({
      style_class: "provider-limits-hairline-fill",
      x_expand: false,
      x_align: Clutter.ActorAlign.START,
    });
    hairlineTrack.add_child(hairlineFill);

    const fillState = { ratio: plan.fillRatio };
    hairlineTrack.connect("notify::width", () => {
      this._updateHairlineWidth(hairlineTrack, hairlineFill, fillState.ratio);
    });
    this._syncHairlineBar(hairlineTrack, hairlineFill, plan.fillRatio, plan.headerTone);

    headerStack.add_child(hairlineTrack);
    headerRow.add_child(headerStack);
    this.shell.addBodyItem(headerRow);

    if (!plan.expanded) return;

    const detailRow = this.shell.addStaticRow();
    detailRow.add_style_class_name("provider-limits-matrix-detail");

    const table = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      style_class: "provider-limits-matrix-table",
    });

    if (plan.detailText !== null) {
      const detailLabel = new St.Label({
        text: plan.detailText,
        style_class: "provider-limits-callout-partial",
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
      });
      detailLabel.clutter_text.line_wrap = true;
      detailLabel.accessible_name = plan.detailText;
      table.add_child(detailLabel);
    }

    if (plan.errorText !== null) {
      const errorLabel = new St.Label({
        text: plan.errorText,
        style_class: "provider-limits-callout-error provider-limits-error",
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
      });
      errorLabel.clutter_text.line_wrap = true;
      errorLabel.accessible_name = plan.errorText;
      table.add_child(errorLabel);
    }

    for (const groupPlan of plan.groups) {
      const heading = new St.Label({
        text: groupPlan.title,
        style_class: "provider-limits-group-heading",
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
      });
      heading.accessible_name = groupPlan.title;
      table.add_child(heading);

      for (const rowPlan of groupPlan.rows) this._buildMatrixRow(table, rowPlan);
    }

    if (plan.lastUpdatedText !== null) {
      const lastUpdatedLabel = new St.Label({
        text: plan.lastUpdatedText,
        style_class: "provider-limits-dim provider-limits-last-updated provider-limits-tnum",
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
      });
      lastUpdatedLabel.accessible_name = plan.lastUpdatedText;
      table.add_child(lastUpdatedLabel);
    }

    detailRow.add_child(table);
    this.shell.addBodyItem(detailRow);
  }

  private _buildMatrixRow(table: St.BoxLayout, rowPlan: MatrixDetailRow): void {
    const line = new St.BoxLayout({
      x_expand: true,
      style_class: "provider-limits-matrix-row",
      y_align: Clutter.ActorAlign.CENTER,
    });

    const labelLabel = new St.Label({
      text: rowPlan.labelText,
      style_class: "provider-limits-field-label",
      x_expand: true,
      x_align: Clutter.ActorAlign.START,
      y_align: Clutter.ActorAlign.CENTER,
    });
    labelLabel.accessible_name = rowPlan.labelText;
    line.add_child(labelLabel);

    if (rowPlan.microBar !== null) {
      const microBarLabel = new St.Label({
        text: rowPlan.microBar,
        style_class: "provider-limits-micro-bar",
        y_align: Clutter.ActorAlign.CENTER,
      });
      applyQuietToneClass(microBarLabel, rowPlan.tone);
      line.add_child(microBarLabel);
    }

    const valueLabel = new St.Label({
      text: rowPlan.valueText,
      style_class: "provider-limits-field-value provider-limits-tnum",
      x_align: Clutter.ActorAlign.END,
      y_align: Clutter.ActorAlign.CENTER,
    });
    valueLabel.accessible_name = rowPlan.accessibleText;
    applyToneClass(valueLabel, rowPlan.tone);
    line.add_child(valueLabel);

    table.add_child(line);

    if (rowPlan.errorText) {
      const errorLabel = new St.Label({
        text: rowPlan.errorText,
        style_class: "provider-limits-error provider-limits-row-error",
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
      });
      errorLabel.clutter_text.line_wrap = true;
      errorLabel.accessible_name = rowPlan.errorText;
      table.add_child(errorLabel);
    }
  }

  private _syncHairlineBar(
    track: St.BoxLayout,
    fill: St.Widget,
    ratio: number | null,
    tone: ProviderMatrixPlan["headerTone"],
  ): void {
    fill.remove_style_class_name("hairline-warning");
    fill.remove_style_class_name("hairline-critical");
    fill.remove_style_class_name("hairline-error");

    if (tone === "warning") fill.add_style_class_name("hairline-warning");
    else if (tone === "critical") fill.add_style_class_name("hairline-critical");
    else if (tone === "error") fill.add_style_class_name("hairline-error");

    this._updateHairlineWidth(track, fill, ratio);
  }

  private _updateHairlineWidth(track: St.BoxLayout, fill: St.Widget, ratio: number | null): void {
    if (ratio === null || ratio <= 0) {
      fill.visible = false;
      fill.width = 0;
      return;
    }
    fill.visible = true;
    const clamped = clampFillRatio(ratio);
    const trackWidth = track.width ?? 0;
    if (trackWidth > 0) {
      fill.width = Math.max(2, Math.round(trackWidth * clamped));
    }
  }
}
