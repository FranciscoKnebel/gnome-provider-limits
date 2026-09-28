import Clutter from "gi://Clutter";
import type Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import { Spinner } from "resource:///org/gnome/shell/ui/animation.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import type { ProviderName } from "../constants.js";
import { formatAbsoluteTimestamp } from "../formatters.js";
import { resolveLocale } from "../helpers/locale.js";
import { normalizeProvidersOrder, providerDisplayName } from "../helpers/provider-settings.js";
import type { BaseReader, ReaderResult } from "../readers/base.js";
import { ReaderStatus } from "../readers/base.js";
import { getFieldRows } from "./fieldRows.js";
import type { FieldRow } from "./fieldRows.js";
import { sectionKey } from "./renderStructure.js";
import { applyToneClass } from "./tone.js";

interface FieldRowWidgets {
  value: St.Label;
  error: St.Label | null;
}

interface PanelSection {
  header: PopupMenu.PopupMenuItem;
  detailLabel: St.Label | null;
  errorLabel: St.Label | null;
  fields: FieldRowWidgets[];
  lastUpdatedLabel: St.Label | null;
}

interface SectionPlan {
  name: ProviderName;
  displayName: string;
  status: ReaderStatus;
  rows: FieldRow[];
  detailText: string | null;
  errorText: string | null;
  lastUpdatedText: string | null;
  key: string;
}

const STRUCTURE_SEPARATOR = "\u0004";

export class PanelWidget extends PopupMenu.PopupMenuSection {
  private _settings: Gio.Settings;
  private _readers: Map<ProviderName, BaseReader>;
  private _openPreferences: () => void;
  private _onRefresh?: () => void;
  private _running = false;
  private _refreshRow: PopupMenu.PopupBaseMenuItem | null = null;
  private _refreshButtonLabel: St.Label | null = null;
  private _refreshSpinner: Spinner | null = null;
  private _lastRefreshLabel: St.Label | null = null;
  private _sections: PanelSection[] = [];
  private _structureKey: string | null = null;

  constructor(
    settings: Gio.Settings,
    readers: Map<ProviderName, BaseReader>,
    openPreferences: () => void,
    onRefresh?: () => void,
  ) {
    super();
    this._settings = settings;
    this._readers = readers;
    this._openPreferences = openPreferences;
    this._onRefresh = onRefresh;
  }

  render(results: Map<ProviderName, ReaderResult>, lastRefreshAt: number | null): void {
    const order = normalizeProvidersOrder(this._settings.get_strv("providers-order"));
    const locale = resolveLocale(
      this._settings.get_string("language"),
      GLib.getenv("LC_MESSAGES"),
      GLib.getenv("LANG"),
    );

    const plans: SectionPlan[] = [];
    for (const name of order) {
      const result = results.get(name);
      if (!result) continue;
      if (result.status === ReaderStatus.DISABLED) continue;
      plans.push(this._planSection(name, result, locale));
    }

    const hasLastRefresh = lastRefreshAt !== null && Number.isFinite(lastRefreshAt);
    const structureKey = [
      locale,
      hasLastRefresh ? "1" : "0",
      ...plans.map((plan) => plan.key),
    ].join(STRUCTURE_SEPARATOR);

    if (structureKey !== this._structureKey) {
      this._rebuild(plans, lastRefreshAt, locale);
      this._structureKey = structureKey;
      return;
    }

    this._update(plans, lastRefreshAt, locale);
  }

  setRunning(running: boolean): void {
    this._running = running;
    if (this._refreshSpinner) {
      this._refreshSpinner.visible = running;
      if (running) this._refreshSpinner.play();
      else this._refreshSpinner.stop();
    }
    if (this._refreshButtonLabel) {
      this._refreshButtonLabel.text = running ? _("Refreshing…") : _("Force refresh");
      this._refreshButtonLabel.accessible_name = this._refreshButtonLabel.text;
    }
    if (this._refreshRow) this._refreshRow.reactive = !running;
  }

