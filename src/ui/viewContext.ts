import type Gio from "gi://Gio";

import { providerRecord, type ProviderName } from "../constants.js";
import {
  providerDisplayName,
  providerDisplayNameShort,
  resolveActiveProviders,
} from "../helpers/provider-settings.js";
import type { BaseReader, FieldDef, ReaderResult } from "../readers/base.js";
import {
  deriveDisplayModel,
  type DisplayModelOptions,
  type ProviderDisplayModel,
} from "./displayModel.js";

export type ViewPhase = "empty" | "loading" | "ready";

/** The one immutable snapshot passed to every plan builder and renderer. */
export interface ProviderViewContext {
  readonly phase: ViewPhase;
  readonly activeProviders: readonly ProviderName[];
  readonly results: ReadonlyMap<ProviderName, ReaderResult>;
  readonly displayNames: Readonly<Record<ProviderName, string>>;
  readonly models: readonly ProviderDisplayModel[];
  readonly locale: string;
  readonly t: (text: string) => string;
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

const EMPTY_DISPLAY_NAMES: Readonly<Record<ProviderName, string>> = providerRecord(() => "");

/** A genuine empty-phase snapshot for renderers before their first real render. */
export function emptyViewContext(locale: string, t: (text: string) => string): ProviderViewContext {
  return {
    phase: "empty",
    activeProviders: [],
    results: new Map(),
    displayNames: EMPTY_DISPLAY_NAMES,
    models: [],
    locale,
    t,
  };
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
  const activeProviders = resolveActiveProviders(settings, readers, results);
  const displayNames = providerRecord((name) => providerDisplayName(settings, name));
  const phase = resolveViewPhase(activeProviders, results);

  const optionsFor = (provider: ProviderName): DisplayModelOptions => ({
    fieldDefs: fieldDefs[provider],
    statusFields: settings.get_strv(`${provider}-status-fields`),
    panelFields: settings.get_strv(`${provider}-panel-fields`),
    displayName: displayNames[provider],
    shortDisplayName: providerDisplayNameShort(settings, provider),
    locale,
    t,
  });

  const models: ProviderDisplayModel[] = [];
  for (const provider of activeProviders) {
    const result = results.get(provider);
    if (!result) continue;
    const model = deriveDisplayModel(provider, result, optionsFor(provider));
    if (model) models.push(model);
  }

  return { phase, activeProviders, results, displayNames, models, locale, t };
}
