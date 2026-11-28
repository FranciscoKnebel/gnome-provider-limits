import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { GETTEXT_DOMAIN } from "../constants.js";
import { parseCatalog } from "./catalog.js";

let catalog = new Map<string, string>();
let configureGeneration = 0;

Gio._promisify(Gio.File.prototype, "load_contents_async", "load_contents_finish");

export async function configureTranslations(
  extensionPath: string,
  language: string,
): Promise<void> {
  const generation = ++configureGeneration;
  catalog = new Map();
  const languages = language.trim() ? [language.trim()] : GLib.get_language_names();
  for (const candidate of languages) {
    if (!/^[A-Za-z0-9_@.-]+$/.test(candidate)) continue;
    const code = candidate.split(".")[0];
    if (!code) continue;
    try {
      const path = GLib.build_filenamev([
        extensionPath,
        "locale",
        code,
        "LC_MESSAGES",
        `${GETTEXT_DOMAIN}.mo`,
      ]);
      const [bytes] = await Gio.File.new_for_path(path).load_contents_async(null);
      if (generation !== configureGeneration) return;
      catalog = parseCatalog(bytes);
      return;
    } catch {
      if (generation !== configureGeneration) return;
      // Follow GLib's language preference list; absent catalogs use source strings.
    }
  }
  if (generation === configureGeneration) {
    catalog = new Map();
  }
}

export function gettext(text: string): string {
  return catalog.get(text) || text;
}
