import type { ProviderName } from "../../src/constants.js";
import type { FieldDef, ReaderResult } from "../../src/readers/base.js";
import {
  deriveDisplayModel,
  type DisplayModelOptions,
  type ProviderDisplayModel,
} from "../../src/ui/displayModel.js";
import type { ProviderViewContext, ViewPhase } from "../../src/ui/viewContext.js";

/** Derivation inputs plus a phase, kept out of the public ProviderViewContext. */
export interface ViewFixtureInput {
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

/** Assemble the narrow context the renderers actually consume. */
export function viewContextFromFixture(input: ViewFixtureInput): ProviderViewContext {
  const optionsFor = (provider: ProviderName): DisplayModelOptions => ({
    fieldDefs: input.fieldDefs[provider],
    statusFields: input.statusFields[provider],
    panelFields: input.panelFields[provider],
    displayName: input.displayNames[provider],
    shortDisplayName: input.shortDisplayNames[provider],
    locale: input.locale,
    t: input.t,
  });

  const models: ProviderDisplayModel[] = [];
  for (const provider of input.activeProviders) {
    const result = input.results.get(provider);
    if (!result) continue;
    const model = deriveDisplayModel(provider, result, optionsFor(provider));
    if (model) models.push(model);
  }

  return {
    phase: input.phase,
    activeProviders: input.activeProviders,
    results: input.results,
    displayNames: input.displayNames,
    models,
    locale: input.locale,
    t: input.t,
  };
}
