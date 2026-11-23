import type { ProviderName } from "../constants.js";
import type { FieldDef, ReaderResult } from "../readers/base.js";
import { deriveDisplayModels } from "./displayModel.js";
import type { FieldView } from "./fieldViews.js";
import type { MicroMeterSpec } from "./gaugeTypes.js";
import type { ProviderHealth } from "./providerHealth.js";
import type { ProviderViewContext, ViewPhase } from "./viewContext.js";

export interface StatusBarProviderSegment {
  readonly provider: ProviderName;
  readonly displayName: string;
  readonly result: ReaderResult;
  readonly fieldDefs: readonly FieldDef[];
  readonly statusFields: readonly string[];
  readonly views: readonly FieldView[];
  readonly meter: MicroMeterSpec;
  readonly health: ProviderHealth;
}

export type StatusBarZonePlan<TSegment> =
  | {
      readonly kind: "placeholder";
      readonly phase: ViewPhase;
      readonly placeholder: string;
      readonly placeholderAccessibleText: string;
      readonly showPlaceholder: boolean;
      readonly key: string;
    }
  | { readonly kind: "segments"; readonly segments: readonly TSegment[]; readonly key: string };

export function deriveStatusBarSegments(context: ProviderViewContext): StatusBarProviderSegment[] {
  return deriveDisplayModels(context).map((model) => ({
    provider: model.provider,
    displayName: model.shortDisplayName,
    result: model.result,
    fieldDefs: context.fieldDefs[model.provider],
    statusFields: context.statusFields[model.provider] ?? [],
    views: model.statusViews,
    meter: model.meter,
    health: {
      state: model.state,
      tone: model.tone,
      attention: model.attention,
      worstTone: model.worstTone,
      hasUsableField: model.hasUsableField,
      lastKnownGood: model.lastKnownGood,
      stateTag: model.stateTag,
      stateAccessibleText: model.stateAccessibleText,
    },
  }));
}
