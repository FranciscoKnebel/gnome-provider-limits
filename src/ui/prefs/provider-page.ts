import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk?version=4.0";

import type { ProviderName } from "../../constants.js";
import { formatField } from "../../formatters.js";
import { resolveLocale } from "../../helpers/locale.js";
import {
  isProviderName,
  normalizeProvidersOrder,
  providerDisplayName,
  providerDisplayNameShort,
} from "../../helpers/provider-settings.js";
import { moveAdjacentValue } from "../../helpers/reorder.js";
import type { FieldDef, FieldType } from "../../readers/base.js";
import {
  DEFAULT_PROVIDER_PANEL_FIELDS,
  DEFAULT_PROVIDER_STATUS_FIELDS,
  PROVIDER_FIELDS,
} from "../../readers/fields.js";
import { gettext as _ } from "./gettext.js";
import {
  bindSetting,
  buildReorderableList,
  resetStrvSetting,
  setupDragSource,
  setupDropTarget,
  stringArraysEqual,
  unbindSettings,
} from "./shared.js";
import type { SettingsBinding } from "./shared.js";

const SAMPLE_VALUES: Record<Exclude<FieldType, "timestamp">, unknown> = {
  percent: 42,
  count: 109,
  tokens: 2500000,
  cost: 3.71,
  bool: true,
  text: "plus",
};

function sampleValue(type: FieldType): unknown {
  if (type === "timestamp") return Date.now() + 5400 * 1000;
  return SAMPLE_VALUES[type];
}

function formatPreview(def: FieldDef, zone: "status" | "panel", locale: string): string {
  return formatField({
    type: def.type,
    value: sampleValue(def.type),
    zone,
    locale,
    t: _,
  });
}

function clearBoxChildren(box: Gtk.Box): void {
  let child = box.get_first_child();
  while (child) {
    const next = child.get_next_sibling();
    box.remove(child);
    child = next;
  }
}

