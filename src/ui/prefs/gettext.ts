type Translate = (s: string) => string;

let translate: Translate = (s) => s;

try {
  const shell = await import("resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js");
  if (typeof shell.gettext === "function") translate = shell.gettext;
} catch {
  // Running outside GNOME Shell (tests): identity.
}

export function gettext(s: string): string {
  return translate(s);
}
