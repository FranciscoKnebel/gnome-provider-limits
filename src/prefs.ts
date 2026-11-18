import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { PROVIDER_NAMES, type ProviderName } from "./constants.js";
import { configureTranslations } from "./helpers/gettext.js";
import { normalizeProvidersOrder } from "./helpers/provider-settings.js";
import { ProviderLimitsPreferencesPage, type LanguageEntry } from "./ui/prefs/main-page.js";
import { ProviderPage } from "./ui/prefs/provider-page.js";
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
  private _enabledChangedIds: number[] = [];
  private _pages: Adw.PreferencesPage[] = [];
  private _windowDestroyed = false;
  private _windowGeneration = 0;

  private _disconnectEnabledSignals(settings: Gio.Settings): void {
    for (const id of this._enabledChangedIds) {
      settings.disconnect(id);
    }
    this._enabledChangedIds = [];
  }

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
    this._disconnectEnabledSignals(settings);
    this._removeAllPages(window);
    this._buildWindow(window, settings);
  }

  private _buildWindow(window: Adw.PreferencesWindow, settings: Gio.Settings): void {
    configureTranslations(this.path, settings.get_string("language"));

    const mainPage = new ProviderLimitsPreferencesPage(settings, loadLanguages(this.path));
    window.add(mainPage);
    this._pages.push(mainPage);

    const providerPages = new Map<ProviderName, Adw.PreferencesPage>();
    let attachedOrder: ProviderName[] = [];

    const syncProviderPages = () => {
      const desiredOrder = normalizeProvidersOrder(settings.get_strv("providers-order")).filter(
        (name) => settings.get_boolean(`${name}-enabled`),
      );
      const desiredSet = new Set(desiredOrder);

      for (const [name, existing] of providerPages) {
        if (!desiredSet.has(name)) {
          this._disposePage(window, existing);
          providerPages.delete(name);
          attachedOrder = attachedOrder.filter((n) => n !== name);
          this._pages = this._pages.filter((p) => p !== existing);
        }
      }

      const samePrefix = attachedOrder.every((name, idx) => desiredOrder[idx] === name);
      if (samePrefix) {
        for (let i = attachedOrder.length; i < desiredOrder.length; i++) {
          const name = desiredOrder[i];
          const page = this._buildProviderPage(settings, name);
          providerPages.set(name, page);
          window.add(page);
          this._pages.push(page);
          attachedOrder.push(name);
        }
        return;
      }

      for (const name of attachedOrder) {
        const existing = providerPages.get(name);
        if (existing) window.remove(existing);
      }

      const nextProviderPages: Adw.PreferencesPage[] = [];
      for (const name of desiredOrder) {
        let page = providerPages.get(name);
        if (!page) {
          page = this._buildProviderPage(settings, name);
          providerPages.set(name, page);
        }
        window.add(page);
        nextProviderPages.push(page);
      }

      attachedOrder = [...desiredOrder];
      this._pages = [mainPage, ...nextProviderPages];
    };

    syncProviderPages();

    this._enabledChangedIds.push(settings.connect("changed::providers-order", syncProviderPages));

    for (const name of PROVIDER_NAMES) {
      this._enabledChangedIds.push(settings.connect(`changed::${name}-enabled`, syncProviderPages));
    }
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
      this._disconnectEnabledSignals(settings);
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

  private _buildProviderPage(settings: Gio.Settings, name: ProviderName): Adw.PreferencesPage {
    return new ProviderPage(settings, name);
  }
}
