import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { configureTranslations } from "./helpers/gettext.js";
import { ProviderLimitsPreferencesPage, type LanguageEntry } from "./ui/prefs/main-page.js";
import { ProvidersPage } from "./ui/prefs/provider-page.js";
import { isDisposablePage } from "./ui/prefs/shared.js";

interface PreferencesWindowState {
  languageChangedId: number;
  languageRebuildId: number | null;
  pages: Adw.PreferencesPage[];
  destroyed: boolean;
  building: boolean;
  languageChangedDuringBuild: boolean;
}

Gio._promisify(Gio.File.prototype, "load_contents_async", "load_contents_finish");

async function loadLanguages(extensionPath: string): Promise<LanguageEntry[]> {
  try {
    const path = GLib.build_filenamev([extensionPath, "locale", "languages.json"]);
    const [contents] = await Gio.File.new_for_path(path).load_contents_async(null);
    const text = new TextDecoder().decode(contents);
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e: unknown): e is LanguageEntry =>
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        typeof e.code === "string" &&
        "name" in e &&
        typeof e.name === "string",
    );
  } catch {
    log("gnome-provider-limits: failed to load languages.json; language dropdown will be empty");
    return [];
  }
}

export default class ProviderLimitsPreferences extends ExtensionPreferences {
  private _removeAllPages(window: Adw.PreferencesWindow, state: PreferencesWindowState): void {
    for (const page of state.pages) {
      this._disposePage(window, page);
    }
    state.pages = [];
  }

  private _disposePage(window: Adw.PreferencesWindow, page: Adw.PreferencesPage): void {
    if (isDisposablePage(page)) page.cleanup();
    window.remove(page);
  }

  private async _rebuildWindow(
    window: Adw.PreferencesWindow,
    settings: Gio.Settings,
    state: PreferencesWindowState,
  ): Promise<void> {
    state.building = true;
    this._removeAllPages(window, state);
    await this._buildWindow(window, settings, state);
    if (state.destroyed) return;
    state.building = false;
    this._schedulePendingLanguageChange(window, settings, state);
  }

  private async _buildWindow(
    window: Adw.PreferencesWindow,
    settings: Gio.Settings,
    state: PreferencesWindowState,
  ): Promise<void> {
    await configureTranslations(this.path, settings.get_string("language"));
    if (state.destroyed) return;

    const languages = await loadLanguages(this.path);
    if (state.destroyed) return;

    const mainPage = new ProviderLimitsPreferencesPage(settings, languages);
    window.add(mainPage);
    state.pages.push(mainPage);

    const providersPage = new ProvidersPage(settings);
    window.add(providersPage);
    state.pages.push(providersPage);
  }

  async fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
    const settings = this.getSettings();
    const state: PreferencesWindowState = {
      languageChangedId: 0,
      languageRebuildId: null,
      pages: [],
      destroyed: false,
      building: true,
      languageChangedDuringBuild: false,
    };

    const cleanup = () => {
      if (state.destroyed) return;
      state.destroyed = true;
      if (state.languageRebuildId !== null) {
        GLib.Source.remove(state.languageRebuildId);
        state.languageRebuildId = null;
      }
      if (state.languageChangedId) {
        settings.disconnect(state.languageChangedId);
        state.languageChangedId = 0;
      }
      this._removeAllPages(window, state);
    };
    window.connect("close-request", () => {
      cleanup();
      return false;
    });
    window.connect("destroy", cleanup);

    state.languageChangedId = settings.connect("changed::language", () => {
      if (state.destroyed) return;
      if (state.building) {
        state.languageChangedDuringBuild = true;
        return;
      }
      this._scheduleWindowRebuild(window, settings, state);
    });

    await this._buildWindow(window, settings, state);
    if (state.destroyed) return;
    state.building = false;
    this._schedulePendingLanguageChange(window, settings, state);
  }

  private _schedulePendingLanguageChange(
    window: Adw.PreferencesWindow,
    settings: Gio.Settings,
    state: PreferencesWindowState,
  ): void {
    if (!state.languageChangedDuringBuild || state.destroyed) return;
    state.languageChangedDuringBuild = false;
    this._scheduleWindowRebuild(window, settings, state);
  }

  private _scheduleWindowRebuild(
    window: Adw.PreferencesWindow,
    settings: Gio.Settings,
    state: PreferencesWindowState,
  ): void {
    if (state.destroyed) return;
    if (state.languageRebuildId !== null) {
      GLib.Source.remove(state.languageRebuildId);
    }
    state.languageRebuildId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      state.languageRebuildId = null;
      if (state.destroyed) return GLib.SOURCE_REMOVE;
      void this._rebuildWindow(window, settings, state).catch((error: unknown) => {
        log(`gnome-provider-limits: failed to rebuild preferences window: ${String(error)}`);
      });
      return GLib.SOURCE_REMOVE;
    });
  }
}
