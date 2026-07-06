import Gettext from "gettext";
import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import {
  ExtensionPreferences,
  gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { PROVIDER_NAMES, type ProviderName } from "./constants.js";
import { ProviderLimitsPreferencesPage, type LanguageEntry } from "./ui/prefs/main-page.js";
import { ProviderPage } from "./ui/prefs/provider-page.js";

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
  private _enabledChangedIds: number[] = [];
  private _pages: Adw.PreferencesPage[] = [];

  private _disconnectEnabledSignals(settings: Gio.Settings): void {
    for (const id of this._enabledChangedIds) {
      settings.disconnect(id);
    }
    this._enabledChangedIds = [];
  }

  private _removeAllPages(window: Adw.PreferencesWindow): void {
    for (const page of this._pages) {
      if ("cleanup" in page && typeof page.cleanup === "function") page.cleanup();
      window.remove(page);
    }
    this._pages = [];
  }

  private _rebuildWindow(window: Adw.PreferencesWindow, settings: Gio.Settings): void {
    this._disconnectEnabledSignals(settings);
    this._removeAllPages(window);
    this._buildWindow(window, settings);
  }

  private _buildWindow(window: Adw.PreferencesWindow, settings: Gio.Settings): void {
    const lang = settings.get_string("language");
    if (lang && lang.trim()) {
      GLib.setenv("LANGUAGE", lang.trim(), true);
    } else {
      GLib.unsetenv("LANGUAGE");
    }
    // Force GLib to re-evaluate the language list so subsequent _()
    // calls pick up the new LANGUAGE value.
    GLib.get_language_names();
    // Rebind the gettext domain to force glibc to reload the .mo file
    // with the updated LANGUAGE.
    const localeDir = GLib.build_filenamev([this.path, "locale"]);
    Gettext.bindtextdomain("gnome-provider-limits", localeDir);
    Gettext.textdomain("gnome-provider-limits");

    const mainPage = new ProviderLimitsPreferencesPage(settings, loadLanguages(this.path));
    window.add(mainPage);
    this._pages.push(mainPage);

    const providerPages = new Map<ProviderName, Adw.PreferencesPage>();

    for (const name of PROVIDER_NAMES) {
      if (settings.get_boolean(`${name}-enabled`)) {
        const page = this._buildProviderPage(settings, name);
        providerPages.set(name, page);
        window.add(page);
        this._pages.push(page);
      }

      const id = settings.connect(`changed::${name}-enabled`, () => {
        const existing = providerPages.get(name);
        if (settings.get_boolean(`${name}-enabled`)) {
          if (!existing) {
            const page = this._buildProviderPage(settings, name);
            providerPages.set(name, page);
            window.add(page);
            this._pages.push(page);
          }
        } else if (existing) {
          if ("cleanup" in existing && typeof existing.cleanup === "function") existing.cleanup();
          window.remove(existing);
          this._pages = this._pages.filter((p) => p !== existing);
          providerPages.delete(name);
        }
      });
      this._enabledChangedIds.push(id);
    }
  }

  fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
    const settings = this.getSettings();

    this._buildWindow(window, settings);

    if (this._languageChangedId) {
      settings.disconnect(this._languageChangedId);
    }
    this._languageChangedId = settings.connect("changed::language", () => {
      this._rebuildWindow(window, settings);
    });

    window.connect("destroy", () => {
      this._disconnectEnabledSignals(settings);
      if (this._languageChangedId) {
        settings.disconnect(this._languageChangedId);
        this._languageChangedId = 0;
      }
    });

    return Promise.resolve();
  }

  private _buildProviderPage(settings: Gio.Settings, name: ProviderName): Adw.PreferencesPage {
    return new ProviderPage(settings, name);
  }
}
