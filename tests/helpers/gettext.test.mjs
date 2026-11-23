import { readFileSync } from "node:fs";
import { test } from "node:test";

import { assert, load } from "./node-harness.mjs";

test("Language override, system selection, self-heal and disable preserve shared gettext state", () => {
  const env = { LANGUAGE: "de:en" };
  let domain = "gnome-shell";
  const parseCatalog = load("src/helpers/catalog.ts", "parseCatalog");
  const translations = load("src/helpers/gettext.ts", "({configureTranslations, gettext})", {
    GLib: {
      get_language_names: () => ["de", "en"],
      file_get_contents: (path) => [true, readFileSync(path)],
      build_filenamev: (parts) => parts.join("/"),
    },
    GETTEXT_DOMAIN: "gnome-provider-limits",
    parseCatalog,
  });
  const unrelated = () => `${env.LANGUAGE}:${domain}`;
  const before = unrelated();
  translations.configureTranslations("dist", "pt_BR");
  assert.equal(translations.gettext("Settings"), "Configurações");
  assert.equal(unrelated(), before);
  translations.configureTranslations("dist", "");
  assert.equal(translations.gettext("Settings"), "Einstellungen");
  assert.equal(unrelated(), before);
  const K = load("src/extension.ts", "ProviderLimitsExtension", {
    GObject: { registerClass: (k) => k },
    PanelMenu: { Button: class {} },
    Extension: class {},
    GLib: {
      build_filenamev: (parts) => parts.join("/"),
      file_test: () => false,
      FileTest: { EXISTS: 1 },
    },
    GETTEXT_DOMAIN: "gnome-provider-limits",
    log() {},
  });
  const extension = new K();
  let selected = "missing";
  extension.getSettings = () => ({
    get_string: () => selected,
    set_string: (_key, value) => {
      selected = value;
    },
  });
  extension._selfHealLanguage();
  extension.disable();
  assert.equal(selected, "");
  assert.equal(unrelated(), before);
});
