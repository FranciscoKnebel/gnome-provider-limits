import Clutter from "gi://Clutter";
import St from "gi://St";

import type { ProviderName } from "../constants.js";
import { gettext as _ } from "../helpers/gettext.js";
import { bindActivation } from "../helpers/keyboard.js";
import { ReaderStatus } from "../readers/base.js";
import type { ProviderDisplayModel } from "./displayModel.js";
import { createErrorLabel } from "./errorLabel.js";
import { clampFillRatio } from "./fieldRows.js";
import type { FieldView, UsageFacts } from "./fieldViews.js";
import {
  areAllProvidersExpanded,
  formatSegmentedBar,
  resolveProviderExpanded,
  toggleAllProvidersExpanded,
} from "./matrixPlan.js";
import { PanelStyleSection, type PanelRenderContext, type PanelShell } from "./panelShell.js";
import { applyQuietToneClass, applyToneClass } from "./tone.js";
import { emptyViewContext, type ProviderViewContext } from "./viewContext.js";
import { matrixMessages, phaseResult } from "./viewMessages.js";

export interface ExpandAllControl {
  readonly button: St.Button;
  readonly label: St.Label;
}

/** Compact's one extra footer control, assembled by the shared shell. */
export function createExpandAllControl(): ExpandAllControl {
  const label = new St.Label({
    text: "▾",
    style_class: "provider-limits-toolbar-glyph",
    y_align: Clutter.ActorAlign.CENTER,
  });
  const button = new St.Button({
    child: label,
    style_class: "provider-limits-icon-button",
    reactive: true,
    can_focus: true,
    visible: false,
    y_align: Clutter.ActorAlign.CENTER,
  });
  button.accessible_name = _("Expand all");
  return { button, label };
}

/** Rebuilds the compact panel body from the canonical models and their facts. */
export class CompactPanelSection extends PanelStyleSection {
  private _lastRefreshAt: number | null = null;
  private _lastView: ProviderViewContext;
  private _defaultExpanded = false;
  private _expandedOverrides: Map<ProviderName, boolean> = new Map();
  private readonly _expandAll: ExpandAllControl;

  constructor(shell: PanelShell, expandAll: ExpandAllControl) {
    super(shell);
    this._expandAll = expandAll;
    bindActivation(expandAll.button, () => this._toggleAllProviders(), {
      pointerSignals: ["clicked"],
    });
    this._lastView = emptyViewContext("", _);
    this.render({ lastRefreshAt: null, view: this._lastView });
  }

  override render(context: PanelRenderContext): void {
    this._lastRefreshAt = context.lastRefreshAt;
    this._lastView = context.view;
    this._defaultExpanded = context.view.activeProviders.length <= 2;

    const phase = phaseResult(context.view, matrixMessages);
    this.shell.clearBody();
    if (phase.kind === "placeholder") {
      this.shell.addEmptyStateRow(phase.message.title);
    } else {
      const models = context.view.models;
      models.forEach((model, index) => {
        const expanded = resolveProviderExpanded(
          model.provider,
          this._defaultExpanded,
          this._expandedOverrides,
        );
        this._addProviderSection(model, index > 0, expanded);
      });
    }
    this._syncToolbar();
  }

  private _toggleProvider(provider: ProviderName, forceState?: boolean): void {
    const current = resolveProviderExpanded(
      provider,
      this._defaultExpanded,
      this._expandedOverrides,
    );
    const next = forceState ?? !current;
    if (next === current) return;
    this._expandedOverrides.set(provider, next);
    this.render({ lastRefreshAt: this._lastRefreshAt, view: this._lastView });
  }

  private _toggleAllProviders(): void {
    const providers = this._lastView.models.map((model) => model.provider);
    if (providers.length === 0) return;
    this._expandedOverrides = toggleAllProvidersExpanded(
      providers,
      this._defaultExpanded,
      this._expandedOverrides,
    );
    this.render({ lastRefreshAt: this._lastRefreshAt, view: this._lastView });
  }

