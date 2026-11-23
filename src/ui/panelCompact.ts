import Clutter from "gi://Clutter";
import type Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";
import type * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import { PROVIDER_NAMES, type ProviderName } from "../constants.js";
import { gettext as _ } from "../helpers/gettext.js";
import { bindActivation } from "../helpers/keyboard.js";
import { resolveLocale } from "../helpers/locale.js";
import { normalizeProvidersOrder, providerDisplayName } from "../helpers/provider-settings.js";
import type { BaseReader, FieldDef, ReaderResult } from "../readers/base.js";
import {
  planPanelMatrix,
  resolveProviderExpanded,
  toggleAllProvidersExpanded,
} from "./matrixPlan.js";
import type { MatrixDetailRow, PanelMatrixPlan, ProviderMatrixPlan } from "./matrixPlan.js";
import type { PanelRenderContext, PanelShell, PanelStyleSection } from "./panelShell.js";
import { PlanRenderer, type RenderPlan } from "./statusBarRenderer.js";
import { applyQuietToneClass, applyToneClass } from "./tone.js";
import { clampFillRatio } from "./usageSnapshot.js";

interface CompactToolbarControls {
  readonly titleLabel: St.Label;
  readonly expandAllButton: St.Button;
  readonly expandAllLabel: St.Label;
}

interface DetailRowWidgets {
  microBar: St.Label | null;
  value: St.Label;
  error: St.Label | null;
}

interface DetailGroupWidgets {
  heading: St.Label;
  rows: DetailRowWidgets[];
}

interface ProviderSectionWidgets {
  provider: ProviderName;
  headerRow: PopupMenu.PopupBaseMenuItem;
  chevronLabel: St.Label;
  titleLabel: St.Label;
  badgeLabel: St.Label | null;
  fiveSegLabel: St.Label | null;
  summaryLabel: St.Label;
  hairlineTrack: St.BoxLayout;
  hairlineFill: St.Widget;
  fillState: { ratio: number | null };
  detailLabel: St.Label | null;
  errorLabel: St.Label | null;
  groups: DetailGroupWidgets[];
  lastUpdatedLabel: St.Label | null;
}

type CompactRenderPlan = PanelMatrixPlan &
  RenderPlan & {
    readonly lastRefreshAt: number | null;
  };

