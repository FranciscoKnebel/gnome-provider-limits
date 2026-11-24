import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk?version=4.0";

import { AUTH_FILE_PROVIDERS, type ProviderName } from "../../constants.js";
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
import { PROVIDER_FIELDS } from "../../readers/fields.js";
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

function formatPreview(def: FieldDef, zone: "status" | "panel", locale: string): string {
  return formatField({
    type: def.type,
    value: sampleValue(def.type),
    zone,
    locale,
    t: _,
  });
}

interface MatrixRowTogglePair {
  fieldName: string;
  topBarToggle: Gtk.ToggleButton;
  panelToggle: Gtk.ToggleButton;
}

function buildFieldMatrixGroup(
  settings: Gio.Settings,
  provider: ProviderName,
  locale: string,
  destroyCallbacks: (() => void)[],
): Adw.PreferencesGroup {
  const statusKey = `${provider}-status-fields`;
  const panelKey = `${provider}-panel-fields`;
  const available = PROVIDER_FIELDS[provider];

  const group = new Adw.PreferencesGroup({
    title: _("Field Matrix"),
    description: _("Toggle which fields appear in the status bar and panel."),
  });

  const resetButton = new Gtk.Button({ label: _("Reset defaults"), valign: Gtk.Align.CENTER });
  resetButton.add_css_class("flat");
  resetButton.connect("clicked", () => {
    settings.reset(statusKey);
    settings.reset(panelKey);
  });
  group.set_header_suffix(resetButton);

  const listBox = new Gtk.ListBox({
    selection_mode: Gtk.SelectionMode.NONE,
    show_separators: false,
    accessible_role: Gtk.AccessibleRole.LIST,
  });
  listBox.add_css_class("boxed-list");

  const pairs: MatrixRowTogglePair[] = [];
  let syncing = false;

  const setFieldInZone = (key: string, fieldName: string, enabled: boolean) => {
    const values = settings.get_strv(key);
    const present = values.includes(fieldName);
    if (enabled && !present) settings.set_strv(key, [...values, fieldName]);
    if (!enabled && present)
      settings.set_strv(
        key,
        values.filter((name) => name !== fieldName),
      );
  };

  for (const def of available) {
    const row = new Adw.ActionRow({
      title: _(def.label),
      subtitle: formatPreview(def, "panel", locale),
      activatable: false,
    });
    const controls = new Gtk.Box({ spacing: 6, valign: Gtk.Align.CENTER });
    const topBarToggle = new Gtk.ToggleButton({ label: _("Top Bar"), valign: Gtk.Align.CENTER });
    const panelToggle = new Gtk.ToggleButton({ label: _("Panel"), valign: Gtk.Align.CENTER });
    topBarToggle.connect("toggled", (button: Gtk.ToggleButton) => {
      if (syncing) return;
      setFieldInZone(statusKey, def.name, button.active);
    });
    panelToggle.connect("toggled", (button: Gtk.ToggleButton) => {
      if (syncing) return;
      setFieldInZone(panelKey, def.name, button.active);
    });
    controls.append(topBarToggle);
    controls.append(panelToggle);
    row.add_suffix(controls);
    listBox.append(row);
    pairs.push({ fieldName: def.name, topBarToggle, panelToggle });
  }

  const sync = () => {
    if (syncing) return;
    syncing = true;
    try {
      const statusValues: readonly string[] = settings.get_strv(statusKey);
      const panelValues: readonly string[] = settings.get_strv(panelKey);
      for (const pair of pairs) {
        pair.topBarToggle.active = statusValues.includes(pair.fieldName);
        pair.panelToggle.active = panelValues.includes(pair.fieldName);
      }
    } finally {
      syncing = false;
    }
  };
  const statusChangedId = settings.connect(`changed::${statusKey}`, sync);
  const panelChangedId = settings.connect(`changed::${panelKey}`, sync);
  destroyCallbacks.push(() => {
    settings.disconnect(statusChangedId);
    settings.disconnect(panelChangedId);
  });
  sync();
  group.add(listBox);
  return group;
}

