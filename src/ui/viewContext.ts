import type Gio from "gi://Gio";

import type { ProviderName } from "../constants.js";
import {
  normalizeProvidersOrder,
  providerDisplayName,
  providerDisplayNameShort,
  resolveActiveProviders,
} from "../helpers/provider-settings.js";
import type { BaseReader, FieldDef, ReaderResult } from "../readers/base.js";

export type ViewPhase = "empty" | "loading" | "ready";

/** The one immutable snapshot passed to every plan builder and renderer. */
export interface ProviderViewContext {
  readonly order: readonly ProviderName[];
  readonly results: ReadonlyMap<ProviderName, ReaderResult>;
  readonly fieldDefs: Readonly<Record<ProviderName, readonly FieldDef[]>>;
  readonly activeProviders: readonly ProviderName[];
  readonly displayNames: Readonly<Record<ProviderName, string>>;
  readonly shortDisplayNames: Readonly<Record<ProviderName, string>>;
  readonly statusFields: Readonly<Record<ProviderName, readonly string[]>>;
  readonly panelFields: Readonly<Record<ProviderName, readonly string[]>>;
  readonly locale: string;
  readonly t: (text: string) => string;
  readonly phase: ViewPhase;
}

export function providerRecord<T>(make: (provider: ProviderName) => T): Record<ProviderName, T> {
  return {
    codex: make("codex"),
    claude: make("claude"),
    opencode: make("opencode"),
    grok: make("grok"),
    cursor: make("cursor"),
    google: make("google"),
  };
}

/** Empty when nothing is enabled, loading until results arrive, ready otherwise. */
export function resolveViewPhase(
  activeProviders: readonly ProviderName[],
  results: ReadonlyMap<ProviderName, ReaderResult>,
): ViewPhase {
  if (activeProviders.length === 0) return "empty";
  if (results.size === 0) return "loading";
  return "ready";
}

/** Build the one canonical context from settings, readers and fresh results. */
export function viewContextFor(
  settings: Gio.Settings,
  readers: ReadonlyMap<ProviderName, BaseReader>,
  results: ReadonlyMap<ProviderName, ReaderResult>,
  fieldDefs: Readonly<Record<ProviderName, readonly FieldDef[]>>,
  locale: string,
  t: (text: string) => string,
): ProviderViewContext {
  const order = normalizeProvidersOrder(settings.get_strv("providers-order"));
  const activeProviders = resolveActiveProviders(settings, readers, results);

  return {
    order,
    results,
    fieldDefs,
    activeProviders,
    displayNames: providerRecord((name) => providerDisplayName(settings, name)),
    shortDisplayNames: providerRecord((name) => providerDisplayNameShort(settings, name)),
    statusFields: providerRecord((name) => settings.get_strv(`${name}-status-fields`)),
    panelFields: providerRecord((name) => settings.get_strv(`${name}-panel-fields`)),
    locale,
    t,
    phase: resolveViewPhase(activeProviders, results),
  };
}
