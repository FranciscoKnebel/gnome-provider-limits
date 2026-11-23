import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import St from "gi://St";

import { PROVIDER_NAMES, type ProviderName } from "../constants.js";
import { gettext as _ } from "../helpers/gettext.js";
import { resolveLocale } from "../helpers/locale.js";
import { normalizeProvidersOrder, providerDisplayNameShort } from "../helpers/provider-settings.js";
import type { BaseReader, FieldDef, ReaderResult } from "../readers/base.js";
import { ReaderStatus } from "../readers/base.js";
import { PROVIDER_FIELDS } from "../readers/fields.js";
import { planStatusBar as planCardsStatusBar } from "./cardPlan.js";
import type { StatusBarPlan as CardsStatusBarPlan } from "./cardPlan.js";
import {
  computeStatusMicroMeter,
  disposeCairoContext,
  drawMicroRing,
  isCairoContext,
} from "./cockpitModel.js";
import type { MicroMeterSpec } from "./cockpitModel.js";
import { getFieldRows } from "./fieldRows.js";
import type { FieldRow } from "./fieldRows.js";
import { planStatusBar as planMatrixStatusBar } from "./matrixPlan.js";
import type { StatusBarPlan as MatrixStatusBarPlan } from "./matrixPlan.js";
import { sectionKey, structureKey } from "./renderStructure.js";
import { applyHealthToneClass, applyStatusAttentionClass, applyToneClass } from "./tone.js";

const MICRO_GAUGE_SIZE = 14;

export type StatusBarStyle = "pills" | "gauges" | "compact";

interface PillWidgets {
  dot: St.BoxLayout;
  values: St.Label[];
}

interface GaugeSegmentPlan {
  provider: ProviderName;
  displayName: string;
  status: ReaderStatus;
  meter: MicroMeterSpec;
  rows: FieldRow[];
  key: string;
}

interface GaugeSegmentWidgets {
  meter: MicroMeterSpec;
  gaugeArea: St.DrawingArea;
  values: St.Label[];
}

interface CompactPooledSegment {
  box: St.BoxLayout;
  nameLabel: St.Label;
  metricsLabel: St.Label | null;
}

