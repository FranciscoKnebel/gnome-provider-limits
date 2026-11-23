import type { ProviderName } from "../constants.js";
import { formatAbsoluteTimestamp } from "../formatters.js";
import type { FieldDef, ReaderResult } from "../readers/base.js";
import { ReaderStatus } from "../readers/base.js";
import { emptyMeter } from "./cairoDrawing.js";
import type { FieldView, UsageFacts } from "./fieldViews.js";
import { deriveFieldViews, meterFromViews, projectUsageFacts, selectViews } from "./fieldViews.js";
import type { GaugeSpec } from "./gaugeTypes.js";
import type { ProviderHealth } from "./providerHealth.js";
import type { Presentation } from "./providerHealth.js";
import {
  badgeForZone,
  cardBadgeText,
  deriveProviderHealth,
  overviewBadgeText,
  statusBadgeText,
} from "./providerHealth.js";
import {
  consumedResetNames,
  deriveResetPairings,
  resetSlotText,
  type ResetPairing,
} from "./resetModel.js";
import type { ProviderViewContextBase } from "./viewContext.js";

export type DisplayBannerKind = "warning" | "error";

export interface DisplayDiagnostic {
  readonly bannerKind: DisplayBannerKind | null;
  readonly bannerText: string | null;
  readonly errorText: string | null;
  readonly detailText: string | null;
}

/** Callout shown by the panel detail renderer, derived with the diagnostic. */
export interface DisplayCallout {
  readonly kind: "warning" | "error";
  readonly badge: string;
  readonly text: string;
}

export interface DisplayBadges {
  readonly card: Presentation["cardBadge"];
  readonly cardText: string;
  readonly overview: Presentation["overviewBadge"];
  readonly overviewText: string;
  readonly status: string;
}

export interface ProviderDisplayUsage {
  readonly header: UsageFacts;
  readonly overview: UsageFacts;
}

/** Identity and result state, shared by every consumer of a snapshot. */
export interface ProviderIdentityView {
  readonly provider: ProviderName;
  readonly displayName: string;
  readonly shortDisplayName: string;
  readonly result: ReaderResult;
  readonly status: ReaderStatus;
}

/** Health, badges and hard-error classification keyed by identity facts. */
export interface ProviderHealthView extends ProviderIdentityView {
  readonly isHardError: boolean;
  readonly health: ProviderHealth;
  readonly badges: DisplayBadges;
}

/** The one derived view set and its single reset model for one provider. */
export interface FieldRowSet {
  readonly statusViews: readonly FieldView[];
  readonly panelViews: readonly FieldView[];
  readonly resets: ReadonlyMap<string, ResetPairing>;
}

/** Usage facts, meter, diagnostic and human-facing timestamps. */
export interface UsageSummary {
  readonly usage: ProviderDisplayUsage;
  readonly meter: GaugeSpec;
  readonly diagnostic: DisplayDiagnostic;
  readonly callout: DisplayCallout | null;
  readonly lastUpdatedText: string | null;
}

/** Composed snapshot for renderers that genuinely need several slices at once. */
export interface ProviderDisplayModel extends ProviderHealthView, FieldRowSet, UsageSummary {}

/** Everything deriveDisplayModel needs, with no surrounding provider context. */
export interface DisplayModelOptions {
  readonly fieldDefs: readonly FieldDef[];
  readonly statusFields: readonly string[];
  readonly panelFields: readonly string[];
  readonly displayName: string;
  readonly shortDisplayName: string;
  readonly locale: string;
  readonly t: (s: string) => string;
}

export interface ClassifiedPanelViewGroup {
  readonly all: readonly FieldView[];
  readonly progress: readonly FieldView[];
  readonly keyValue: readonly FieldView[];
}

export interface ClassifiedPanelViews {
  readonly all: readonly FieldView[];
  readonly progress: readonly FieldView[];
  readonly keyValue: readonly FieldView[];
  readonly limit: ClassifiedPanelViewGroup;
  readonly telemetry: ClassifiedPanelViewGroup;
}

/** The one panel classification shared by cards, gauges and matrix rows. */
interface MutableClassifiedGroup {
  all: FieldView[];
  progress: FieldView[];
  keyValue: FieldView[];
}

export function classifyPanelViews(
  model: ProviderDisplayModel,
  options: { readonly includeConsumedResets?: boolean } = {},
): ClassifiedPanelViews {
  const consumed = consumedResetNames(model.resets);
  const limit: MutableClassifiedGroup = { all: [], progress: [], keyValue: [] };
  const telemetry: MutableClassifiedGroup = { all: [], progress: [], keyValue: [] };
  const all: FieldView[] = [];
  const progress: FieldView[] = [];
  const keyValue: FieldView[] = [];
  for (const view of model.panelViews) {
    if (!options.includeConsumedResets && consumed.has(view.name)) continue;
    const group = view.category === "telemetry" ? telemetry : limit;
    group.all.push(view);
    all.push(view);
    if (view.type === "percent") {
      group.progress.push(view);
      progress.push(view);
    } else {
      group.keyValue.push(view);
      keyValue.push(view);
    }
  }
  return { all, progress, keyValue, limit, telemetry };
}