  private _planSection(name: ProviderName, result: ReaderResult, locale: string): SectionPlan {
    const displayName = this._getProviderDisplayName(name);
    const errorText =
      result.status === ReaderStatus.ERROR ? (result.lastError ?? _("Error")) : null;
    const detailText = result.status === ReaderStatus.PARTIAL ? (result.lastError ?? null) : null;
    const rows = errorText
      ? []
      : getFieldRows(
          this._readers.get(name),
          result,
          this._settings.get_strv(`${name}-panel-fields`),
          "panel",
          locale,
          _,
        );
    const lastUpdatedText =
      !errorText && Number.isFinite(result.lastUpdated)
        ? formatAbsoluteTimestamp(result.lastUpdated, locale)
        : null;

    return {
      name,
      displayName,
      status: result.status,
      rows,
      detailText,
      errorText,
      lastUpdatedText,
      key: sectionKey({
        provider: name,
        displayName,
        status: result.status,
        locale,
        rows,
        hasDetail: detailText !== null,
        hasError: errorText !== null,
        hasTimestamp: lastUpdatedText !== null,
      }),
    };
  }

  private _rebuild(plans: SectionPlan[], lastRefreshAt: number | null, locale: string): void {
    this.removeAll();
    this._refreshRow = null;
    this._refreshButtonLabel = null;
    this._refreshSpinner = null;
    this._lastRefreshLabel = null;
    this._sections = [];

    plans.forEach((plan, index) => {
      if (index > 0) this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
      this._sections.push(this._addSection(plan));
    });

    this._addRefreshRow(lastRefreshAt, locale);

    const settingsItem = new PopupMenu.PopupMenuItem(_("Settings"));
    settingsItem.connect("activate", () => {
      this._openPreferences();
    });
    this.addMenuItem(settingsItem);
  }

  private _update(plans: SectionPlan[], lastRefreshAt: number | null, locale: string): void {
    plans.forEach((plan, index) => {
      const section = this._sections[index];
      if (!section) return;

      plan.rows.forEach((rowData, rowIndex) => {
        const widgets = section.fields[rowIndex];
        if (!widgets) return;

        widgets.value.text = rowData.valueText;
        widgets.value.accessible_name =
          rowData.accessibleText ?? `${_(rowData.label)}: ${rowData.valueText}`;
        applyToneClass(widgets.value, rowData.tone);

        if (widgets.error && rowData.errorText) {
          widgets.error.text = rowData.errorText;
          widgets.error.accessible_name = rowData.errorText;
        }
      });

      if (section.detailLabel && plan.detailText) {
        section.detailLabel.text = plan.detailText;
        section.detailLabel.accessible_name = plan.detailText;
      }

      if (section.errorLabel && plan.errorText) {
        section.errorLabel.text = plan.errorText;
        section.errorLabel.accessible_name = plan.errorText;
      }

      if (section.lastUpdatedLabel && plan.lastUpdatedText) {
        section.lastUpdatedLabel.text = _("Last updated: %s").replace("%s", plan.lastUpdatedText);
      }
    });

    if (this._lastRefreshLabel) {
      this._lastRefreshLabel.text =
        lastRefreshAt !== null && Number.isFinite(lastRefreshAt)
          ? _("Last refresh: %s").replace("%s", formatAbsoluteTimestamp(lastRefreshAt, locale))
          : "";
    }
  }

  private _addSection(plan: SectionPlan): PanelSection {
    const headerText = this._buildHeaderText(plan.displayName, plan.status);
    const header = new PopupMenu.PopupMenuItem(headerText, {
      reactive: true,
      can_focus: false,
      activate: false,
      hover: false,
    });
    header.add_style_class_name("provider-limits-panel-header");
    header.add_style_class_name("provider-limits-static-row");
    header.accessible_name = headerText;
    header.label.accessible_name = headerText;
    this.addMenuItem(header);

    const detailLabel = this._addTextRow(plan.detailText, "provider-limits-dim");

    if (plan.errorText !== null) {
      const errorLabel = this._addTextRow(plan.errorText, "provider-limits-error");
      return { header, detailLabel, errorLabel, fields: [], lastUpdatedLabel: null };
    }

    const fields = plan.rows.map((rowData) => this._addFieldRow(rowData));
    const lastUpdatedLabel =
      plan.lastUpdatedText !== null ? this._addLastUpdatedRow(plan.lastUpdatedText) : null;

    return { header, detailLabel, errorLabel: null, fields, lastUpdatedLabel };
  }

  private _addTextRow(text: string | null, styleClass: string): St.Label | null {
    if (text === null) return null;

    const row = this._addStaticRow();
    const label = new St.Label({
      text,
      style_class: styleClass,
      x_expand: true,
      x_align: Clutter.ActorAlign.START,
    });
    label.clutter_text.line_wrap = true;
    label.accessible_name = text;
    row.add_child(label);
    this.addMenuItem(row);
    return label;
  }