function buildFieldOrderGroup(
  settings: Gio.Settings,
  provider: ProviderName,
  suffix: "status-fields" | "panel-fields",
  title: string,
  locale: string,
  destroyCallbacks: (() => void)[],
): Adw.PreferencesGroup {
  const key = `${provider}-${suffix}`;
  const zone = suffix === "status-fields" ? "status" : "panel";
  const available = PROVIDER_FIELDS[provider];

  const group = new Adw.PreferencesGroup({
    title,
    description: _("Reorder active fields with the arrow buttons or by dragging."),
  });

  const { listBox, destroy } = buildReorderableList(
    settings,
    key,
    (name, context) => {
      const def = available.find((field) => field.name === name);
      if (!def) return null;

      const row = new Adw.ActionRow({
        title: _(def.label),
        subtitle: formatPreview(def, zone, locale),
        activatable: false,
      });
      const dragHandle = new Gtk.Image({
        icon_name: "list-drag-handle-symbolic",
        valign: Gtk.Align.CENTER,
      });
      row.add_prefix(dragHandle);

      const moveButtons = createMoveButtons({
        settings,
        key,
        visibleValues: context.visibleValues,
        index: context.index,
        moveUpLabel: _("Move field up"),
        moveDownLabel: _("Move field down"),
      });
      row.add_suffix(moveButtons);

      const removeButton = new Gtk.Button({
        icon_name: "list-remove-symbolic",
        valign: Gtk.Align.CENTER,
        tooltip_text: _("Remove"),
      });
      removeButton.add_css_class("flat");
      removeButton.connect("clicked", () => {
        settings.set_strv(
          key,
          settings.get_strv(key).filter((value) => value !== name),
        );
      });
      row.add_suffix(removeButton);

      setupDragSource(row, name);
      setupDropTarget(row, settings, key, name);
      return row;
    },
    {
      isRenderable: (name) => available.some((field) => field.name === name),
      emptyText: _("No fields selected."),
    },
  );
  destroyCallbacks.push(destroy);
  group.add(listBox);
  return group;
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
      index?: number,
      totalCount?: number,
      onMove?: (offset: -1 | 1) => void,
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

      if (onMove && index !== undefined && totalCount !== undefined) {
        const upButton = new Gtk.Button({
          icon_name: "go-up-symbolic",
          valign: Gtk.Align.CENTER,
          tooltip_text: _("Move provider up"),
          sensitive: index > 0,
        });
        upButton.add_css_class("flat");
        upButton.connect("clicked", () => onMove(-1));
        this.add_suffix(upButton);

        const downButton = new Gtk.Button({
          icon_name: "go-down-symbolic",
          valign: Gtk.Align.CENTER,
          tooltip_text: _("Move provider down"),
          sensitive: index < totalCount - 1,
        });
        downButton.add_css_class("flat");
        downButton.connect("clicked", () => onMove(1));
        this.add_suffix(downButton);
      }

      this._buildContent();
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

    private _buildContent(): void {
      const locale = resolveLocale(
        this._settings.get_string("language"),
        GLib.getenv("LC_MESSAGES"),
        GLib.getenv("LANG"),
      );

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
      const isAuthFile = AUTH_FILE_PROVIDERS.has(this._provider);
      const cliRow = new Adw.EntryRow({
        title: isAuthFile ? _("Authentication file") : _("CLI path"),
        text: this._settings.get_string(pathKey) ?? "",
      });
      bindSetting(this._settings, pathKey, cliRow, "text", this._bindings);
      this.add_row(cliRow);

      const matrixGroup = buildFieldMatrixGroup(
        this._settings,
        this._provider,
        locale,
        this._destroyCallbacks,
      );
      this.add_row(matrixGroup);
      this.add_row(
        buildFieldOrderGroup(
          this._settings,
          this._provider,
          "status-fields",
          _("Status bar fields"),
          locale,
          this._destroyCallbacks,
        ),
      );
      this.add_row(
        buildFieldOrderGroup(
          this._settings,
          this._provider,
          "panel-fields",
          _("Panel fields"),
          locale,
          this._destroyCallbacks,
        ),
      );
    }
  },
);

export const ProvidersPage = GObject.registerClass(
  class ProvidersPage extends Adw.PreferencesPage {
    declare _settings: Gio.Settings;
    declare _destroyCallbacks: (() => void)[];

    _init(settings: Gio.Settings) {
      super._init({
        title: _("Providers"),
        icon_name: "preferences-system-symbolic",
      });

      this._settings = settings;
      this._destroyCallbacks = [];

      const group = new Adw.PreferencesGroup({
        title: _("Active Providers"),
        description: _(
          "Enable, configure, and reorder AI coding providers. Expand any provider to edit credentials and the field matrix.",
        ),
      });

      const { listBox, destroy } = buildReorderableList(
        this._settings,
        "providers-order",
        (name, context) => {
          if (!isProviderName(name)) return null;
          return new ProviderExpanderRow(
            this._settings,
            name,
            context.index,
            context.visibleValues.length,
            (offset) => {
              const current = this._settings.get_strv("providers-order");
              const reordered = moveAdjacentValue(current, context.visibleValues, name, offset);
              if (reordered) this._settings.set_strv("providers-order", reordered);
            },
          );
        },
        {
          normalizeValues: (values) => normalizeProvidersOrder(values),
          isRenderable: (value): value is ProviderName => isProviderName(value),
        },
      );

      this._destroyCallbacks.push(destroy);
      group.add(listBox);
      this.add(group);
      this.connect("destroy", () => this.cleanup());
    }

    cleanup(): void {
      for (const destroy of this._destroyCallbacks) destroy();
      this._destroyCallbacks = [];
    }
  },
);
