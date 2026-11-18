import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk?version=4.0";

import type { ProviderName } from "../../constants.js";
import { formatField } from "../../formatters.js";
import { resolveLocale } from "../../helpers/locale.js";
import { providerDisplayName } from "../../helpers/provider-settings.js";
import { getProviderFields } from "../../readers/fields.js";
import type { FieldDef, FieldType } from "../../readers/fields.js";
import { gettext as _ } from "./gettext.js";
import {
  bindSetting,
  buildReorderableList,
  clearListBox,
  setupDragSource,
  setupDropTarget,
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

export const ProviderPage = GObject.registerClass(
  class ProviderPage extends Adw.PreferencesPage {
    declare _settings: Gio.Settings;
    declare _provider: ProviderName;
    declare _titleChangedId: number;
    declare _destroyCallbacks: (() => void)[];
    declare _bindings: SettingsBinding[];

    _init(settings: Gio.Settings, provider: ProviderName) {
      super._init({
        title: providerDisplayName(settings, provider),
        icon_name: "preferences-system-symbolic",
      });

      this._settings = settings;
      this._provider = provider;
      this._destroyCallbacks = [];
      this._bindings = [];

      this._titleChangedId = settings.connect(`changed::${provider}-display-name`, () => {
        this.title = providerDisplayName(settings, provider);
      });
      this.connect("destroy", () => {
        this.cleanup();
      });

      this.add(this._buildSettingsGroup());
      this.add(this._buildFieldsGroup("status-fields", _("Status bar fields")));
      this.add(this._buildFieldsGroup("panel-fields", _("Panel fields")));
    }

    cleanup(): void {
      if (this._titleChangedId) {
        this._settings.disconnect(this._titleChangedId);
        this._titleChangedId = 0;
      }

      for (const destroy of this._destroyCallbacks) destroy();
      this._destroyCallbacks = [];

      unbindSettings(this._bindings);
    }

    private _buildSettingsGroup(): Adw.PreferencesGroup {
      const group = new Adw.PreferencesGroup({ title: _("Settings") });

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
      group.add(displayNameRow);

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
      group.add(shortNameRow);

      const pathKey = `${this._provider}-cli-path`;
      const cliRow = new Adw.EntryRow({
        title: this._provider === "grok" ? _("Authentication file") : _("CLI path"),
        text: this._settings.get_string(pathKey) ?? "",
      });
      bindSetting(this._settings, pathKey, cliRow, "text", this._bindings);
      group.add(cliRow);
      if (this._provider === "grok") {
        group.add(
          new Adw.ActionRow({
            title: _("Sign in with `grok login`."),
            subtitle: _(
              "Leave the authentication file empty to use $GROK_HOME/auth.json or ~/.grok/auth.json.",
            ),
          }),
        );
      }
      return group;
    }

    private _buildFieldsGroup(suffix: string, title: string): Adw.PreferencesGroup {
      const key = `${this._provider}-${suffix}`;
      const zone = suffix === "status-fields" ? "status" : "panel";
      const locale = resolveLocale(
        this._settings.get_string("language"),
        GLib.getenv("LC_MESSAGES"),
        GLib.getenv("LANG"),
      );
      const available = getProviderFields(this._provider);

      const group = new Adw.PreferencesGroup({
        title,
        description: _('Reorder rows or use "+" to add fields.'),
      });

      const headerBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 4,
        valign: Gtk.Align.CENTER,
      });

      const resetButton = new Gtk.Button({
        label: _("Reset defaults"),
        tooltip_text: _("Restore default fields"),
        valign: Gtk.Align.CENTER,
      });
      resetButton.add_css_class("flat");
      resetButton.connect("clicked", () => {
        this._settings.reset(key);
      });
      headerBox.append(resetButton);

      const popover = new Gtk.Popover({
        has_arrow: true,
      });
      const scrolled = new Gtk.ScrolledWindow({
        hscrollbar_policy: Gtk.PolicyType.NEVER,
        vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
        propagate_natural_height: true,
        propagate_natural_width: true,
        max_content_height: 300,
        min_content_width: 280,
      });
      const popoverContent = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        margin_top: 6,
        margin_bottom: 6,
        margin_start: 6,
        margin_end: 6,
      });
      const popoverList = new Gtk.ListBox({
        selection_mode: Gtk.SelectionMode.NONE,
        show_separators: false,
      });
      popoverList.add_css_class("boxed-list");
      popoverContent.append(popoverList);
      scrolled.set_child(popoverContent);
      popover.set_child(scrolled);

      const populatePopover = () => {
        clearListBox(popoverList);
        const used = new Set(this._settings.get_strv(key));
        const remaining = available.filter((def) => !used.has(def.name));

        if (remaining.length === 0) {
          popoverList.append(
            new Adw.ActionRow({
              title: _("No more fields available"),
              activatable: false,
              sensitive: false,
            }),
          );
          return;
        }

        for (const def of remaining) {
          const itemRow = new Adw.ActionRow({
            title: _(def.label),
            subtitle: this._preview(def, zone, locale),
            activatable: true,
          });
          itemRow.add_suffix(
            new Gtk.Image({
              icon_name: "list-add-symbolic",
              valign: Gtk.Align.CENTER,
            }),
          );
          itemRow.connect("activated", () => {
            const current = this._settings.get_strv(key);
            if (!current.includes(def.name)) {
              this._settings.set_strv(key, [...current, def.name]);
            }
            popover.popdown();
          });
          popoverList.append(itemRow);
        }
      };

      populatePopover();
      popover.connect("show", populatePopover);
      const popoverSyncId = this._settings.connect(`changed::${key}`, populatePopover);
      this._destroyCallbacks.push(() => this._settings.disconnect(popoverSyncId));

      const addLabel = _("Add field");
      const addButton = new Gtk.MenuButton({
        icon_name: "list-add-symbolic",
        tooltip_text: addLabel,
        popover,
        valign: Gtk.Align.CENTER,
      });
      addButton.add_css_class("flat");
      addButton.update_property([Gtk.AccessibleProperty.LABEL], [addLabel]);
      headerBox.append(addButton);

      group.set_header_suffix(headerBox);

      const { listBox, destroy } = buildReorderableList(
        this._settings,
        key,
        (name, reorderControls) => {
          const def = available.find((f) => f.name === name);
          if (!def) return null;

          const row = new Adw.ActionRow({
            title: _(def.label),
            subtitle: this._preview(def, zone, locale),
            activatable: false,
          });

          const dragHandle = new Gtk.Image({ icon_name: "list-drag-handle-symbolic" });
          row.add_prefix(dragHandle);
          row.add_suffix(reorderControls);

          const removeLabel = _("Remove");
          const removeButton = new Gtk.Button({
            icon_name: "list-remove-symbolic",
            valign: Gtk.Align.CENTER,
            tooltip_text: removeLabel,
          });
          removeButton.add_css_class("flat");
          removeButton.update_property([Gtk.AccessibleProperty.LABEL], [removeLabel]);
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
      group.add(listBox);
      return group;
    }

    private _preview(def: FieldDef, zone: "status" | "panel", locale: string): string {
      return formatField({
        type: def.type,
        value: sampleValue(def.type),
        zone,
        locale,
        t: _,
      });
    }
  },
);