  private _syncToolbar(): void {
    const providers = this._lastView.activeProviders;
    const allExpanded = areAllProvidersExpanded(
      providers,
      this._defaultExpanded,
      this._expandedOverrides,
    );
    this._expandAll.button.visible = this._lastView.models.length > 0;
    this._expandAll.label.text = allExpanded ? "▴" : "▾";
    this._expandAll.button.accessible_name = allExpanded ? _("Collapse all") : _("Expand all");
  }

  private _addProviderSection(
    model: ProviderDisplayModel,
    divided: boolean,
    expanded: boolean,
  ): void {
    const facts = model.facts;
    const header = facts.usage.header;
    const statusBadge = facts.badges.status;
    const fiveSegmentBar = header.fillRatio !== null ? formatSegmentedBar(header.fillRatio, 5) : "";
    const headerTone = header.tone;
    const showRows = facts.diagnostic.errorText === null;

    const accessibleParts = [model.displayName];
    if (statusBadge) accessibleParts.push(statusBadge);
    if (header.summaryText) accessibleParts.push(header.summaryText);
    const headerAccessibleName = accessibleParts.join(" ");

    const headerRow = this.shell.addStaticRow();
    headerRow.add_style_class_name("provider-limits-matrix-header");
    if (divided) {
      headerRow.add_style_class_name("provider-limits-matrix-group-divided");
    }
    headerRow.accessible_name = headerAccessibleName;
    bindActivation(headerRow, () => this._toggleProvider(model.provider), {
      pointerSignals: ["button-release-event"],
      onOtherKey: (event) => {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Left) {
          this._toggleProvider(model.provider, false);
          return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_Right) {
          this._toggleProvider(model.provider, true);
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
      text: expanded ? "▾" : "▸",
      style_class: "provider-limits-chevron",
      y_align: Clutter.ActorAlign.CENTER,
    });
    leftTitleBox.add_child(chevronLabel);

    const titleLabel = new St.Label({
      text: model.displayName,
      style_class: "provider-limits-panel-header",
      y_align: Clutter.ActorAlign.CENTER,
    });
    leftTitleBox.add_child(titleLabel);

    if (statusBadge) {
      const badgeLabel = new St.Label({
        text: statusBadge,
        style_class: "provider-limits-status-badge",
        y_align: Clutter.ActorAlign.CENTER,
      });
      applyQuietToneClass(badgeLabel, model.status === ReaderStatus.PARTIAL ? "warning" : "error");
      leftTitleBox.add_child(badgeLabel);
    }

    const rightSummaryBox = new St.BoxLayout({
      style_class: "provider-limits-header-right",
      x_align: Clutter.ActorAlign.END,
      y_align: Clutter.ActorAlign.CENTER,
    });

    if (fiveSegmentBar) {
      const fiveSegLabel = new St.Label({
        text: fiveSegmentBar,
        style_class: "provider-limits-micro-bar",
        y_align: Clutter.ActorAlign.CENTER,
      });
      applyQuietToneClass(fiveSegLabel, headerTone);
      rightSummaryBox.add_child(fiveSegLabel);
    }

    const summaryLabel = new St.Label({
      text: header.summaryText,
      style_class: "provider-limits-header-summary provider-limits-tnum",
      x_align: Clutter.ActorAlign.END,
      y_align: Clutter.ActorAlign.CENTER,
    });
    applyQuietToneClass(summaryLabel, headerTone);
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

    const fillState = { ratio: header.fillRatio };
    hairlineTrack.connect("notify::width", () => {
      this._updateHairlineWidth(hairlineTrack, hairlineFill, fillState.ratio);
    });
    this._syncHairlineBar(hairlineTrack, hairlineFill, header.fillRatio, headerTone);

    headerStack.add_child(hairlineTrack);
    headerRow.add_child(headerStack);
    this.shell.addBodyItem(headerRow);

    if (!expanded) return;

    const detailRow = this.shell.addStaticRow();
    detailRow.add_style_class_name("provider-limits-matrix-detail");

    const table = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      style_class: "provider-limits-matrix-table",
    });

    if (facts.diagnostic.detailText !== null) {
      const detailLabel = new St.Label({
        text: facts.diagnostic.detailText,
        style_class: "provider-limits-callout-partial",
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
      });
      detailLabel.clutter_text.line_wrap = true;
      detailLabel.accessible_name = facts.diagnostic.detailText;
      table.add_child(detailLabel);
    }

