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
import { planStatusBar } from "./matrixPlan.js";
import type { StatusBarPlan } from "./matrixPlan.js";
import { applyStatusAttentionClass } from "./tone.js";

interface PooledSegment {
  box: St.BoxLayout;
  nameLabel: St.Label;
  metricsLabel: St.Label | null;
}

export const StatusBarWidget = GObject.registerClass(
  class StatusBarWidget extends St.BoxLayout {
    declare _settings: Gio.Settings;
    declare _readers: Map<ProviderName, BaseReader>;
    declare _segments: PooledSegment[];
    declare _placeholderLabel: St.Label | null;
    declare _structureKey: string | null;

    _init(settings: Gio.Settings, readers: Map<ProviderName, BaseReader>) {
      super._init({
        style_class: "provider-limits-status-bar provider-limits-tnum",
        y_align: Clutter.ActorAlign.CENTER,
      });
      this._settings = settings;
      this._readers = readers;
      this._segments = [];
      this._placeholderLabel = null;
      this._structureKey = null;
      this.accessible_name = _("Provider Limits");

      this.render(new Map());
    }

    render(results: Map<ProviderName, ReaderResult>): void {
      const rawOrder =
        typeof this._settings.get_strv === "function"
          ? this._settings.get_strv("providers-order")
          : PROVIDER_NAMES;
      const order = normalizeProvidersOrder(rawOrder);
      const locale = resolveLocale(
        typeof this._settings.get_string === "function"
          ? this._settings.get_string("language")
          : "",
        GLib.getenv("LC_MESSAGES"),
        GLib.getenv("LANG"),
      );

      const enabledProviders = new Set<ProviderName>();
      const shortLabels = {} as Record<ProviderName, string>;
      const statusFields = {} as Record<ProviderName, readonly string[]>;
      const fieldDefs: Partial<Record<ProviderName, readonly FieldDef[]>> = {};

      for (const name of PROVIDER_NAMES) {
        const enabled =
          typeof this._settings.get_boolean === "function"
            ? this._settings.get_boolean(`${name}-enabled`)
            : this._readers.has(name) || results.has(name);
        if (enabled) enabledProviders.add(name);

        shortLabels[name] =
          typeof this._settings.get_string === "function"
            ? providerDisplayNameShort(this._settings, name)
            : name;
        statusFields[name] =
          typeof this._settings.get_strv === "function"
            ? this._settings.get_strv(`${name}-status-fields`)
            : [];

        const reader = this._readers.get(name);
        if (reader) fieldDefs[name] = reader.FIELDS;
      }

      const plan = planStatusBar({
        order,
        enabledProviders,
        results,
        shortLabels,
        statusFields,
        fieldDefs,
        locale,
        t: _,
      });

      if (plan.key !== this._structureKey) {
        this._rebuild(plan);
        this._structureKey = plan.key;
        return;
      }

      this._update(plan);
    }

    private _clearActors(): void {
      let child = this.get_first_child();
      while (child) {
        const next = child.get_next_sibling();
        child.destroy();
        child = next;
      }
      this._segments = [];
      this._placeholderLabel = null;
    }

    private _rebuild(plan: StatusBarPlan): void {
      this._clearActors();

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
        this._segments.push({ box: segment, nameLabel, metricsLabel });
      });
    }

    private _update(plan: StatusBarPlan): void {
      if (plan.state === "loading" && this._placeholderLabel && plan.placeholderText) {
        this._placeholderLabel.text = plan.placeholderText;
        return;
      }

      plan.badges.forEach((badge, index) => {
        const pooled = this._segments[index];
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