function deriveDiagnostics(
  result: ReaderResult,
  isHardError: boolean,
  tr: (s: string) => string,
): { diagnostic: DisplayDiagnostic; callout: DisplayCallout | null } {
  let bannerKind: DisplayBannerKind | null = null;
  let bannerText: string | null = null;
  if (result.status === ReaderStatus.ERROR) {
    bannerKind = "error";
    bannerText = result.lastError ?? tr("Error");
  } else if (result.status === ReaderStatus.UNAVAILABLE) {
    bannerKind = "error";
    bannerText = result.lastError ?? tr("Unavailable");
  } else if (result.status === ReaderStatus.PARTIAL && result.lastError) {
    bannerKind = "warning";
    bannerText = result.lastError;
  }

  let callout: DisplayCallout | null = null;
  if (isHardError) {
    callout = { kind: "error", badge: tr("Error"), text: result.lastError ?? tr("Error") };
  } else if (result.status === ReaderStatus.PARTIAL && result.lastError) {
    callout = {
      kind: "warning",
      badge: result.pathsTried?.includes("last-known-good") ? tr("Cached") : tr("Partial"),
      text: result.lastError,
    };
  }

  return {
    diagnostic: {
      bannerKind,
      bannerText,
      errorText: isHardError ? (result.lastError ?? tr("Error")) : null,
      detailText: result.status === ReaderStatus.PARTIAL ? (result.lastError ?? null) : null,
    },
    callout,
  };
}

/** Assemble one provider's display model from explicit options, no fake context. */
export function deriveDisplayModel(
  provider: ProviderName,
  result: ReaderResult,
  options: DisplayModelOptions,
): ProviderDisplayModel | undefined {
  if (result.status === ReaderStatus.DISABLED) return undefined;

  const { fieldDefs, statusFields, panelFields, locale, t: tr } = options;
  const isHardError =
    result.status === ReaderStatus.ERROR || result.status === ReaderStatus.UNAVAILABLE;

  const searchOrder = [...new Set([...statusFields, ...panelFields])];
  const allViews = isHardError ? [] : deriveFieldViews(fieldDefs, result, searchOrder);
  const statusViews = selectViews(allViews, statusFields);
  const panelViews = selectViews(allViews, panelFields);

  const resets = deriveResetPairings(fieldDefs, result, allViews, searchOrder, panelFields);
  const resetTextFor = (view: FieldView): string | null => {
    const pairing = resets.get(view.name);
    return pairing ? resetSlotText(pairing, "status", locale, tr) : null;
  };

  const health = deriveProviderHealth(result.status, {
    result,
    views: allViews,
    fieldDefs,
    t: tr,
  });

  const badges: DisplayBadges = {
    card: badgeForZone(health, "card"),
    cardText: cardBadgeText(health, tr),
    overview: badgeForZone(health, "overview"),
    overviewText: overviewBadgeText(health, tr),
    status: statusBadgeText(health, tr),
  };

  const usage: ProviderDisplayUsage = {
    header: projectUsageFacts(result, allViews, statusFields, {
      limitOnly: true,
      requireFiniteValue: true,
      zone: "status",
      locale,
      t: tr,
      resetTextFor,
    }),
    overview: projectUsageFacts(result, allViews, searchOrder, {
      zone: "status",
      locale,
      t: tr,
      resetTextFor,
    }),
  };

  const { diagnostic, callout } = deriveDiagnostics(result, isHardError, tr);

  const lastUpdatedText =
    !isHardError && Number.isFinite(result.lastUpdated)
      ? tr("Last updated: %s").replace("%s", formatAbsoluteTimestamp(result.lastUpdated, locale))
      : null;

  return {
    provider,
    displayName: options.displayName,
    shortDisplayName: options.shortDisplayName,
    result,
    status: result.status,
    isHardError,
    health,
    badges,
    statusViews,
    panelViews,
    resets,
    meter: isHardError
      ? emptyMeter("critical", true)
      : meterFromViews([...statusViews, ...panelViews]),
    usage,
    lastUpdatedText,
    diagnostic,
    callout,
  };
}

/** Thin loop over the active results, delegating all assembly to deriveDisplayModel. */
export function deriveDisplayModels(context: ProviderViewContextBase): ProviderDisplayModel[] {
  const models: ProviderDisplayModel[] = [];

  for (const provider of context.activeProviders) {
    const result = context.results.get(provider);
    if (!result) continue;
    const model = deriveDisplayModel(provider, result, {
      fieldDefs: context.fieldDefs[provider],
      statusFields: context.statusFields[provider],
      panelFields: context.panelFields[provider],
      displayName: context.displayNames[provider],
      shortDisplayName: context.shortDisplayNames[provider],
      locale: context.locale,
      t: context.t,
    });
    if (model) models.push(model);
  }

  return models;
}