    if (facts.diagnostic.errorText !== null) {
      const errorLabel = createErrorLabel(
        facts.diagnostic.errorText,
        "provider-limits-callout-error provider-limits-error",
      );
      errorLabel.x_align = Clutter.ActorAlign.START;
      errorLabel.accessible_name = facts.diagnostic.errorText;
      table.add_child(errorLabel);
    }

    if (showRows) {
      const rows = this._detailRows(model);
      const t = this._lastView.t;
      if (rows.limits.length > 0) {
        this._addGroup(table, t("Limits"), rows.limits);
      }
      if (rows.telemetry.length > 0) {
        this._addGroup(table, t("Telemetry"), rows.telemetry);
      }

      if (facts.lastUpdatedText !== null) {
        const lastUpdatedLabel = new St.Label({
          text: facts.lastUpdatedText,
          style_class: "provider-limits-dim provider-limits-last-updated provider-limits-tnum",
          x_expand: true,
          x_align: Clutter.ActorAlign.START,
        });
        lastUpdatedLabel.accessible_name = facts.lastUpdatedText;
        table.add_child(lastUpdatedLabel);
      }
    }

    detailRow.add_child(table);
    this.shell.addBodyItem(detailRow);
  }

  /**
   * Detail rows for the HUD: every panel field, including reset timestamps
   * consumed by the gauge and card styles. The filtering decision lives here
   * instead of a second renderer-specific envelope on ProviderDisplayFacts.
   */
  private _detailRows(model: ProviderDisplayModel): {
    readonly limits: readonly FieldView[];
    readonly telemetry: readonly FieldView[];
  } {
    const limits: FieldView[] = [];
    const telemetry: FieldView[] = [];
    for (const view of model.panelViews) {
      if (view.category === "telemetry") telemetry.push(view);
      else limits.push(view);
    }
    return { limits, telemetry };
  }

  private _addGroup(table: St.BoxLayout, title: string, rows: readonly FieldView[]): void {
    const heading = new St.Label({
      text: title,
      style_class: "provider-limits-group-heading",
      x_expand: true,
      x_align: Clutter.ActorAlign.START,
    });
    heading.accessible_name = title;
    table.add_child(heading);

    for (const view of rows) this._buildMatrixRow(table, view);
  }

  private _buildMatrixRow(table: St.BoxLayout, view: FieldView): void {
    const microBar =
      view.type === "percent" && view.category === "limit" && view.ratio !== null
        ? formatSegmentedBar(view.ratio, 8)
        : null;

    const line = new St.BoxLayout({
      x_expand: true,
      style_class: "provider-limits-matrix-row",
      y_align: Clutter.ActorAlign.CENTER,
    });

    const labelLabel = new St.Label({
      text: view.labelText,
      style_class: "provider-limits-field-label",
      x_expand: true,
      x_align: Clutter.ActorAlign.START,
      y_align: Clutter.ActorAlign.CENTER,
    });
    labelLabel.accessible_name = view.labelText;
    line.add_child(labelLabel);

    if (microBar !== null) {
      const microBarLabel = new St.Label({
        text: microBar,
        style_class: "provider-limits-micro-bar",
        y_align: Clutter.ActorAlign.CENTER,
      });
      applyQuietToneClass(microBarLabel, view.tone);
      line.add_child(microBarLabel);
    }

    const valueLabel = new St.Label({
      text: view.valueText,
      style_class: "provider-limits-field-value provider-limits-tnum",
      x_align: Clutter.ActorAlign.END,
      y_align: Clutter.ActorAlign.CENTER,
    });
    valueLabel.accessible_name = view.accessibleText;
    applyToneClass(valueLabel, view.tone);
    line.add_child(valueLabel);

    table.add_child(line);

    if (view.errorText) {
      const errorLabel = createErrorLabel(
        view.errorText,
        "provider-limits-error provider-limits-row-error",
      );
      errorLabel.x_align = Clutter.ActorAlign.START;
      errorLabel.accessible_name = view.errorText;
      table.add_child(errorLabel);
    }
  }

  private _syncHairlineBar(
    track: St.BoxLayout,
    fill: St.Widget,
    ratio: number | null,
    tone: UsageFacts["tone"],
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
