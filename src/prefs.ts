import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk";
import {
  ExtensionPreferences,
  gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { PROVIDER_NAMES } from "./constants.js";
import { formatField } from "./formatters.js";
import type { FieldDef, FieldType } from "./readers/base.js";
import { CLAUDE_FIELDS } from "./readers/claude.js";
import { CODEX_FIELDS } from "./readers/codex.js";
import { OPENCODE_FIELDS } from "./readers/opencode.js";

const SAMPLE_VALUES: Record<FieldType, unknown> = {
  percent: 42,
  count: 109,
  tokens: 2500000,
  cost: 3.71,
  timestamp: Date.now() + 5400 * 1000,
  bool: true,
  text: "plus",
};

function getReaderFields(provider: string): readonly FieldDef[] {
  switch (provider) {
    case "codex":
      return CODEX_FIELDS;
    case "claude":
      return CLAUDE_FIELDS;
    case "opencode":
      return OPENCODE_FIELDS;
    default:
      return [];
  }
}

const ProviderLimitsPreferencesPage = GObject.registerClass(
  class ProviderLimitsPreferencesPage extends Adw.PreferencesPage {
    declare _settings: Gio.Settings;

    _init(settings: Gio.Settings) {
      super._init({
        title: _("General"),
        icon_name: "preferences-system-symbolic",
      });

      this._settings = settings;
      this.add(this._buildRefreshGroup());
      this.add(this._buildLanguageGroup());
      this.add(this._buildProvidersGroup());
    }

    private _buildRefreshGroup(): Adw.PreferencesGroup {
      const group = new Adw.PreferencesGroup({
        title: _("Refresh"),
        description: _("Control how often the extension refreshes provider data."),
      });

      const shortRow = this._createSpinRow(
        "refresh-short-interval-seconds",
        _("Short interval"),
        _("Seconds between refreshes when data is changing."),
        10,
        3600,
        60,
      );
      group.add(shortRow);

      const longRow = this._createSpinRow(
        "refresh-long-interval-seconds",
        _("Long interval"),
        _("Seconds between refreshes when data is stable."),
        60,
        3600,
        60,
      );
      group.add(longRow);

      const thresholdRow = this._createSpinRow(
        "refresh-stable-reads-threshold",
        _("Stable reads threshold"),
        _("Number of unchanged reads before degrading to the long interval."),
        1,
        10,
        1,
      );
      group.add(thresholdRow);

      return group;
    }

    private _buildLanguageGroup(): Adw.PreferencesGroup {
      const group = new Adw.PreferencesGroup({
        title: _("Language"),
        description: _("Display language for the extension."),
      });

      const model = Gtk.StringList.new([_("System"), "English", "Português (Brasil)"]);
      const row = new Adw.ComboRow({
        title: _("Display language"),
        subtitle: _("Override the system locale, or follow it."),
        model,
      });

      const current = this._settings.get_string("language");
      row.selected = current === "en" ? 1 : current === "pt_BR" ? 2 : 0;

      row.connect("notify::selected", (combo: Adw.ComboRow) => {
        const values = ["", "en", "pt_BR"];
        this._settings.set_string("language", values[combo.selected] ?? "");
      });

      group.add(row);
      return group;
    }

    private _buildProvidersGroup(): Adw.PreferencesGroup {
      const group = new Adw.PreferencesGroup({
        title: _("Providers"),
        description: _("Enable and reorder providers by dragging the rows."),
      });

      const listBox = this._buildReorderableStringList(
        "providers-order",
        (name) => this._settings.get_string(`${name}-display-name`) ?? name,
        { showToggle: true },
      );
      group.add(listBox);

      for (const name of PROVIDER_NAMES) {
        this._settings.connect(`changed::${name}-display-name`, () => {
          this._rebuildStringList(listBox, "providers-order");
        });
      }

      return group;
    }

    private _rebuildStringList(listBox: Gtk.ListBox, key: string): void {
      let currentChild = listBox.get_first_child();
      while (currentChild) {
        const next = currentChild.get_next_sibling();
        listBox.remove(currentChild);
        currentChild = next;
      }

      const values = this._settings.get_strv(key);
      for (const value of values) {
        const row = this._buildReorderableRow({
          key,
          value,
          label: this._settings.get_string(`${value}-display-name`) ?? value,
        });

        const toggle = new Gtk.Switch({ valign: Gtk.Align.CENTER });
        this._settings.bind(`${value}-enabled`, toggle, "active", Gio.SettingsBindFlags.DEFAULT);
        row.add_suffix(toggle);
        listBox.append(row);
      }
    }

    private _createSpinRow(
      key: string,
      title: string,
      subtitle: string,
      lower: number,
      upper: number,
      step: number,
    ): Adw.SpinRow {
      const adjustment = new Gtk.Adjustment({
        lower,
        upper,
        step_increment: step,
        value: this._settings.get_int(key),
      });

      const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment,
        climb_rate: 1,
        digits: 0,
      });

      this._settings.bind(key, row, "value", Gio.SettingsBindFlags.DEFAULT);
      return row;
    }

    private _buildReorderableStringList(
      key: string,
      labelFor: (value: string) => string,
      options?: { showToggle?: boolean },
    ): Gtk.ListBox {
      const listBox = new Gtk.ListBox({
        selection_mode: Gtk.SelectionMode.SINGLE,
        show_separators: false,
        accessible_role: Gtk.AccessibleRole.LIST,
      });
      listBox.add_css_class("boxed-list");

      const render = () => {
        let currentChild = listBox.get_first_child();
        while (currentChild) {
          const next = currentChild.get_next_sibling();
          listBox.remove(currentChild);
          currentChild = next;
        }

        const values = this._settings.get_strv(key);
        for (const value of values) {
          const row = this._buildReorderableRow({
            key,
            value,
            label: labelFor(value),
          });
          if (options?.showToggle) {
            const toggle = new Gtk.Switch({ valign: Gtk.Align.CENTER });
            this._settings.bind(
              `${value}-enabled`,
              toggle,
              "active",
              Gio.SettingsBindFlags.DEFAULT,
            );
            row.add_suffix(toggle);
          }
          listBox.append(row);
        }
      };

      render();
      this._settings.connect(`changed::${key}`, render);
      return listBox;
    }

    private _buildReorderableRow(args: {
      key: string;
      value: string;
      label: string;
    }): Adw.ActionRow {
      const { key, value, label } = args;

      const row = new Adw.ActionRow({
        title: label,
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
        const values = this._settings.get_strv(key).filter((v) => v !== value);
        this._settings.set_strv(key, values);
      });
      row.add_suffix(removeButton);

      this._setupRowDragSource(row, value);
      this._setupRowDropTarget(row, key);

      return row;
    }

    private _setupRowDragSource(row: Adw.ActionRow, value: string): void {
      const dragSource = new Gtk.DragSource({
        actions: Gdk.DragAction.MOVE,
      });
      dragSource.connect("prepare", (_source: Gtk.DragSource, _x: number, _y: number) => {
        return Gdk.ContentProvider.new_for_value(value);
      });
      row.add_controller(dragSource);
    }

    private _setupRowDropTarget(row: Adw.ActionRow, key: string): void {
      const dropTarget = new Gtk.DropTarget({
        actions: Gdk.DragAction.MOVE,
      });
      dropTarget.set_gtypes([GObject.TYPE_STRING]);

      dropTarget.connect("drop", (target: Gtk.DropTarget, value: unknown) => {
        const draggedValue = String(value);
        const values = this._settings.get_strv(key);
        const fromIndex = values.indexOf(draggedValue);
        if (fromIndex < 0) return false;

        const targetIndex = row.get_index();
        if (targetIndex < 0 || targetIndex === fromIndex) return false;

        const reordered = [...values];
        reordered.splice(fromIndex, 1);
        reordered.splice(Math.min(targetIndex, reordered.length), 0, draggedValue);
        this._settings.set_strv(key, reordered);
        return true;
      });
      row.add_controller(dropTarget);
    }
  },
);

