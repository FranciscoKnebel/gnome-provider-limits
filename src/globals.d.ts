/// <reference types="@girs/gjs/ambient" />
/// <reference types="@girs/gnome-shell/ambient" />
/// <reference types="@girs/gnome-shell/extensions/ambient" />
/// <reference types="@girs/gnome-shell/ui/ambient" />
/// <reference types="@girs/soup-3.0/ambient" />
/// <reference types="@girs/st-18/ambient" />
/// <reference types="@girs/clutter-18/ambient" />
/// <reference types="@girs/adw-1/ambient" />
/// <reference types="@girs/gtk-4.0/ambient" />
/// <reference types="@girs/gio-2.0/ambient" />
/// <reference types="@girs/glib-2.0/ambient" />
/// <reference types="@girs/gobject-2.0/ambient" />

// GJS globals that aren't declared as modules by @girs/gjs
declare const console: {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
};

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

declare class TextDecoder {
  decode(input?: Uint8Array | ArrayBuffer | null): string;
  readonly encoding: string;
}

// GJS built-in gettext module
declare module "gettext" {
  export function bindtextdomain(domain: string, dirname: string): void;
  export function textdomain(domain: string | null): string;
  export function dgettext(domain: string, msgid: string): string;
  export function ngettext(msgid: string, msgid_plural: string, n: number): string;
  export function dcgettext(domain: string, msgid: string, category: number): string;
  export function bind_textdomain_codeset(domain: string, codeset: string | null): string | null;
}
