import Gettext from "gettext";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import St from "gi://St";
import { Extension, gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import type * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import { DEFAULT_REFRESH_SHORT_INTERVAL_SECONDS, PROVIDER_NAMES } from "./constants.js";
import { readerResultsEqual } from "./helpers/reader.js";
import type { BaseReader, ReaderResult } from "./readers/base.js";
import { ClaudeReader } from "./readers/claude.js";
import { CodexReader } from "./readers/codex.js";
import { OpenCodeReader } from "./readers/opencode.js";
import { PanelWidget } from "./ui/panel.js";
import { StatusBarWidget } from "./ui/statusBar.js";

const PROVIDER_LIMITS_UUID = "gnome-provider-limits@franciscoknebel.com";

const ProviderLimitsIndicator = GObject.registerClass(
  class ProviderLimitsIndicator extends PanelMenu.Button {
    declare _extension: Extension;
    declare _settings: Gio.Settings;
    declare _readers: Map<string, BaseReader>;
    declare _results: Map<string, ReaderResult>;
    declare _refreshSourceId: number | null;
    declare _stableReads: number;
    declare _icon: St.Icon;
    declare _statusBar: InstanceType<typeof StatusBarWidget>;
    declare _panel: PanelWidget;
    declare _settingsChangedIds: number[];

    // @ts-expect-error GJS registerClass allows custom _init signatures at runtime;
    //    TypeScript cannot model the union of inherited base overloads with an
    //    additional custom argument, so property assignability with Button fails.
    _init(extension: Extension) {
      this._extension = extension;
      this._settings = extension.getSettings();

      // Override language before any _() calls so gettext picks it up
      // from the first render onward.
      this._applyLanguageOverride();

      super._init(0.5, _("Provider Limits"));

      this._readers = new Map();
      this._results = new Map();
      this._refreshSourceId = null;
      this._stableReads = 0;
      this._settingsChangedIds = [];

      const box = new St.BoxLayout({
        style_class: "provider-limits-status-bar",
      });

      this._icon = new St.Icon({
        gicon: Gio.icon_new_for_string(
          GLib.build_filenamev([extension.path, "icons", "provider-limits-symbolic.svg"]),
        ),
        icon_size: 16,
        style_class: "system-status-icon",
        y_align: Clutter.ActorAlign.CENTER,
      });
      box.add_child(this._icon);

      this._statusBar = new StatusBarWidget(this._settings, this._readers);
      box.add_child(this._statusBar);
      this.add_child(box);

      this._panel = new PanelWidget(
        this._settings,
        this._readers,
        () => {
          this._extension.openPreferences();
        },
        () => {
          void this.refresh();
        },
      );
      // PanelMenu.Button always creates a real PopupMenu (only PopupDummyMenu when
      // dontCreateMenu=true, which we never pass). The type is a union though, so
      // narrow to PopupMenu.PopupMenu before using addMenuItem.
      (this.menu as PopupMenu.PopupMenu).addMenuItem(this._panel);

      this._initReaders();
      this._connectSettingsSignals();
      this._restartRefreshTimer();
      void this.refresh();
    }

    private _initReaders(): void {
      for (const name of PROVIDER_NAMES) {
        if (!this._settings.get_boolean(`${name}-enabled`)) continue;

        const reader = this._createReader(name);
        if (reader) {
          this._readers.set(name, reader);
        }
      }
    }

    private _connectSettingsSignals(): void {
      const onRender = () => this._render();

      for (const name of PROVIDER_NAMES) {
        this._settingsChangedIds.push(
          this._settings.connect(`changed::${name}-enabled`, () =>
            this._onProviderEnabledChanged(name),
          ),
        );
        this._settingsChangedIds.push(
          this._settings.connect(`changed::${name}-display-name`, onRender),
        );
        this._settingsChangedIds.push(
          this._settings.connect(`changed::${name}-display-name-short`, onRender),
        );
      }

      this._settingsChangedIds.push(this._settings.connect(`changed::providers-order`, onRender));
      this._settingsChangedIds.push(
        this._settings.connect(`changed::language`, () => {
          this._applyLanguageOverride();
          this._render();
        }),
      );
    }

    private _applyLanguageOverride(): void {
      const lang = this._settings.get_string("language");
      if (lang && lang.trim()) {
        GLib.setenv("LANGUAGE", lang.trim(), true);
      } else {
        GLib.unsetenv("LANGUAGE");
      }
      GLib.get_language_names();
      const localeDir = GLib.build_filenamev([this._extension.path, "locale"]);
      Gettext.bindtextdomain("gnome-provider-limits", localeDir);
      Gettext.textdomain("gnome-provider-limits");
    }

    private _onProviderEnabledChanged(name: string): void {
      const enabled = this._settings.get_boolean(`${name}-enabled`);

      if (enabled) {
        if (this._readers.has(name)) return;

        const reader = this._createReader(name);
        if (reader) {
          this._readers.set(name, reader);
          void this.refresh();
        }
      } else {
        const reader = this._readers.get(name);
        if (!reader) return;

        reader.destroy();
        this._readers.delete(name);
        this._results.delete(name);
        this._render();
      }
    }

    private _createReader(name: string): BaseReader | null {
      switch (name) {
        case "codex":
          return new CodexReader(this._settings, "codex");
        case "claude":
          return new ClaudeReader(this._settings, "claude");
        case "opencode":
          return new OpenCodeReader(this._settings, "opencode");
        default:
          return null;
      }
    }

    async refresh(): Promise<void> {
      const order = this._settings.get_strv("providers-order");
      const previousResults = new Map(this._results);
      this._results.clear();

      const entries = order
        .map((name) => ({ name, reader: this._readers.get(name) }))
        .filter((e): e is { name: string; reader: BaseReader } => !!e.reader);

      const settled = await Promise.allSettled(entries.map((e) => e.reader.read()));

      let anyChanged = false;

      for (const [i, result] of settled.entries()) {
        const name = entries[i].name;

        if (result.status === "rejected") {
          console.error(`[provider-limits] reader ${name} failed:`, result.reason);
          continue;
        }

        if (!this._readers.has(name)) continue;

        this._results.set(name, result.value);

        const prev = previousResults.get(name);
        if (!prev || !readerResultsEqual(prev, result.value)) {
          anyChanged = true;
        }
      }

      if (anyChanged) {
        this._stableReads = 0;
      } else {
        this._stableReads++;
      }

      this._render();
    }

    private _render(): void {
      this._statusBar.render(this._results);
      this._panel.render(this._results);
    }

    private _getCurrentInterval(): number {
      const threshold = this._settings.get_int("refresh-stable-reads-threshold");
      const shortInterval = this._settings.get_int("refresh-short-interval-seconds");
      const longInterval = this._settings.get_int("refresh-long-interval-seconds");

      return this._stableReads >= threshold ? longInterval : shortInterval;
    }

    private _restartRefreshTimer(): void {
      if (this._refreshSourceId !== null) {
        GLib.Source.remove(this._refreshSourceId);
        this._refreshSourceId = null;
      }

      const interval = this._getCurrentInterval();
      this._refreshSourceId = GLib.timeout_add_seconds(
        GLib.PRIORITY_DEFAULT,
        Math.max(interval, DEFAULT_REFRESH_SHORT_INTERVAL_SECONDS),
        () => {
          void this.refresh();
          this._restartRefreshTimer();
          return GLib.SOURCE_REMOVE;
        },
      );
    }

    destroy(): void {
      for (const id of this._settingsChangedIds) {
        this._settings.disconnect(id);
      }
      this._settingsChangedIds = [];

      if (this._refreshSourceId !== null) {
        GLib.Source.remove(this._refreshSourceId);
        this._refreshSourceId = null;
      }

      for (const reader of this._readers.values()) {
        reader.destroy();
      }
      this._readers.clear();
      this._results.clear();

      super.destroy();
    }
  },
);

export default class ProviderLimitsExtension extends Extension {
  private _indicator: InstanceType<typeof ProviderLimitsIndicator> | null = null;

  enable(): void {
    this._indicator = new ProviderLimitsIndicator(this);
    Main.panel.addToStatusArea(
      PROVIDER_LIMITS_UUID,
      // @ts-expect-error GJS registerClass casts our class to Button at runtime;
      //    the custom _init signature prevents structural assignability here.
      this._indicator,
      0,
      "right",
    );
  }

  disable(): void {
    this._indicator?.destroy();
    this._indicator = null;
  }
}
