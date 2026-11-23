import type { DisplayModelDerivationInput } from "../../src/ui/displayModel.js";
import { deriveDisplayModels } from "../../src/ui/displayModel.js";
import type { ProviderViewContext, ViewPhase } from "../../src/ui/viewContext.js";

/** Derivation inputs plus a phase, kept out of the public ProviderViewContext. */
export interface ViewFixtureInput extends DisplayModelDerivationInput {
  readonly phase: ViewPhase;
}

/** Assemble the narrow context the renderers actually consume. */
export function viewContextFromFixture(input: ViewFixtureInput): ProviderViewContext {
  return {
    phase: input.phase,
    activeProviders: input.activeProviders,
    results: input.results,
    displayNames: input.displayNames,
    models: deriveDisplayModels(input),
    locale: input.locale,
    t: input.t,
  };
}
