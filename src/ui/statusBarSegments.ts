import type { ProviderName } from "../constants.js";
import type { FieldDef, ReaderResult } from "../readers/base.js";
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

/** The one placeholder shape shared by pills, gauges and compact status bars. */
export interface StatusBarPlaceholderPlan {
  readonly kind: "placeholder";
  readonly phase: ViewPhase;
  readonly placeholder: string | null;
  readonly placeholderAccessibleText: string;
  readonly showPlaceholder: boolean;
}

export type StatusBarZonePlan<TSegment> =
  | StatusBarPlaceholderPlan
  | { readonly kind: "segments"; readonly segments: readonly TSegment[] };

export function deriveStatusBarSegments(context: ProviderViewContext): StatusBarProviderSegment[] {
  return context.models.map((model) => ({
    provider: model.provider,
    displayName: model.shortDisplayName,
    result: model.result,
    fieldDefs: context.fieldDefs[model.provider],
    statusFields: context.statusFields[model.provider],
    views: model.statusViews,
    meter: model.meter,
    health: model.health,
  }));
}
