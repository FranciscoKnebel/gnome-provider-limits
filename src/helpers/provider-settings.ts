import type Gio from "gi://Gio";

export function providerDisplayName(settings: Gio.Settings, name: string): string {
  return settings.get_string(`${name}-display-name`) || name;
}

export function providerDisplayNameShort(settings: Gio.Settings, name: string): string {
  return settings.get_string(`${name}-display-name-short`) || name;
}
