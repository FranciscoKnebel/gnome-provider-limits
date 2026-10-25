import GLib from "gi://GLib";

import { GETTEXT_DOMAIN } from "../constants.js";
import { parseCatalog } from "./catalog.js";

let catalog = new Map<string, string>();

export function configureTranslations(extensionPath: string, language: string): void {
  catalog = new Map();
  const languages = language.trim() ? [language.trim()] : GLib.get_language_names();
  for (const candidate of languages) {
    if (!/^[A-Za-z0-9_@.-]+$/.test(candidate)) continue;
    const code = candidate.split(".")[0];
    try {
      const [, bytes] = GLib.file_get_contents(
        GLib.build_filenamev([
          extensionPath,
          "locale",
          code,
          "LC_MESSAGES",
          `${GETTEXT_DOMAIN}.mo`,
        ]),
      );
      catalog = parseCatalog(bytes);
      return;
    } catch {
      // Follow GLib's language preference list; absent catalogs use source strings.
    }
  }
}

export function gettext(text: string): string {
  return catalog.get(text) || text;
}
