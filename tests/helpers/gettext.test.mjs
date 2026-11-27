import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { assert, load } from "./node-harness.mjs";

test("Language override, system selection, self-heal and disable preserve shared gettext state", async () => {
  const env = { LANGUAGE: "de:en" };
  let domain = "gnome-shell";
  const parseCatalog = load("src/helpers/catalog.ts", "parseCatalog");
  const translations = load("src/helpers/gettext.ts", "({configureTranslations, gettext})", {
    GLib: {
      get_language_names: () => ["de", "en"],
      build_filenamev: (parts) => parts.join("/"),
    },
    Gio: {
      _promisify() {},
      File: {
        prototype: {},
        new_for_path: (path) => ({ load_contents_async: async () => [await readFile(path)] }),
      },
    },
    GETTEXT_DOMAIN: "gnome-provider-limits",
    parseCatalog,
  });
  const unrelated = () => `${env.LANGUAGE}:${domain}`;
  const before = unrelated();
  await translations.configureTranslations("dist", "pt_BR");
  assert.equal(translations.gettext("Settings"), "Configurações");
  assert.equal(unrelated(), before);
  await translations.configureTranslations("dist", "");
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
  extension._selfHealLanguage(extension.getSettings());
  extension.disable();
  assert.equal(selected, "");
  assert.equal(unrelated(), before);
});
