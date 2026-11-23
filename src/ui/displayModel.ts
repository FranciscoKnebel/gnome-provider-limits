import type { ProviderName } from "../constants.js";
import { formatAbsoluteTimestamp } from "../formatters.js";
import type { FieldDef, ReaderResult } from "../readers/base.js";
import { isHardError, ReaderStatus } from "../readers/base.js";
import { emptyMeter } from "./cairoDrawing.js";
import type { FieldView, UsageFacts } from "./fieldViews.js";
import { deriveFieldViews, meterFromViews, projectUsageFacts, selectViews } from "./fieldViews.js";
import type { GaugeSpec } from "./gaugeTypes.js";
import type { ProviderHealth } from "./providerHealth.js";
import type { Presentation } from "./providerHealth.js";
import {
  cardBadgeText,
  deriveProviderHealth,
  overviewBadgeText,
  PRESENTATION,
  statusBadgeText,
} from "./providerHealth.js";
import {
  consumedResetNames,
  deriveResetPairings,
  resetSlotText,
  type ResetPairing,
} from "./resetModel.js";

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

/** Identity, derived view sets and their eagerly computed presentational facts. */
export interface ProviderDisplayModel {
  readonly provider: ProviderName;
  readonly displayName: string;
  readonly shortDisplayName: string;
  readonly result: ReaderResult;
  readonly status: ReaderStatus;
  readonly statusViews: readonly FieldView[];
  readonly panelViews: readonly FieldView[];
  readonly resets: ReadonlyMap<string, ResetPairing>;
  readonly facts: ProviderDisplayFacts;
}

/** Surface-agnostic presentational facts, computed once with the model. */
export interface ProviderDisplayFacts {
  readonly health: ProviderHealth;
  readonly badges: DisplayBadges;
  readonly usage: ProviderDisplayUsage;
  readonly meter: GaugeSpec;
  readonly diagnostic: DisplayDiagnostic;
  readonly callout: DisplayCallout | null;
  readonly views: ClassifiedPanelViews;
  readonly viewsIncludingConsumedResets: ClassifiedPanelViews;
  readonly lastUpdatedText: string | null;
  readonly isHardError: boolean;
}

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

function classifyPanelViews(
  panelViews: readonly FieldView[],
  resets: ReadonlyMap<string, ResetPairing>,
  includeConsumedResets: boolean,
): ClassifiedPanelViews {
  const consumed = consumedResetNames(resets);
  const limit: MutableClassifiedGroup = { all: [], progress: [], keyValue: [] };
  const telemetry: MutableClassifiedGroup = { all: [], progress: [], keyValue: [] };
  const all: FieldView[] = [];
  const progress: FieldView[] = [];
  const keyValue: FieldView[] = [];
  for (const view of panelViews) {
    if (!includeConsumedResets && consumed.has(view.name)) continue;
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
  hardError: boolean,
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
  if (hardError) {
    callout = { kind: "error", badge: tr("Error"), text: result.lastError ?? tr("Error") };
  } else if (result.status === ReaderStatus.PARTIAL && result.lastError) {
    callout = {
      kind: "warning",
      badge: result.fromCache ? tr("Cached") : tr("Partial"),
      text: result.lastError,
    };
  }

  return {
    diagnostic: {
      bannerKind,
      bannerText,
      errorText: hardError ? (result.lastError ?? tr("Error")) : null,
      detailText: result.status === ReaderStatus.PARTIAL ? (result.lastError ?? null) : null,
    },
    callout,
  };
}

function deriveDisplayFacts(
  model: Omit<ProviderDisplayModel, "facts">,
  derivation: DisplayModelOptions & {
    readonly views: readonly FieldView[];
    readonly hardError: boolean;
  },
): ProviderDisplayFacts {
  const { result } = model;
  const { fieldDefs, statusFields, locale, t: tr, views: allViews, hardError } = derivation;

  const resetTextFor = (view: FieldView): string | null => {
    const pairing = model.resets.get(view.name);
    return pairing ? resetSlotText(pairing, "status", locale, tr) : null;
  };

  const health = deriveProviderHealth(result.status, { result, views: allViews, fieldDefs, t: tr });
  const presentation = PRESENTATION[health.state];
  const badges: DisplayBadges = {
    card: presentation.cardBadge,
    cardText: cardBadgeText(health, tr),
    overview: presentation.overviewBadge,
    overviewText: overviewBadgeText(health, tr),
    status: statusBadgeText(health, tr),
  };

  const usage: ProviderDisplayUsage = {
    header: projectUsageFacts(result, allViews, statusFields, {
      limitOnly: true,
      requireFiniteValue: true,
      t: tr,
      resetTextFor,
    }),
    overview: projectUsageFacts(
      result,
      allViews,
      [...new Set([...statusFields, ...derivation.panelFields])],
      { t: tr, resetTextFor },
    ),
  };

  const { diagnostic, callout } = deriveDiagnostics(result, hardError, tr);
  const views = classifyPanelViews(model.panelViews, model.resets, false);
  const viewsIncludingConsumedResets = classifyPanelViews(model.panelViews, model.resets, true);
  const lastUpdatedText =
    !hardError && Number.isFinite(result.lastUpdated)
      ? tr("Last updated: %s").replace("%s", formatAbsoluteTimestamp(result.lastUpdated, locale))
      : null;

  return {
    health,
    badges,
    usage,
    meter: hardError
      ? emptyMeter("critical", true)
      : meterFromViews([...model.statusViews, ...model.panelViews]),
    diagnostic,
    callout,
    views,
    viewsIncludingConsumedResets,
    lastUpdatedText,
    isHardError: hardError,
  };
}

/** Assemble one provider's display envelope from explicit options, no fake context. */
export function deriveDisplayModel(
  provider: ProviderName,
  result: ReaderResult,
  options: DisplayModelOptions,
): ProviderDisplayModel | undefined {
  if (result.status === ReaderStatus.DISABLED) return undefined;

  const { fieldDefs, statusFields, panelFields, locale, t: tr } = options;
  const hardError = isHardError(result);
  const searchOrder = [...new Set([...statusFields, ...panelFields])];
  const viewOptions = { zone: "status" as const, locale, t: tr };
  const allViews = hardError ? [] : deriveFieldViews(fieldDefs, result, searchOrder, viewOptions);
  const panelSource = hardError
    ? []
    : deriveFieldViews(fieldDefs, result, searchOrder, { ...viewOptions, zone: "panel" as const });
  const statusViews = selectViews(allViews, statusFields);
  const panelViews = selectViews(panelSource, panelFields);
  const resets = deriveResetPairings(fieldDefs, result, allViews, searchOrder, panelFields);

  const modelBase = {
    provider,
    displayName: options.displayName,
    shortDisplayName: options.shortDisplayName,
    result,
    status: result.status,
    statusViews,
    panelViews,
    resets,
  };
  const facts = deriveDisplayFacts(modelBase, { ...options, views: allViews, hardError });
  return { ...modelBase, facts };
}
