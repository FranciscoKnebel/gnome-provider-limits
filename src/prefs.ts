import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { configureTranslations } from "./helpers/gettext.js";
import { ProviderLimitsPreferencesPage, type LanguageEntry } from "./ui/prefs/main-page.js";
import { ProvidersPage } from "./ui/prefs/provider-page.js";
import { isDisposablePage } from "./ui/prefs/shared.js";

function loadLanguages(extensionPath: string): LanguageEntry[] {
  try {
    const path = GLib.build_filenamev([extensionPath, "locale", "languages.json"]);
    const [, contents] = GLib.file_get_contents(path);
    const text = new TextDecoder().decode(contents);
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e: unknown): e is LanguageEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as LanguageEntry).code === "string" &&
        typeof (e as LanguageEntry).name === "string",
    );
  } catch {
    log("gnome-provider-limits: failed to load languages.json; language dropdown will be empty");
    return [];
  }
}

export default class ProviderLimitsPreferences extends ExtensionPreferences {
  private _languageChangedId = 0;
  private _languageRebuildId: number | null = null;
  private _pages: Adw.PreferencesPage[] = [];
  private _windowDestroyed = false;
  private _windowGeneration = 0;

  private _removeAllPages(window: Adw.PreferencesWindow): void {
    for (const page of this._pages) {
      this._disposePage(window, page);
    }
    this._pages = [];
  }

  private _disposePage(window: Adw.PreferencesWindow, page: Adw.PreferencesPage): void {
    if (isDisposablePage(page)) page.cleanup();
    window.remove(page);
  }

  private _rebuildWindow(window: Adw.PreferencesWindow, settings: Gio.Settings): void {
    this._removeAllPages(window);
    this._buildWindow(window, settings);
  }

  private _buildWindow(window: Adw.PreferencesWindow, settings: Gio.Settings): void {
    configureTranslations(this.path, settings.get_string("language"));

    const mainPage = new ProviderLimitsPreferencesPage(settings, loadLanguages(this.path));
    window.add(mainPage);
    this._pages.push(mainPage);

    const providersPage = new ProvidersPage(settings);
    window.add(providersPage);
    this._pages.push(providersPage);
  }

  fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
    const settings = this.getSettings();
    this._windowDestroyed = false;
    const generation = ++this._windowGeneration;

    this._buildWindow(window, settings);

    if (this._languageChangedId) {
      settings.disconnect(this._languageChangedId);
    }
    this._languageChangedId = settings.connect("changed::language", () => {
      this._scheduleWindowRebuild(window, settings);
    });

    const cleanup = () => {
      if (this._windowDestroyed || generation !== this._windowGeneration) return;
      this._windowDestroyed = true;
      if (this._languageRebuildId !== null) {
        GLib.Source.remove(this._languageRebuildId);
        this._languageRebuildId = null;
      }
      if (this._languageChangedId) {
        settings.disconnect(this._languageChangedId);
        this._languageChangedId = 0;
      }
      this._removeAllPages(window);
    };
    window.connect("close-request", () => {
      cleanup();
      return false;
    });
    window.connect("destroy", cleanup);

    return Promise.resolve();
  }

  private _scheduleWindowRebuild(window: Adw.PreferencesWindow, settings: Gio.Settings): void {
    if (this._windowDestroyed) return;
    if (this._languageRebuildId !== null) {
      GLib.Source.remove(this._languageRebuildId);
    }
    this._languageRebuildId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this._languageRebuildId = null;
      if (this._windowDestroyed) return GLib.SOURCE_REMOVE;
      this._rebuildWindow(window, settings);
      return GLib.SOURCE_REMOVE;
    });
  }
}
