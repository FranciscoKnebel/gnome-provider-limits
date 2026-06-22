/// <reference types="@girs/gjs/ambient" />
/// <reference types="@girs/gnome-shell" />
/// <reference types="@girs/soup-3.0" />
/// <reference types="@girs/st-18" />
/// <reference types="@girs/clutter-18" />
/// <reference types="@girs/adw-1" />
/// <reference types="@girs/gtk-4.0" />
/// <reference types="@girs/gio-2.0" />
/// <reference types="@girs/glib-2.0" />
/// <reference types="@girs/gobject-2.0" />

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
