import Gettext from "gettext";
import GLib from "gi://GLib";

import { assertEqual } from "./assert.js";

export async function run() {
  const { configureTranslations, gettext } = await import("../../dist/helpers/gettext.js");
  const path = GLib.get_current_dir() + "/dist";
  const environment = GLib.getenv("LANGUAGE");
  const domain = Gettext.textdomain(null);
  const unrelated = Gettext.dgettext("gnome-shell", "Settings");
  const results = [];
  try {
    configureTranslations(path, "pt_BR");
    assertEqual(gettext("Settings"), "Configurações");
    assertEqual(GLib.getenv("LANGUAGE"), environment);
    assertEqual(Gettext.textdomain(null), domain);
    assertEqual(Gettext.dgettext("gnome-shell", "Settings"), unrelated);
    configureTranslations(path, "");
    assertEqual(GLib.getenv("LANGUAGE"), environment);
    assertEqual(Gettext.textdomain(null), domain);
    assertEqual(Gettext.dgettext("gnome-shell", "Settings"), unrelated);
    results.push({
      name: "Language selection preserves shared gettext and environment",
      passed: true,
    });
  } catch (error) {
    results.push({
      name: "Language selection preserves shared gettext and environment",
      passed: false,
      error: String(error),
    });
  }
  return results;
}
