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
import { PROVIDER_FIELDS } from "../../readers/fields.js";
import { gettext as _ } from "./gettext.js";
import {
  bindSetting,
  buildReorderableList,
  setupDragSource,
  setupDropTarget,
  unbindSettings,
} from "./shared.js";
import type { SettingsBinding } from "./shared.js";

/** Providers whose configured path points at an existing login file, not an executable. */
const AUTH_FILE_PROVIDERS: ReadonlySet<ProviderName> = new Set(["grok", "cursor", "google"]);

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

interface MatrixRowControls {
  fieldName: string;
  topBarToggle: Gtk.ToggleButton;
  topBarUp: Gtk.Button;
  topBarDown: Gtk.Button;
  panelToggle: Gtk.ToggleButton;
  panelUp: Gtk.Button;
  panelDown: Gtk.Button;
}

function toggleFieldInZone(
  settings: Gio.Settings,
  key: string,
  fieldName: string,
  enabled: boolean,
): void {
  const current = settings.get_strv(key);
  const exists = current.includes(fieldName);
  if (enabled && !exists) {
    settings.set_strv(key, [...current, fieldName]);
  } else if (!enabled && exists) {
    settings.set_strv(
      key,
      current.filter((item) => item !== fieldName),
    );
  }
}

function createZoneControl(options: {
  settings: Gio.Settings;
  key: string;
  fieldName: string;
  label: string;
  availableNames: readonly string[];
  isSyncing: () => boolean;
  requestSync: () => void;
}): { container: Gtk.Box; toggle: Gtk.ToggleButton; up: Gtk.Button; down: Gtk.Button } {
  const { settings, key, fieldName, label, availableNames, isSyncing, requestSync } = options;

  const container = new Gtk.Box({ spacing: 2, valign: Gtk.Align.CENTER });
  const toggle = new Gtk.ToggleButton({
    label,
    tooltip_text: label,
    valign: Gtk.Align.CENTER,
  });
  const up = new Gtk.Button({
    icon_name: "go-up-symbolic",
    tooltip_text: _("Move field up"),
    valign: Gtk.Align.CENTER,
  });
  const down = new Gtk.Button({
    icon_name: "go-down-symbolic",
    tooltip_text: _("Move field down"),
    valign: Gtk.Align.CENTER,
  });
  up.add_css_class("flat");
  down.add_css_class("flat");

  const visibleValues = () =>
    settings.get_strv(key).filter((name) => availableNames.includes(name));

  toggle.connect("toggled", (button: Gtk.ToggleButton) => {
    if (isSyncing()) return;
    toggleFieldInZone(settings, key, fieldName, button.active);
    requestSync();
  });

  up.connect("clicked", () => {
    const reordered = moveAdjacentValue(settings.get_strv(key), visibleValues(), fieldName, -1);
    if (reordered) settings.set_strv(key, reordered);
    requestSync();
  });

  down.connect("clicked", () => {
    const reordered = moveAdjacentValue(settings.get_strv(key), visibleValues(), fieldName, 1);
    if (reordered) settings.set_strv(key, reordered);
    requestSync();
  });

  container.append(toggle);
  container.append(up);
  container.append(down);
  return { container, toggle, up, down };
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
  const availableNames: readonly string[] = available.map((field) => field.name);

  const group = new Adw.PreferencesGroup({
    title: _("Field Matrix"),
    description: _("Toggle fields and set their order for the status bar and panel."),
  });

  const resetButton = new Gtk.Button({
    label: _("Reset defaults"),
    valign: Gtk.Align.CENTER,
  });
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

  const pairs: MatrixRowControls[] = [];
  let syncingToggles = false;

  const sync = () => {
    if (syncingToggles) return;
    syncingToggles = true;
    try {
      const statusValues = settings
        .get_strv(statusKey)
        .filter((name) => availableNames.includes(name));
      const panelValues = settings
        .get_strv(panelKey)
        .filter((name) => availableNames.includes(name));
      for (const pair of pairs) {
        const statusIndex = statusValues.indexOf(pair.fieldName);
        const panelIndex = panelValues.indexOf(pair.fieldName);
        pair.topBarToggle.active = statusIndex >= 0;
        pair.panelToggle.active = panelIndex >= 0;
        pair.topBarUp.sensitive = statusIndex > 0;
        pair.topBarDown.sensitive = statusIndex >= 0 && statusIndex < statusValues.length - 1;
        pair.panelUp.sensitive = panelIndex > 0;
        pair.panelDown.sensitive = panelIndex >= 0 && panelIndex < panelValues.length - 1;
      }
    } finally {
      syncingToggles = false;
    }
  };

  for (const def of available) {
    const row = new Adw.ActionRow({
      title: _(def.label),
      subtitle: formatPreview(def, "panel", locale),
      activatable: false,
    });

    const controls = new Gtk.Box({ spacing: 12, valign: Gtk.Align.CENTER });
    const topBar = createZoneControl({
      settings,
      key: statusKey,
      fieldName: def.name,
      label: _("Top Bar"),
      availableNames,
      isSyncing: () => syncingToggles,
      requestSync: sync,
    });
    const panel = createZoneControl({
      settings,
      key: panelKey,
      fieldName: def.name,
      label: _("Panel"),
      availableNames,
      isSyncing: () => syncingToggles,
      requestSync: sync,
    });
    controls.append(topBar.container);
    controls.append(panel.container);
    row.add_suffix(controls);
    listBox.append(row);

    pairs.push({
      fieldName: def.name,
      topBarToggle: topBar.toggle,
      topBarUp: topBar.up,
      topBarDown: topBar.down,
      panelToggle: panel.toggle,
      panelUp: panel.up,
      panelDown: panel.down,
    });
  }

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