export class CompactPanelSection
  extends PlanRenderer<CompactRenderPlan, PanelRenderContext>
  implements PanelStyleSection
{
  private _settings: Gio.Settings;
  private readonly _fieldDefs: Readonly<Record<ProviderName, readonly FieldDef[]>>;
  private _running = false;
  private _lastResults: Map<ProviderName, ReaderResult> = new Map();
  private _lastRefreshAt: number | null = null;
  private _expandedOverrides: Map<ProviderName, boolean> = new Map();
  private _controls: CompactToolbarControls;

  private _sections: ProviderSectionWidgets[] = [];
  private _emptyMessageLabel: St.Label | null = null;
  readonly shell: PanelShell;

  constructor(
    settings: Gio.Settings,
    _readers: Map<ProviderName, BaseReader>,
    fieldDefs: Readonly<Record<ProviderName, readonly FieldDef[]>>,
    shell: PanelShell,
  ) {
    super();
    this._settings = settings;
    this._fieldDefs = fieldDefs;
    this.shell = shell;
    this._controls = this._buildToolbar();
    this.render({ results: new Map(), lastRefreshAt: null });
  }

  destroy(): void {
    this.shell.destroy();
  }

  protected plan(context: PanelRenderContext): CompactRenderPlan {
    this._lastResults = context.results;
    this._lastRefreshAt = context.lastRefreshAt;
    const matrixPlan = this._buildPlan(context.results);
    return { ...matrixPlan, lastRefreshAt: context.lastRefreshAt };
  }

  protected clear(): void {
    this.shell.clearBody();
  }

  protected override onDispose(): void {
    this._sections = [];
    this._emptyMessageLabel = null;
  }

  setLastRefreshAt(lastRefreshAt: number | null): void {
    this._lastRefreshAt = lastRefreshAt;
    this.shell.setLastRefreshAt(lastRefreshAt);
  }

  setRunning(running: boolean): void {
    this._running = running;
    this.shell.setRunning(running);
  }

  private _currentLocale(): string {
    return resolveLocale(
      this._settings.get_string("language"),
      GLib.getenv("LC_MESSAGES"),
      GLib.getenv("LANG"),
    );
  }

  private _buildPlan(results: Map<ProviderName, ReaderResult>): PanelMatrixPlan {
    const rawOrder = this._settings.get_strv("providers-order");
    const order = normalizeProvidersOrder(rawOrder);
    const locale = this._currentLocale();

    const enabledProviders = new Set<ProviderName>();
    const displayNames = {} as Record<ProviderName, string>;
    const statusFields = {} as Record<ProviderName, readonly string[]>;
    const panelFields = {} as Record<ProviderName, readonly string[]>;

    for (const name of PROVIDER_NAMES) {
      const enabled = this._settings.get_boolean(`${name}-enabled`);
      if (enabled) enabledProviders.add(name);

      displayNames[name] = providerDisplayName(this._settings, name);
      statusFields[name] = this._settings.get_strv(`${name}-status-fields`);
      panelFields[name] = this._settings.get_strv(`${name}-panel-fields`);
    }

    return planPanelMatrix({
      order,
      enabledProviders,
      results,
      displayNames,
      statusFields,
      panelFields,
      expandedOverrides: this._expandedOverrides,
      fieldDefs: this._fieldDefs,
      locale,
      t: _,
    });
  }

  private _toggleProvider(provider: ProviderName, forceState?: boolean): void {
    const plan = this._buildPlan(this._lastResults);
    const enabledCount = plan.providers.length;
    const current = resolveProviderExpanded(provider, enabledCount, this._expandedOverrides);
    const next = forceState ?? !current;
    if (next === current) return;
    this._expandedOverrides.set(provider, next);
    this.render({ results: this._lastResults, lastRefreshAt: this._lastRefreshAt });
  }

  private _toggleAllProviders(): void {
    const plan = this._buildPlan(this._lastResults);
    if (!plan.canToggleAll) return;
    const providers = plan.providers.map((p) => p.provider);
    this._expandedOverrides = toggleAllProvidersExpanded(
      providers,
      providers.length,
      this._expandedOverrides,
    );
    this.render({ results: this._lastResults, lastRefreshAt: this._lastRefreshAt });
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

  private _syncToolbar(plan: PanelMatrixPlan, lastRefreshAt: number | null): void {
    this._controls.titleLabel.text = _("Provider Limits");
    this._controls.titleLabel.accessible_name = this._controls.titleLabel.text;

    this._controls.expandAllButton.visible = plan.canToggleAll;
    this._controls.expandAllLabel.text = plan.allExpanded ? "▴" : "▾";
    this._controls.expandAllButton.accessible_name = plan.allExpanded
      ? _("Collapse all")
      : _("Expand all");

    this.setRunning(this._running);
    this.setLastRefreshAt(lastRefreshAt);
  }

  protected build(plan: CompactRenderPlan): void {
    if (plan.state !== "ready") {
      if (plan.messageText) {
        this._emptyMessageLabel = this.shell.addEmptyStateRow(plan.messageText);
      }
      this._syncToolbar(plan, plan.lastRefreshAt);
      return;
    }

    plan.providers.forEach((providerPlan, index) => {
      this._sections.push(this._addProviderSection(providerPlan, index > 0));
    });

    this._syncToolbar(plan, plan.lastRefreshAt);
  }

  protected update(plan: CompactRenderPlan): void {
    if (plan.state !== "ready") {
      if (this._emptyMessageLabel && plan.messageText) {
        this._emptyMessageLabel.text = plan.messageText;
        this._emptyMessageLabel.accessible_name = plan.messageText;
      }
      this._syncToolbar(plan, plan.lastRefreshAt);
      return;
    }

    plan.providers.forEach((providerPlan, index) => {
      const section = this._sections[index];
      if (!section) return;

      section.headerRow.accessible_name = providerPlan.headerAccessibleName;
      section.chevronLabel.text = providerPlan.chevron;
      section.titleLabel.text = providerPlan.displayName;
      if (section.badgeLabel) {
        section.badgeLabel.text = providerPlan.statusBadge;
        applyQuietToneClass(
          section.badgeLabel,
          providerPlan.status === "partial" ? "warning" : "error",
        );
      }
      if (section.fiveSegLabel) {
        section.fiveSegLabel.text = providerPlan.fiveSegmentBar;
        applyQuietToneClass(section.fiveSegLabel, providerPlan.headerTone);
      }
      section.summaryLabel.text = providerPlan.primarySummary;
      applyQuietToneClass(section.summaryLabel, providerPlan.headerTone);

      section.fillState.ratio = providerPlan.fillRatio;
      this._syncHairlineBar(
        section.hairlineTrack,
        section.hairlineFill,
        providerPlan.fillRatio,
        providerPlan.headerTone,
      );

      if (section.detailLabel && providerPlan.detailText) {
        section.detailLabel.text = providerPlan.detailText;
        section.detailLabel.accessible_name = providerPlan.detailText;
      }

      if (section.errorLabel && providerPlan.errorText) {
        section.errorLabel.text = providerPlan.errorText;
        section.errorLabel.accessible_name = providerPlan.errorText;
      }

      providerPlan.groups.forEach((groupPlan, groupIdx) => {
        const groupWidgets = section.groups[groupIdx];
        if (!groupWidgets) return;
        groupWidgets.heading.text = groupPlan.title;

        groupPlan.rows.forEach((rowPlan, rowIdx) => {
          const rowWidgets = groupWidgets.rows[rowIdx];
          if (!rowWidgets) return;

          if (rowWidgets.microBar && rowPlan.microBar !== null) {
            rowWidgets.microBar.text = rowPlan.microBar;
            applyQuietToneClass(rowWidgets.microBar, rowPlan.tone);
          }

          rowWidgets.value.text = rowPlan.valueText;
          rowWidgets.value.accessible_name = rowPlan.accessibleText;
          applyToneClass(rowWidgets.value, rowPlan.tone);

          if (rowWidgets.error && rowPlan.errorText) {
            rowWidgets.error.text = rowPlan.errorText;
            rowWidgets.error.accessible_name = rowPlan.errorText;
          }
        });
      });

      if (section.lastUpdatedLabel && providerPlan.lastUpdatedText) {
        section.lastUpdatedLabel.text = providerPlan.lastUpdatedText;
        section.lastUpdatedLabel.accessible_name = providerPlan.lastUpdatedText;
      }
    });

    this._syncToolbar(plan, plan.lastRefreshAt);
  }

  private _addProviderSection(plan: ProviderMatrixPlan, divided: boolean): ProviderSectionWidgets {
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

    let badgeLabel: St.Label | null = null;
    if (plan.statusBadge) {
      badgeLabel = new St.Label({
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

    let fiveSegLabel: St.Label | null = null;
    if (plan.fiveSegmentBar) {
      fiveSegLabel = new St.Label({
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

    if (!plan.expanded) {
      return {
        provider: plan.provider,
        headerRow,
        chevronLabel,
        titleLabel,
        badgeLabel,
        fiveSegLabel,
        summaryLabel,
        hairlineTrack,
        hairlineFill,
        fillState,
        detailLabel: null,
        errorLabel: null,
        groups: [],
        lastUpdatedLabel: null,
      };
    }

    const detailRow = this.shell.addStaticRow();
    detailRow.add_style_class_name("provider-limits-matrix-detail");

    const table = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      style_class: "provider-limits-matrix-table",
    });

    let detailLabel: St.Label | null = null;
    if (plan.detailText !== null) {
      detailLabel = new St.Label({
        text: plan.detailText,
        style_class: "provider-limits-callout-partial",
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
      });
      detailLabel.clutter_text.line_wrap = true;
      detailLabel.accessible_name = plan.detailText;
      table.add_child(detailLabel);
    }

    let errorLabel: St.Label | null = null;
    if (plan.errorText !== null) {
      errorLabel = new St.Label({
        text: plan.errorText,
        style_class: "provider-limits-callout-error provider-limits-error",
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
      });
      errorLabel.clutter_text.line_wrap = true;
      errorLabel.accessible_name = plan.errorText;
      table.add_child(errorLabel);
    }

    const groups: DetailGroupWidgets[] = plan.groups.map((groupPlan) => {
      const heading = new St.Label({
        text: groupPlan.title,
        style_class: "provider-limits-group-heading",
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
      });
      heading.accessible_name = groupPlan.title;
      table.add_child(heading);

      const rows = groupPlan.rows.map((rowPlan) => this._buildMatrixRow(table, rowPlan));
      return { heading, rows };
    });

    let lastUpdatedLabel: St.Label | null = null;
    if (plan.lastUpdatedText !== null) {
      lastUpdatedLabel = new St.Label({
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

    return {
      provider: plan.provider,
      headerRow,
      chevronLabel,
      titleLabel,
      badgeLabel,
      fiveSegLabel,
      summaryLabel,
      hairlineTrack,
      hairlineFill,
      fillState,
      detailLabel,
      errorLabel,
      groups,
      lastUpdatedLabel,
    };
  }

  private _buildMatrixRow(table: St.BoxLayout, rowPlan: MatrixDetailRow): DetailRowWidgets {
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

    let microBarLabel: St.Label | null = null;
    if (rowPlan.microBar !== null) {
      microBarLabel = new St.Label({
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

    let errorLabel: St.Label | null = null;
    if (rowPlan.errorText) {
      errorLabel = new St.Label({
        text: rowPlan.errorText,
        style_class: "provider-limits-error provider-limits-row-error",
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
      });
      errorLabel.clutter_text.line_wrap = true;
      errorLabel.accessible_name = rowPlan.errorText;
      table.add_child(errorLabel);
    }

    return { microBar: microBarLabel, value: valueLabel, error: errorLabel };
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
