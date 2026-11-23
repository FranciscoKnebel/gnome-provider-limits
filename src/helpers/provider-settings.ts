import type Gio from "gi://Gio";

import { DEFAULT_PROVIDERS_ORDER, PROVIDER_NAMES, type ProviderName } from "../constants.js";
import {
  ReaderStatus,
  type BaseReader,
  type FieldDef,
  type ReaderResult,
} from "../readers/base.js";

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

/**
 * The single definition of "active" used by every panel and status bar path.
 * A fresh result wins over settings, and a reader that is still starting up
 * counts as active until a DISABLED result arrives.
 */
export function resolveActiveProviders(
  settings: Gio.Settings,
  readers: ReadonlyMap<ProviderName, BaseReader>,
  results: ReadonlyMap<ProviderName, ReaderResult>,
): ProviderName[] {
  return normalizeProvidersOrder(settings.get_strv("providers-order")).filter((name) => {
    const result = results.get(name);
    if (result) return result.status !== ReaderStatus.DISABLED;
    return readers.has(name) || settings.get_boolean(`${name}-enabled`);
  });
}

export interface ProviderViewSettings {
  readonly order: readonly ProviderName[];
  readonly results: ReadonlyMap<ProviderName, ReaderResult>;
  readonly fieldDefs: Readonly<Record<ProviderName, readonly FieldDef[]>>;
  readonly activeProviders: readonly ProviderName[];
  readonly hasEnabledProviders: boolean;
  readonly displayNames: Readonly<Record<ProviderName, string>>;
  readonly shortDisplayNames: Readonly<Record<ProviderName, string>>;
  readonly statusFieldNames: Readonly<Record<ProviderName, readonly string[]>>;
  readonly panelFieldNames: Readonly<Record<ProviderName, readonly string[]>>;
  readonly displayName: (provider: ProviderName) => string;
  readonly shortDisplayName: (provider: ProviderName) => string;
  readonly statusFields: (provider: ProviderName) => readonly string[];
  readonly panelFields: (provider: ProviderName) => readonly string[];
  readonly fieldDefsFor: (provider: ProviderName) => readonly FieldDef[];
  readonly isEnabled: (provider: ProviderName) => boolean;
}

function providerRecord<T>(make: (provider: ProviderName) => T): Record<ProviderName, T> {
  const [codex, claude, opencode, grok, cursor, google] = PROVIDER_NAMES;
  return {
    codex: make(codex),
    claude: make(claude),
    opencode: make(opencode),
    grok: make(grok),
    cursor: make(cursor),
    google: make(google),
  };
}

/** Assemble the provider view snapshot once, then pass it to every plan builder. */
export function readProviderViewSettings(
  settings: Gio.Settings,
  readers: ReadonlyMap<ProviderName, BaseReader>,
  results: ReadonlyMap<ProviderName, ReaderResult>,
  fieldDefs: Readonly<Record<ProviderName, readonly FieldDef[]>>,
): ProviderViewSettings {
  const order = normalizeProvidersOrder(settings.get_strv("providers-order"));
  const activeProviders = resolveActiveProviders(settings, readers, results);
  const displayNames = providerRecord((name) => providerDisplayName(settings, name));
  const shortDisplayNames = providerRecord((name) => providerDisplayNameShort(settings, name));
  const statusFieldNames = providerRecord((name) => settings.get_strv(`${name}-status-fields`));
  const panelFieldNames = providerRecord((name) => settings.get_strv(`${name}-panel-fields`));

  return {
    order,
    results,
    fieldDefs,
    activeProviders,
    hasEnabledProviders: activeProviders.length > 0,
    displayNames,
    shortDisplayNames,
    statusFieldNames,
    panelFieldNames,
    displayName: (provider) => displayNames[provider],
    shortDisplayName: (provider) => shortDisplayNames[provider],
    statusFields: (provider) => statusFieldNames[provider],
    panelFields: (provider) => panelFieldNames[provider],
    fieldDefsFor: (provider) => fieldDefs[provider],
    isEnabled: (provider) => activeProviders.includes(provider),
  };
}