  private _addFieldRow(rowData: FieldRow): FieldRowWidgets {
    const row = this._addStaticRow();
    const content = new St.BoxLayout({ vertical: true, x_expand: true });
    const top = new St.BoxLayout({ x_expand: true });

    const labelLabel = new St.Label({
      text: _(rowData.label),
      style_class: "provider-limits-field-label",
      x_expand: true,
      x_align: Clutter.ActorAlign.START,
    });
    labelLabel.accessible_name = _(rowData.label);

    const valueLabel = new St.Label({
      text: rowData.valueText,
      style_class: "provider-limits-field-value",
      x_align: Clutter.ActorAlign.END,
    });
    valueLabel.accessible_name =
      rowData.accessibleText ?? `${_(rowData.label)}: ${rowData.valueText}`;
    applyToneClass(valueLabel, rowData.tone);

    top.add_child(labelLabel);
    top.add_child(valueLabel);
    content.add_child(top);

    let errorLabel: St.Label | null = null;
    if (rowData.errorText) {
      errorLabel = new St.Label({
        text: rowData.errorText,
        style_class: "provider-limits-error",
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
      });
      errorLabel.clutter_text.line_wrap = true;
      errorLabel.accessible_name = rowData.errorText;
      content.add_child(errorLabel);
    }

    row.add_child(content);
    this.addMenuItem(row);
    return { value: valueLabel, error: errorLabel };
  }

  private _addLastUpdatedRow(lastUpdatedText: string): St.Label {
    const row = this._addStaticRow();
    const label = new St.Label({
      text: _("Last updated: %s").replace("%s", lastUpdatedText),
      style_class: "provider-limits-dim",
      x_expand: true,
      x_align: Clutter.ActorAlign.START,
    });
    row.add_child(label);
    this.addMenuItem(row);
    return label;
  }

  private _addStaticRow(): PopupMenu.PopupBaseMenuItem {
    const row = new PopupMenu.PopupBaseMenuItem({
      reactive: true,
      can_focus: false,
      activate: false,
      hover: false,
    });
    row.add_style_class_name("provider-limits-static-row");
    return row;
  }

  private _addRefreshRow(lastRefreshAt: number | null, locale: string): void {
    const row = new PopupMenu.PopupBaseMenuItem({ reactive: true, can_focus: true });
    row.reactive = !this._running;
    row.accessible_name = _("Force refresh");

    const buttonLabel = new St.Label({
      text: this._running ? _("Refreshing…") : _("Force refresh"),
      x_expand: true,
      x_align: Clutter.ActorAlign.START,
    });
    buttonLabel.accessible_name = buttonLabel.text;
    row.add_child(buttonLabel);

    let lastRefreshLabel: St.Label | null = null;
    if (lastRefreshAt !== null && Number.isFinite(lastRefreshAt)) {
      lastRefreshLabel = new St.Label({
        text: _("Last refresh: %s").replace("%s", formatAbsoluteTimestamp(lastRefreshAt, locale)),
        style_class: "provider-limits-dim",
        x_align: Clutter.ActorAlign.END,
      });
      row.add_child(lastRefreshLabel);
    }

    const spinner = new Spinner(14, { animate: true, hideOnStop: true });
    spinner.add_style_class_name("provider-limits-refresh-spinner");
    spinner.visible = this._running;
    if (this._running) spinner.play();
    row.add_child(spinner);

    row.connect("activate", () => {
      if (!this._running) this._onRefresh?.();
    });
    row.connect("button-release-event", () => {
      if (!this._running) this._onRefresh?.();
      return Clutter.EVENT_STOP;
    });

    this._refreshRow = row;
    this._refreshButtonLabel = buttonLabel;
    this._refreshSpinner = spinner;
    this._lastRefreshLabel = lastRefreshLabel;
    this.addMenuItem(row);
  }

  private _getProviderDisplayName(name: ProviderName): string {
    return providerDisplayName(this._settings, name);
  }

  private _buildHeaderText(displayName: string, status: ReaderStatus): string {
    const suffix = this._statusText(status);
    return suffix ? `${displayName}  ${suffix}` : displayName;
  }

  private _statusText(status: ReaderStatus): string {
    switch (status) {
      case ReaderStatus.OK:
        return "";
      case ReaderStatus.PARTIAL:
        return _("(partial)");
      case ReaderStatus.ERROR:
        return _("(error)");
      case ReaderStatus.UNAVAILABLE:
        return _("(unavailable)");
      default:
        return "";
    }
  }
}
