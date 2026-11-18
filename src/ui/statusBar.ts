import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import St from "gi://St";

import type { ProviderName } from "../constants.js";
import { gettext as _ } from "../helpers/gettext.js";
import { resolveLocale } from "../helpers/locale.js";
import { normalizeProvidersOrder, providerDisplayNameShort } from "../helpers/provider-settings.js";
import type { BaseReader, ReaderResult } from "../readers/base.js";
import { planStatusBar } from "./cardPlan.js";
import type { StatusBarPlan, StatusPillPlan } from "./cardPlan.js";
import type { FieldRow } from "./fieldRows.js";
import { applyHealthToneClass, applyToneClass } from "./tone.js";

interface PillWidgets {
  dot: St.BoxLayout;
  values: St.Label[];
}

export const StatusBarWidget = GObject.registerClass(
  class StatusBarWidget extends St.BoxLayout {
    declare _settings: Gio.Settings;
    declare _readers: Map<ProviderName, BaseReader>;
    declare _pills: PillWidgets[];
    declare _structureKey: string | null;

    _init(settings: Gio.Settings, readers: Map<ProviderName, BaseReader>) {
      super._init({
        style_class: "provider-limits-status-bar",
        y_align: Clutter.ActorAlign.CENTER,
      });
      this._settings = settings;
      this._readers = readers;
      this._pills = [];
      this._structureKey = null;
      this.accessible_name = _("Provider Limits");
    }

    render(results: Map<ProviderName, ReaderResult>): void {
      const order = normalizeProvidersOrder(this._settings.get_strv("providers-order"));
      const locale = resolveLocale(
        this._settings.get_string("language"),
        GLib.getenv("LC_MESSAGES"),
        GLib.getenv("LANG"),
      );
      const hasEnabledProviders =
        this._readers.size > 0 ||
        order.some((name) => this._settings.get_boolean(`${name}-enabled`));

      const plan = planStatusBar({
        order,
        results,
        hasEnabledProviders,
        locale,
        getShortDisplayName: (name) => providerDisplayNameShort(this._settings, name),
        getStatusFields: (name) => this._settings.get_strv(`${name}-status-fields`),
        getFieldDefs: (name) => this._readers.get(name)?.FIELDS,
        t: _,
      });

      if (plan.structureKey !== this._structureKey) {
        this._rebuild(plan);
        this._structureKey = plan.structureKey;
        return;
      }

      this._update(plan);
    }

    private _rebuild(plan: StatusBarPlan): void {
      let child = this.get_first_child();
      while (child) {
        const next = child.get_next_sibling();
        child.destroy();
        child = next;
      }
      this._pills = [];

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
        this._pills.push(this._buildPill(pillPlan));
      }
    }

    private _buildPill(pillPlan: StatusPillPlan): PillWidgets {
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
        this._applyRow(valueLabel, row);
        pill.add_child(valueLabel);
        return valueLabel;
      });

      this.add_child(pill);
      return { dot, values };
    }

    private _update(plan: StatusBarPlan): void {
      plan.pills.forEach((pillPlan, index) => {
        const widgets = this._pills[index];
        if (!widgets) return;

        applyHealthToneClass(widgets.dot, pillPlan.healthTone);

        pillPlan.rows.forEach((row, rowIndex) => {
          const valueLabel = widgets.values[rowIndex];
          if (!valueLabel) return;
          valueLabel.text = row.valueText;
          this._applyRow(valueLabel, row);
        });
      });
    }

    private _applyRow(label: St.Label, row: FieldRow): void {
      label.accessible_name = row.accessibleText ?? `${row.label}: ${row.valueText}`;
      applyToneClass(label, row.tone);
    }
  },
);
