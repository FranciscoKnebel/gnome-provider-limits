import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk?version=4.0";

import type { ProviderName } from "../../constants.js";
import { formatField } from "../../formatters.js";
import { resolveLocale } from "../../helpers/locale.js";
import { providerDisplayName } from "../../helpers/provider-settings.js";
import type { FieldDef, FieldType } from "../../readers/base.js";
import { DEFAULT_PROVIDER_ZONE_FIELDS, PROVIDER_FIELDS } from "../../readers/fields.js";
import { gettext as _ } from "./gettext.js";
import {
  bindSetting,
  buildReorderableList,
  createMoveButtons,
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

interface MatrixRowTogglePair {
  fieldName: string;
  topBarToggle: Gtk.ToggleButton;
  panelToggle: Gtk.ToggleButton;
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
      this.add(this._buildFieldMatrixGroup());
      this.add(this._buildOrderGroup("status-fields", _("Status bar fields")));
      this.add(this._buildOrderGroup("panel-fields", _("Panel fields")));
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
      const isAuthFileProvider =
        this._provider === "grok" || this._provider === "cursor" || this._provider === "google";
      const cliRow = new Adw.EntryRow({
        title: isAuthFileProvider ? _("Authentication file") : _("CLI path"),
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
      } else if (this._provider === "cursor") {
        group.add(
          new Adw.ActionRow({
            title: _("Sign in with `cursor-agent login`."),
            subtitle: _(
              "Leave the authentication file empty to use ~/.cursor/sdk/auth.json or ~/.config/cursor/auth.json.",
            ),
          }),
        );
      } else if (this._provider === "google") {
        group.add(
          new Adw.ActionRow({
            title: _("Sign in with Gemini CLI or Antigravity."),
            subtitle: _(
              "Leave the authentication file empty to use ~/.gemini/oauth_creds.json or Antigravity credentials.",
            ),
          }),
        );
      }
      return group;
    }

    private _buildFieldMatrixGroup(): Adw.PreferencesGroup {
      const statusKey = `${this._provider}-status-fields`;
      const panelKey = `${this._provider}-panel-fields`;
      const available = PROVIDER_FIELDS[this._provider];
      const locale = resolveLocale(
        this._settings.get_string("language"),
        GLib.getenv("LC_MESSAGES"),
        GLib.getenv("LANG"),
      );

      const group = new Adw.PreferencesGroup({
        title: _("Field Matrix"),
        description: _("Toggle which fields appear in the status bar and panel."),
      });

      const resetButton = new Gtk.Button({
        label: _("Reset defaults"),
        valign: Gtk.Align.CENTER,
      });
      resetButton.add_css_class("flat");
      resetButton.connect("clicked", () => {
        const defaults = DEFAULT_PROVIDER_ZONE_FIELDS[this._provider];
        this._settings.set_strv(statusKey, [...defaults.status]);
        this._settings.set_strv(panelKey, [...defaults.panel]);
      });
      group.set_header_suffix(resetButton);

      const listBox = new Gtk.ListBox({
        selection_mode: Gtk.SelectionMode.NONE,
        show_separators: false,
        accessible_role: Gtk.AccessibleRole.LIST,
      });
      listBox.add_css_class("boxed-list");

      const pairs: MatrixRowTogglePair[] = [];
      let syncingToggles = false;

      const toggleFieldInZone = (key: string, fieldName: string, enabled: boolean) => {
        const current = this._settings.get_strv(key);
        const exists = current.includes(fieldName);
        if (enabled && !exists) {
          this._settings.set_strv(key, [...current, fieldName]);
        } else if (!enabled && exists) {
          this._settings.set_strv(
            key,
            current.filter((item) => item !== fieldName),
          );
        }
      };

      const initialStatus = new Set(this._settings.get_strv(statusKey));
      const initialPanel = new Set(this._settings.get_strv(panelKey));

      for (const def of available) {
        const row = new Adw.ActionRow({
          title: _(def.label),
          subtitle: this._preview(def, "panel", locale),
          activatable: false,
        });

        const buttonBox = new Gtk.Box({
          spacing: 6,
          valign: Gtk.Align.CENTER,
        });

        const topBarToggle = new Gtk.ToggleButton({
          label: _("Top Bar"),
          active: initialStatus.has(def.name),
          valign: Gtk.Align.CENTER,
          tooltip_text: _("Top Bar"),
        });
        topBarToggle.connect("toggled", (btn: Gtk.ToggleButton) => {
          if (syncingToggles) return;
          toggleFieldInZone(statusKey, def.name, btn.active);
        });

        const panelToggle = new Gtk.ToggleButton({
          label: _("Panel"),
          active: initialPanel.has(def.name),
          valign: Gtk.Align.CENTER,
          tooltip_text: _("Panel"),
        });
        panelToggle.connect("toggled", (btn: Gtk.ToggleButton) => {
          if (syncingToggles) return;
          toggleFieldInZone(panelKey, def.name, btn.active);
        });

        buttonBox.append(topBarToggle);
        buttonBox.append(panelToggle);
        row.add_suffix(buttonBox);
        listBox.append(row);

        pairs.push({ fieldName: def.name, topBarToggle, panelToggle });
      }

      const syncToggles = () => {
        if (syncingToggles) return;
        syncingToggles = true;
        try {
          const statusSet = new Set(this._settings.get_strv(statusKey));
          const panelSet = new Set(this._settings.get_strv(panelKey));
          for (const pair of pairs) {
            const wantStatus = statusSet.has(pair.fieldName);
            if (pair.topBarToggle.active !== wantStatus) {
              pair.topBarToggle.active = wantStatus;
            }
            const wantPanel = panelSet.has(pair.fieldName);
            if (pair.panelToggle.active !== wantPanel) {
              pair.panelToggle.active = wantPanel;
            }
          }
        } finally {
          syncingToggles = false;
        }
      };

      const statusChangedId = this._settings.connect(`changed::${statusKey}`, syncToggles);
      const panelChangedId = this._settings.connect(`changed::${panelKey}`, syncToggles);
      this._destroyCallbacks.push(() => {
        this._settings.disconnect(statusChangedId);
        this._settings.disconnect(panelChangedId);
      });

      group.add(listBox);
      return group;
    }

    private _buildOrderGroup(
      suffix: "status-fields" | "panel-fields",
      title: string,
    ): Adw.PreferencesGroup {
      const key = `${this._provider}-${suffix}`;
      const zone = suffix === "status-fields" ? "status" : "panel";
      const locale = resolveLocale(
        this._settings.get_string("language"),
        GLib.getenv("LC_MESSAGES"),
        GLib.getenv("LANG"),
      );
      const available = PROVIDER_FIELDS[this._provider];

      const group = new Adw.PreferencesGroup({
        title,
        description: _("Reorder active fields with the arrow buttons or by dragging."),
      });

      const { listBox, destroy } = buildReorderableList(
        this._settings,
        key,
        (name, context) => {
          const def = available.find((f) => f.name === name);
          if (!def) return null;

          const row = new Adw.ActionRow({
            title: _(def.label),
            subtitle: this._preview(def, zone, locale),
            activatable: false,
          });

          const dragHandle = new Gtk.Image({ icon_name: "list-drag-handle-symbolic" });
          row.add_prefix(dragHandle);

          const moveButtons = createMoveButtons({
            settings: this._settings,
            key,
            visibleValues: context.visibleValues,
            index: context.index,
            moveUpLabel: _("Move up"),
            moveDownLabel: _("Move down"),
          });
          row.add_suffix(moveButtons);

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
        {
          isRenderable: (name) => available.some((f) => f.name === name),
          emptyText: _("No fields selected."),
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
