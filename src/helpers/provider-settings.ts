import type Gio from "gi://Gio";

import { DEFAULT_PROVIDERS_ORDER, PROVIDER_NAMES, type ProviderName } from "../constants.js";

export function isProviderName(name: string): name is ProviderName {
  return (PROVIDER_NAMES as readonly string[]).includes(name);
}

export function normalizeProvidersOrder(values: readonly string[]): ProviderName[] {
  const seen = new Set<ProviderName>();
  const normalized: ProviderName[] = [];

  for (const value of values) {
    if (!isProviderName(value) || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }

  for (const name of DEFAULT_PROVIDERS_ORDER) {
    if (seen.has(name)) continue;
    normalized.push(name);
  }

  return normalized;
}

export function providerDisplayName(settings: Gio.Settings, name: ProviderName): string {
  return settings.get_string(`${name}-display-name`) || name;
}

export function providerDisplayNameShort(settings: Gio.Settings, name: ProviderName): string {
  return settings.get_string(`${name}-display-name-short`) || name;
}