export const StatusBarWidget = GObject.registerClass(
  class StatusBarWidget extends St.BoxLayout {
    declare _settings: Gio.Settings;
    declare _readers: Map<ProviderName, BaseReader>;
    declare _structureKey: string | null;
    declare _currentStyle: StatusBarStyle;

    // Pooled widgets per style
    declare _pills: PillWidgets[];
    declare _gaugeSegments: GaugeSegmentWidgets[];
    declare _compactSegments: CompactPooledSegment[];
    declare _placeholderLabel: St.Label | null;

    _init(settings: Gio.Settings, readers: Map<ProviderName, BaseReader>) {
      super._init({
        style_class: "provider-limits-status-bar",
        y_align: Clutter.ActorAlign.CENTER,
      });
      this._settings = settings;
      this._readers = readers;
      this._structureKey = null;
      this._currentStyle = "pills";
      this._pills = [];
      this._gaugeSegments = [];
      this._compactSegments = [];
      this._placeholderLabel = null;
      this.accessible_name = _("Provider Limits");
    }

    render(results: Map<ProviderName, ReaderResult>): void {
      const styleSetting = this._settings.get_string("status-bar-style");
      const style: StatusBarStyle =
        styleSetting === "gauges" || styleSetting === "compact" ? styleSetting : "pills";
      this._currentStyle = style;

      if (style === "gauges") {
        this._renderGauges(results);
      } else if (style === "compact") {
        this._renderCompact(results);
      } else {
        this._renderPills(results);
      }
    }

    private _clearAllActors(): void {
      let child = this.get_first_child();
      while (child) {
        const next = child.get_next_sibling();
        child.destroy();
        child = next;
      }
      this._pills = [];
      this._gaugeSegments = [];
      this._compactSegments = [];
      this._placeholderLabel = null;
    }

    // ========================================================================
    // Style 1: Capsule Pills (Fork 1)
    // ========================================================================
    private _renderPills(results: Map<ProviderName, ReaderResult>): void {
      const order = normalizeProvidersOrder(this._settings.get_strv("providers-order"));
      const locale = resolveLocale(
        this._settings.get_string("language"),
        GLib.getenv("LC_MESSAGES"),
        GLib.getenv("LANG"),
      );
      const hasEnabledProviders =
        this._readers.size > 0 ||
        order.some((name) => this._settings.get_boolean(`${name}-enabled`));

      const plan = planCardsStatusBar({
        order,
        results,
        hasEnabledProviders,
        locale,
        getShortDisplayName: (name) => providerDisplayNameShort(this._settings, name),
        getStatusFields: (name) => this._settings.get_strv(`${name}-status-fields`),
        getFieldDefs: (name) => this._readers.get(name)?.FIELDS ?? PROVIDER_FIELDS[name],
        t: _,
      });

      const nextKey = `pills:${plan.structureKey}`;
      if (nextKey !== this._structureKey) {
        this._clearAllActors();
        this._buildPills(plan);
        this._structureKey = nextKey;
        return;
      }

      this._updatePills(plan);
    }

    private _buildPills(plan: CardsStatusBarPlan): void {
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
        this.add_child(loadingPill);
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

        this.add_child(pill);
        this._pills.push({ dot, values });
      }
    }

    private _updatePills(plan: CardsStatusBarPlan): void {
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

    // ========================================================================
    // Style 2: Cairo Micro-Ring Gauges (Fork 2)
    // ========================================================================
    private _renderGauges(results: Map<ProviderName, ReaderResult>): void {
      const order = normalizeProvidersOrder(this._settings.get_strv("providers-order"));
      const locale = resolveLocale(
        this._settings.get_string("language"),
        GLib.getenv("LC_MESSAGES"),
        GLib.getenv("LANG"),
      );

      if (results.size === 0) {
        const hasEnabled =
          this._readers.size > 0 ||
          order.some((name) => this._settings.get_boolean(`${name}-enabled`));
        const placeholderKey = `gauges:${structureKey([locale, hasEnabled ? "loading" : "empty"])}`;
        if (placeholderKey !== this._structureKey) {
          this._clearAllActors();
          if (hasEnabled) {
            const placeholder = new St.Label({
              text: "…",
              style_class: "pl-status-placeholder",
              y_align: Clutter.ActorAlign.CENTER,
            });
            placeholder.accessible_name = _("Refreshing…");
            this.add_child(placeholder);
          }
          this._structureKey = placeholderKey;
        }
        return;
      }

      const plans: GaugeSegmentPlan[] = [];

      for (const name of order) {
        const result = results.get(name);
        if (!result) continue;
        if (result.status === ReaderStatus.DISABLED) continue;

        const reader = this._readers.get(name);
        const fieldsDefs = reader?.FIELDS ?? PROVIDER_FIELDS[name];
        const statusFields = this._settings.get_strv(`${name}-status-fields`);
        const displayName = providerDisplayNameShort(this._settings, name);
        const meter = computeStatusMicroMeter(fieldsDefs, result, statusFields);
        const rows = getFieldRows(reader, result, statusFields, "status", locale, _);

        plans.push({
          provider: name,
          displayName,
          status: result.status,
          meter,
          rows,
          key: sectionKey({
            provider: name,
            displayName,
            status: result.status,
            locale,
            rows,
            hasDetail: false,
            hasError:
              result.status === ReaderStatus.ERROR || result.status === ReaderStatus.UNAVAILABLE,
            hasTimestamp: false,
          }),
        });
      }

      const nextKey = `gauges:${structureKey([locale, ...plans.map((p) => p.key)])}`;
      if (nextKey !== this._structureKey) {
        this._clearAllActors();
        this._buildGauges(plans);
        this._structureKey = nextKey;
        return;
      }

      this._updateGauges(plans);
    }

    private _buildGauges(plans: GaugeSegmentPlan[]): void {
      for (const plan of plans) {
        const segment = new St.BoxLayout({
          style_class: "pl-micro-gauge-segment",
          y_align: Clutter.ActorAlign.CENTER,
        });

        const gaugeArea = new St.DrawingArea({
          width: MICRO_GAUGE_SIZE,
          height: MICRO_GAUGE_SIZE,
          style_class: "pl-micro-gauge-canvas",
          y_align: Clutter.ActorAlign.CENTER,
        });
        const segmentWidgets: GaugeSegmentWidgets = {
          meter: plan.meter,
          gaugeArea,
          values: [],
        };

        gaugeArea.connect("repaint", (area: St.DrawingArea) => {
          const rawCr = area.get_context();
          if (!isCairoContext(rawCr)) return;
          try {
            const [w, h] = area.get_surface_size();
            drawMicroRing(rawCr, w, h, segmentWidgets.meter);
          } finally {
            disposeCairoContext(rawCr);
          }
        });
        segment.add_child(gaugeArea);

        const nameLabel = new St.Label({
          text: plan.displayName,
          style_class: "provider-limits-provider-label",
          y_align: Clutter.ActorAlign.CENTER,
        });
        segment.add_child(nameLabel);

        const values = plan.rows.map((row) => {
          const valueLabel = new St.Label({
            text: row.valueText,
            style_class: "pl-status-value",
            y_align: Clutter.ActorAlign.CENTER,
          });
          valueLabel.accessible_name = row.accessibleText ?? `${row.label}: ${row.valueText}`;
          applyToneClass(valueLabel, row.tone);
          segment.add_child(valueLabel);
          return valueLabel;
        });

        segmentWidgets.values = values;
        this.add_child(segment);
        this._gaugeSegments.push(segmentWidgets);
      }
    }

    private _updateGauges(plans: GaugeSegmentPlan[]): void {
      plans.forEach((plan, index) => {
        const widgets = this._gaugeSegments[index];
        if (!widgets) return;

        widgets.meter = plan.meter;
        widgets.gaugeArea.queue_repaint();

        plan.rows.forEach((row, rowIndex) => {
          const valueLabel = widgets.values[rowIndex];
          if (!valueLabel) return;
          valueLabel.text = row.valueText;
          valueLabel.accessible_name = row.accessibleText ?? `${row.label}: ${row.valueText}`;
          applyToneClass(valueLabel, row.tone);
        });
      });
    }

    // ========================================================================
    // Style 3: Compact Tabular Minimalist (Fork 3)
    // ========================================================================
    private _renderCompact(results: Map<ProviderName, ReaderResult>): void {
      const rawOrder = this._settings.get_strv("providers-order");
      const order = normalizeProvidersOrder(rawOrder);
      const locale = resolveLocale(
        this._settings.get_string("language"),
        GLib.getenv("LC_MESSAGES"),
        GLib.getenv("LANG"),
      );

      const enabledProviders = new Set<ProviderName>();
      const shortLabels = {} as Record<ProviderName, string>;
      const statusFields = {} as Record<ProviderName, readonly string[]>;
      const fieldDefs: Partial<Record<ProviderName, readonly FieldDef[]>> = {};

      for (const name of PROVIDER_NAMES) {
        const enabled = this._settings.get_boolean(`${name}-enabled`);
        if (enabled) enabledProviders.add(name);

        shortLabels[name] = providerDisplayNameShort(this._settings, name);
        statusFields[name] = this._settings.get_strv(`${name}-status-fields`);

        const reader = this._readers.get(name);
        fieldDefs[name] = reader?.FIELDS ?? PROVIDER_FIELDS[name];
      }

      const plan = planMatrixStatusBar({
        order,
        enabledProviders,
        results,
        shortLabels,
        statusFields,
        fieldDefs,
        locale,
        t: _,
      });

      const nextKey = `compact:${plan.key}`;
      if (nextKey !== this._structureKey) {
        this._clearAllActors();
        this._buildCompact(plan);
        this._structureKey = nextKey;
        return;
      }

      this._updateCompact(plan);
    }

    private _buildCompact(plan: MatrixStatusBarPlan): void {
      if (plan.state === "loading" && plan.placeholderText) {
        const placeholder = new St.Label({
          text: plan.placeholderText,
          style_class: "provider-limits-status-placeholder provider-limits-tnum",
          y_align: Clutter.ActorAlign.CENTER,
        });
        placeholder.accessible_name = _("Reading provider limits…");
        this.add_child(placeholder);
        this._placeholderLabel = placeholder;
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
        this.add_child(segment);
        this._compactSegments.push({ box: segment, nameLabel, metricsLabel });
      });
    }

    private _updateCompact(plan: MatrixStatusBarPlan): void {
      if (plan.state === "loading" && this._placeholderLabel && plan.placeholderText) {
        this._placeholderLabel.text = plan.placeholderText;
        return;
      }

      plan.badges.forEach((badge, index) => {
        const pooled = this._compactSegments[index];
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
  },
);