const ProviderPage = GObject.registerClass(
  class ProviderPage extends Adw.PreferencesPage {
    declare _settings: Gio.Settings;
    declare _provider: string;
    declare _titleChangedId: number;

    _init(settings: Gio.Settings, provider: string) {
      super._init({
        title: settings.get_string(`${provider}-display-name`) ?? provider,
        icon_name: "preferences-system-symbolic",
      });

      this._settings = settings;
      this._provider = provider;

      this._titleChangedId = settings.connect(`changed::${provider}-display-name`, () => {
        this.title = settings.get_string(`${provider}-display-name`) ?? provider;
      });

      this.add(this._buildSettingsGroup());
      this.add(this._buildFieldsGroup("status-fields", _("Status bar fields")));
      this.add(this._buildFieldsGroup("panel-fields", _("Panel fields")));
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
      const locale = this._locale();
      const available = getReaderFields(this._provider);

      const group = new Adw.PreferencesGroup({
        title,
        description: _("Drag rows to reorder. Use “+” to add fields."),
      });

      const addButton = new Gtk.Button({
        icon_name: "list-add-symbolic",
        tooltip_text: _("Add field"),
      });
      addButton.add_css_class("flat");
      group.set_header_suffix(addButton);

      addButton.connect("clicked", () => {
        this._showAddPopover(addButton, key, available, zone, locale);
      });

      const listBox = this._buildFieldListBox(key, available, zone, locale);
      group.add(listBox);
      return group;
    }

    private _buildFieldListBox(
      key: string,
      available: readonly FieldDef[],
      zone: "status" | "panel",
      locale: string,
    ): Gtk.ListBox {
      const listBox = new Gtk.ListBox({
        selection_mode: Gtk.SelectionMode.SINGLE,
        show_separators: false,
      });
      listBox.add_css_class("boxed-list");

      const render = () => {
        let currentChild = listBox.get_first_child();
        while (currentChild) {
          const next = currentChild.get_next_sibling();
          listBox.remove(currentChild);
          currentChild = next;
        }

        const fields = this._settings.get_strv(key);
        for (const name of fields) {
          const def = available.find((f) => f.name === name);
          if (!def) continue;

          const row = new Adw.ActionRow({
            title: def.label,
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

          this._setupFieldDrag(row, name);
          this._setupFieldDrop(row, key);

          listBox.append(row);
        }
      };

      render();
      this._settings.connect(`changed::${key}`, render);
      return listBox;
    }

    private _setupFieldDrag(row: Adw.ActionRow, fieldName: string): void {
      const dragSource = new Gtk.DragSource({ actions: Gdk.DragAction.MOVE });
      dragSource.connect("prepare", () => Gdk.ContentProvider.new_for_value(fieldName));
      row.add_controller(dragSource);
    }

    private _setupFieldDrop(row: Adw.ActionRow, key: string): void {
      const dropTarget = new Gtk.DropTarget({ actions: Gdk.DragAction.MOVE });
      dropTarget.set_gtypes([GObject.TYPE_STRING]);

      dropTarget.connect("drop", (target: Gtk.DropTarget, value: unknown) => {
        const draggedName = String(value);
        const values = this._settings.get_strv(key);
        const fromIndex = values.indexOf(draggedName);
        if (fromIndex < 0) return false;

        const targetIndex = row.get_index();
        if (targetIndex < 0 || targetIndex === fromIndex) return false;

        const reordered = [...values];
        reordered.splice(fromIndex, 1);
        reordered.splice(Math.min(targetIndex, reordered.length), 0, draggedName);
        this._settings.set_strv(key, reordered);
        return true;
      });
      row.add_controller(dropTarget);
    }

    private _showAddPopover(
      anchor: Gtk.Widget,
      key: string,
      available: readonly FieldDef[],
      zone: "status" | "panel",
      locale: string,
    ): void {
      const popover = new Gtk.Popover();
      const listBox = new Gtk.ListBox({
        selection_mode: Gtk.SelectionMode.NONE,
        show_separators: false,
      });
      listBox.add_css_class("boxed-list");

      const used = new Set(this._settings.get_strv(key));
      const availableNames: string[] = [];
      for (const def of available) {
        if (used.has(def.name)) continue;
        availableNames.push(def.name);
        const row = new Adw.ActionRow({
          title: def.label,
          subtitle: this._preview(def, zone, locale),
        });
        listBox.append(row);
      }

      const clickGesture = new Gtk.GestureClick();
      clickGesture.set_propagation_phase(Gtk.PropagationPhase.BUBBLE);
      clickGesture.connect("pressed", (_g: Gtk.GestureClick, _n: number, _x: number, y: number) => {
        const boxRow = listBox.get_row_at_y(y);
        if (!boxRow) return;
        const name = availableNames[boxRow.get_index()];
        if (!name) return;
        const values = this._settings.get_strv(key);
        this._settings.set_strv(key, [...values, name]);
        popover.popdown();
      });
      listBox.add_controller(clickGesture);

      if (used.size >= available.length) {
        listBox.append(
          new Adw.ActionRow({
            title: _("No more fields available"),
            activatable: false,
          }),
        );
      }

      popover.set_child(listBox);
      popover.set_position(Gtk.PositionType.BOTTOM);
      if (anchor instanceof Gtk.Button) {
        popover.set_parent(anchor);
      }
      popover.popup();
      popover.connect("closed", () => popover.unparent());
    }

    private _preview(def: FieldDef, zone: "status" | "panel", locale: string): string {
      return formatField({
        type: def.type,
        value: SAMPLE_VALUES[def.type],
        zone,
        locale,
      });
    }

    private _locale(): string {
      const lang = this._settings.get_string("language");
      if (lang && lang.trim()) return lang.trim();
      const envLang = GLib.getenv("LC_MESSAGES") ?? GLib.getenv("LANG") ?? "en";
      return envLang.split(".")[0];
    }
  },
);

export default class ProviderLimitsPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
    const settings = this.getSettings();

    window.add(new ProviderLimitsPreferencesPage(settings));

    const providerPages = new Map<string, Adw.PreferencesPage>();

    for (const name of PROVIDER_NAMES) {
      if (settings.get_boolean(`${name}-enabled`)) {
        const page = this._buildProviderPage(settings, name);
        providerPages.set(name, page);
        window.add(page);
      }

      settings.connect(`changed::${name}-enabled`, () => {
        const existing = providerPages.get(name);
        if (settings.get_boolean(`${name}-enabled`)) {
          if (!existing) {
            const page = this._buildProviderPage(settings, name);
            providerPages.set(name, page);
            window.add(page);
          }
        } else if (existing) {
          window.remove(existing);
          providerPages.delete(name);
        }
      });
    }

    return Promise.resolve();
  }

  private _buildProviderPage(settings: Gio.Settings, name: string): Adw.PreferencesPage {
    return new ProviderPage(settings, name);
  }
}
