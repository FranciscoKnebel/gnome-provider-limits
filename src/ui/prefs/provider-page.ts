import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk?version=4.0";
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import type { ProviderName } from "../../constants.js";
import { formatField } from "../../formatters.js";
import { resolveLocale } from "../../helpers/locale.js";
import { providerDisplayName } from "../../helpers/provider-settings.js";
import type { FieldDef, FieldType } from "../../readers/base.js";
import { CLAUDE_FIELDS } from "../../readers/claude.js";
import { CODEX_FIELDS } from "../../readers/codex.js";
import { OPENCODE_FIELDS } from "../../readers/opencode.js";
import { buildReorderableList, setupDragSource, setupDropTarget } from "./shared.js";

const SAMPLE_VALUES: Record<FieldType, unknown> = {
  percent: 42,
  count: 109,
  tokens: 2500000,
  cost: 3.71,
  timestamp: Date.now() + 5400 * 1000,
  bool: true,
  text: "plus",
};

const READER_FIELDS: Record<ProviderName, readonly FieldDef[]> = {
  codex: CODEX_FIELDS,
  claude: CLAUDE_FIELDS,
  opencode: OPENCODE_FIELDS,
};

function getReaderFields(provider: ProviderName): readonly FieldDef[] {
  return READER_FIELDS[provider];
}

export const ProviderPage = GObject.registerClass(
  class ProviderPage extends Adw.PreferencesPage {
    declare _settings: Gio.Settings;
    declare _provider: ProviderName;
    declare _titleChangedId: number;
    declare _destroyCallbacks: (() => void)[];

    _init(settings: Gio.Settings, provider: ProviderName) {
      super._init({
        title: providerDisplayName(settings, provider),
        icon_name: "preferences-system-symbolic",
      });

      this._settings = settings;
      this._provider = provider;
      this._destroyCallbacks = [];

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
    }

    private _buildSettingsGroup(): Adw.PreferencesGroup {
      const group = new Adw.PreferencesGroup({ title: _("Settings") });

      const displayNameRow = new Adw.EntryRow({
        title: _("Display name"),
        text: this._settings.get_string(`${this._provider}-display-name`) ?? "",
      });
      this._settings.bind(
        `${this._provider}-display-name`,
        displayNameRow,
        "text",
        Gio.SettingsBindFlags.DEFAULT,
      );
      group.add(displayNameRow);

      const shortNameRow = new Adw.EntryRow({
        title: _("Short display name"),
        text: this._settings.get_string(`${this._provider}-display-name-short`) ?? "",
      });
      this._settings.bind(
        `${this._provider}-display-name-short`,
        shortNameRow,
        "text",
        Gio.SettingsBindFlags.DEFAULT,
      );
      group.add(shortNameRow);

      const cliRow = new Adw.EntryRow({
        title: _("CLI path"),
        text: this._settings.get_string(`${this._provider}-cli-path`) ?? "",
      });
      this._settings.bind(
        `${this._provider}-cli-path`,
        cliRow,
        "text",
        Gio.SettingsBindFlags.DEFAULT,
      );
      group.add(cliRow);
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
      const available = getReaderFields(this._provider);

      const group = new Adw.PreferencesGroup({
        title,
        description: _('Drag rows to reorder. Use "+" to add fields.'),
      });

      const addButton = new Gtk.Button({
        icon_name: "list-add-symbolic",
        tooltip_text: _("Add field"),
      });
      addButton.add_css_class("flat");
      group.set_header_suffix(addButton);

      addButton.connect("clicked", () => {
        const used = new Set(this._settings.get_strv(key));

        const dialog = new Adw.MessageDialog({
          body: _("Select a field to add:"),
          close_response: "cancel",
        });

        dialog.add_response("cancel", _("Cancel"));
        dialog.set_default_response("cancel");

        for (const def of available) {
          if (used.has(def.name)) continue;
          dialog.add_response(def.name, _(def.label));
        }

        if (used.size >= available.length) {
          dialog.add_response("none", _("No more fields available"));
          dialog.set_response_enabled("none", false);
        }

        dialog.connect("response", (_widget, response) => {
          if (response === "cancel" || response === "none") return;
          const values = this._settings.get_strv(key);
          this._settings.set_strv(key, [...values, response]);
        });

        dialog.present();
      });

      const { listBox, destroy } = buildReorderableList(this._settings, key, (name) => {
        const def = available.find((f) => f.name === name);
        if (!def) return null;

        const row = new Adw.ActionRow({
          title: _(def.label),
          subtitle: this._preview(def, zone, locale),
          activatable: false,
        });

        const dragHandle = new Gtk.Image({ icon_name: "list-drag-handle-symbolic" });
        row.add_prefix(dragHandle);

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
        setupDropTarget(row, this._settings, key);

        return row;
      });
      this._destroyCallbacks.push(destroy);
      group.add(listBox);
      return group;
    }

    private _preview(def: FieldDef, zone: "status" | "panel", locale: string): string {
      return formatField({
        type: def.type,
        value: SAMPLE_VALUES[def.type],
        zone,
        locale,
        t: _,
      });
    }
  },
);