export const ProviderExpanderRow = GObject.registerClass(
  class ProviderExpanderRow extends Adw.ExpanderRow {
    declare _settings: Gio.Settings;
    declare _provider: ProviderName;
    declare _signalIds: number[];
    declare _destroyCallbacks: (() => void)[];
    declare _bindings: SettingsBinding[];

    _init(
      settings: Gio.Settings,
      provider: ProviderName,
      options?: {
        index?: number;
        totalCount?: number;
        onMove?: (offset: -1 | 1) => void;
        initialExpanded?: boolean;
      },
    ) {
      super._init({
        title: providerDisplayName(settings, provider),
        subtitle: providerDisplayNameShort(settings, provider),
        show_enable_switch: true,
      });

      this._settings = settings;
      this._provider = provider;
      this._signalIds = [];
      this._destroyCallbacks = [];
      this._bindings = [];

      bindSetting(this._settings, `${provider}-enabled`, this, "enable-expansion", this._bindings);

      if (options?.initialExpanded && settings.get_boolean(`${provider}-enabled`)) {
        this.expanded = true;
      }

      this._signalIds.push(
        settings.connect(`changed::${provider}-display-name`, () => {
          const nextTitle = providerDisplayName(settings, provider);
          if (this.title !== nextTitle) this.title = nextTitle;
        }),
      );
      this._signalIds.push(
        settings.connect(`changed::${provider}-display-name-short`, () => {
          const nextSub = providerDisplayNameShort(settings, provider);
          if (this.subtitle !== nextSub) this.subtitle = nextSub;
        }),
      );

      const dragHandle = new Gtk.Image({ icon_name: "list-drag-handle-symbolic" });
      this.add_prefix(dragHandle);
      setupDragSource(this, provider);
      setupDropTarget(this, settings, "providers-order", provider);

      if (options?.onMove && options.index !== undefined && options.totalCount !== undefined) {
        const upButton = new Gtk.Button({
          icon_name: "go-up-symbolic",
          valign: Gtk.Align.CENTER,
          tooltip_text: _("Move up"),
          sensitive: options.index > 0,
        });
        upButton.add_css_class("flat");
        upButton.connect("clicked", () => options.onMove?.(-1));
        this.add_suffix(upButton);

        const downButton = new Gtk.Button({
          icon_name: "go-down-symbolic",
          valign: Gtk.Align.CENTER,
          tooltip_text: _("Move down"),
          sensitive: options.index < options.totalCount - 1,
        });
        downButton.add_css_class("flat");
        downButton.connect("clicked", () => options.onMove?.(1));
        this.add_suffix(downButton);
      }

      this._addIdentityRows();
      this.add_row(
        this._buildInlineFieldsRow(
          "status-fields",
          _("Status bar fields"),
          DEFAULT_PROVIDER_STATUS_FIELDS[provider],
        ),
      );
      this.add_row(
        this._buildInlineFieldsRow(
          "panel-fields",
          _("Panel fields"),
          DEFAULT_PROVIDER_PANEL_FIELDS[provider],
        ),
      );

      this.connect("destroy", () => this.cleanup());
    }

    cleanup(): void {
      for (const id of this._signalIds) {
        this._settings.disconnect(id);
      }
      this._signalIds = [];

      for (const destroy of this._destroyCallbacks) destroy();
      this._destroyCallbacks = [];

      unbindSettings(this._bindings);
    }

    private _addIdentityRows(): void {
      const displayNameRow = new Adw.EntryRow({
        title: _("Display name"),
        text: this._settings.get_string(`${this._provider}-display-name`) ?? "",
      });
      bindSetting(
        this._settings,
        `${this._provider}-display-name`,
        displayNameRow,
        "text",
        this._bindings,
      );
      this.add_row(displayNameRow);

      const shortNameRow = new Adw.EntryRow({
        title: _("Short display name"),
        text: this._settings.get_string(`${this._provider}-display-name-short`) ?? "",
      });
      bindSetting(
        this._settings,
        `${this._provider}-display-name-short`,
        shortNameRow,
        "text",
        this._bindings,
      );
      this.add_row(shortNameRow);

      const pathKey = `${this._provider}-cli-path`;
      const cliRow = new Adw.EntryRow({
        title: this._provider === "grok" ? _("Authentication file") : _("CLI path"),
        text: this._settings.get_string(pathKey) ?? "",
      });
      bindSetting(this._settings, pathKey, cliRow, "text", this._bindings);
      this.add_row(cliRow);

      if (this._provider === "grok") {
        this.add_row(
          new Adw.ActionRow({
            title: _("Sign in with `grok login`."),
            subtitle: _(
              "Leave the authentication file empty to use $GROK_HOME/auth.json or ~/.grok/auth.json.",
            ),
            activatable: false,
          }),
        );
      }
    }

    private _buildInlineFieldsRow(
      suffix: "status-fields" | "panel-fields",
      sectionTitle: string,
      defaults: readonly string[],
    ): Gtk.ListBoxRow {
      const key = `${this._provider}-${suffix}`;
      const zone = suffix === "status-fields" ? "status" : "panel";
      const locale = resolveLocale(
        this._settings.get_string("language"),
        GLib.getenv("LC_MESSAGES"),
        GLib.getenv("LANG"),
      );
      const available = PROVIDER_FIELDS[this._provider];

      const wrapperRow = new Gtk.ListBoxRow({
        activatable: false,
        selectable: false,
      });

      const sectionBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 6,
        margin_top: 10,
        margin_bottom: 10,
        margin_start: 12,
        margin_end: 12,
      });

      const headerBar = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 6,
      });

      const headingLabel = new Gtk.Label({
        xalign: 0,
        hexpand: true,
        valign: Gtk.Align.CENTER,
      });
      headingLabel.set_text(sectionTitle);
      headingLabel.add_css_class("heading");
      headerBar.append(headingLabel);

      const resetText = _("Reset");
      const resetButton = new Gtk.Button({
        valign: Gtk.Align.CENTER,
        tooltip_text: _("Reset fields to defaults"),
      });
      resetButton.set_label(resetText);
      resetButton.add_css_class("flat");
      resetButton.connect("clicked", () => {
        resetStrvSetting(this._settings, key, defaults);
      });
      headerBar.append(resetButton);

      const popoverContentBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 2,
        margin_top: 4,
        margin_bottom: 4,
        margin_start: 4,
        margin_end: 4,
      });

      const popoverScroll = new Gtk.ScrolledWindow({
        hscrollbar_policy: Gtk.PolicyType.NEVER,
        propagate_natural_height: true,
        propagate_natural_width: true,
        max_content_height: 260,
      });
      popoverScroll.set_child(popoverContentBox);

      const popover = new Gtk.Popover({
        has_arrow: true,
      });
      popover.set_child(popoverScroll);

      const addMenuButton = new Gtk.MenuButton({
        icon_name: "list-add-symbolic",
        tooltip_text: _("Add field"),
        valign: Gtk.Align.CENTER,
        popover,
      });
      addMenuButton.add_css_class("flat");
      headerBar.append(addMenuButton);

      const syncToolbarAndPopover = () => {
        const current = this._settings.get_strv(key);
        resetButton.sensitive = !stringArraysEqual(current, defaults);

        clearBoxChildren(popoverContentBox);
        const used = new Set(current);
        const remaining = available.filter((def) => !used.has(def.name));

        if (remaining.length === 0) {
          const emptyLabel = new Gtk.Label({
            xalign: 0,
            margin_top: 6,
            margin_bottom: 6,
            margin_start: 8,
            margin_end: 8,
          });
          emptyLabel.set_text(_("No more fields available"));
          emptyLabel.add_css_class("dim-label");
          popoverContentBox.append(emptyLabel);
          return;
        }

        for (const def of remaining) {
          const optionRow = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 12,
          });
          const titleLabel = new Gtk.Label({
            xalign: 0,
            hexpand: true,
          });
          titleLabel.set_text(_(def.label));

          const previewLabel = new Gtk.Label({
            xalign: 1,
          });
          previewLabel.set_text(formatPreview(def, zone, locale));
          previewLabel.add_css_class("dim-label");
          previewLabel.add_css_class("numeric");

          optionRow.append(titleLabel);
          optionRow.append(previewLabel);

          const optionButton = new Gtk.Button({
            child: optionRow,
          });
          optionButton.add_css_class("flat");
          optionButton.connect("clicked", () => {
            const values = this._settings.get_strv(key);
            if (!values.includes(def.name)) {
              this._settings.set_strv(key, [...values, def.name]);
            }
            popover.popdown();
          });
          popoverContentBox.append(optionButton);
        }
      };

      popover.connect("show", syncToolbarAndPopover);
      syncToolbarAndPopover();
      this._signalIds.push(this._settings.connect(`changed::${key}`, syncToolbarAndPopover));

      const { listBox, destroy } = buildReorderableList(
        this._settings,
        key,
        (name, _idx, allValues) => {
          const def = available.find((f) => f.name === name);
          if (!def) return null;

          const visibleValues = allValues.filter((v) =>
            available.some((candidate) => candidate.name === v),
          );
          const visibleIndex = visibleValues.indexOf(name);

          const row = new Adw.ActionRow({
            title: _(def.label),
            subtitle: formatPreview(def, zone, locale),
            activatable: false,
          });

          const dragHandle = new Gtk.Image({ icon_name: "list-drag-handle-symbolic" });
          row.add_prefix(dragHandle);

          const upButton = new Gtk.Button({
            icon_name: "go-up-symbolic",
            valign: Gtk.Align.CENTER,
            tooltip_text: _("Move up"),
            sensitive: visibleIndex > 0,
          });
          upButton.add_css_class("flat");
          upButton.connect("clicked", () => {
            const next = moveAdjacentValue(this._settings.get_strv(key), visibleValues, name, -1);
            if (next) this._settings.set_strv(key, next);
          });
          row.add_suffix(upButton);

          const downButton = new Gtk.Button({
            icon_name: "go-down-symbolic",
            valign: Gtk.Align.CENTER,
            tooltip_text: _("Move down"),
            sensitive: visibleIndex < visibleValues.length - 1,
          });
          downButton.add_css_class("flat");
          downButton.connect("clicked", () => {
            const next = moveAdjacentValue(this._settings.get_strv(key), visibleValues, name, 1);
            if (next) this._settings.set_strv(key, next);
          });
          row.add_suffix(downButton);

          const removeButton = new Gtk.Button({
            icon_name: "list-remove-symbolic",
            valign: Gtk.Align.CENTER,
            tooltip_text: _("Remove"),
          });
          removeButton.add_css_class("flat");
          removeButton.connect("clicked", () => {
            const values = this._settings.get_strv(key).filter((v) => v !== name);
            this._settings.set_strv(key, values);
          });
          row.add_suffix(removeButton);

          setupDragSource(row, name);
          setupDropTarget(row, this._settings, key, name);

          return row;
        },
      );
      this._destroyCallbacks.push(destroy);

      sectionBox.append(headerBar);
      sectionBox.append(listBox);
      wrapperRow.set_child(sectionBox);
      return wrapperRow;
    }
  },
);

