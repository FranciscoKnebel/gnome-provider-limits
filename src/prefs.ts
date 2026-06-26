import Adw from "gi://Adw";
import Gio from "gi://Gio";
import {
  ExtensionPreferences,
  gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { PROVIDER_NAMES } from "./constants.js";
import { ProviderLimitsPreferencesPage } from "./ui/prefs/main-page.js";
import { ProviderPage } from "./ui/prefs/provider-page.js";

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