export const ProvidersPage = GObject.registerClass(
  class ProvidersPage extends Adw.PreferencesPage {
    declare _settings: Gio.Settings;
    declare _destroyCallbacks: (() => void)[];
    declare _activeRows: InstanceType<typeof ProviderExpanderRow>[];
    declare _expandedSet: Set<ProviderName>;

    _init(settings: Gio.Settings) {
      super._init({
        title: _("Providers"),
        icon_name: "application-x-addon-symbolic",
      });

      this._settings = settings;
      this._destroyCallbacks = [];
      this._activeRows = [];
      this._expandedSet = new Set();

      this.connect("destroy", () => this.cleanup());
      this.add(this._buildAccordionGroup());
    }

    cleanup(): void {
      this._cleanupActiveRows();
      for (const destroy of this._destroyCallbacks) destroy();
      this._destroyCallbacks = [];
    }

    private _cleanupActiveRows(): void {
      for (const row of this._activeRows) {
        row.cleanup();
      }
      this._activeRows = [];
    }

    private _buildAccordionGroup(): Adw.PreferencesGroup {
      const group = new Adw.PreferencesGroup({
        title: _("Providers"),
        description: _("Enable, reorder, and configure each provider inline."),
      });

      const { listBox, destroy } = buildReorderableList(
        this._settings,
        "providers-order",
        (value, index, allValues) => {
          if (!isProviderName(value)) return null;
          const visibleProviders = allValues.filter(isProviderName);
          const expander = new ProviderExpanderRow(this._settings, value, {
            index,
            totalCount: visibleProviders.length,
            initialExpanded: this._expandedSet.has(value),
            onMove: (offset) => {
              const next = moveAdjacentValue(
                normalizeProvidersOrder(this._settings.get_strv("providers-order")),
                visibleProviders,
                value,
                offset,
              );
              if (next) this._settings.set_strv("providers-order", next);
            },
          });
          expander.connect("notify::expanded", () => {
            if (expander.expanded) this._expandedSet.add(value);
            else this._expandedSet.delete(value);
          });
          this._activeRows.push(expander);
          return expander;
        },
        normalizeProvidersOrder,
        () => this._cleanupActiveRows(),
      );

      this._destroyCallbacks.push(destroy);
      group.add(listBox);
      return group;
    }
  },
);
