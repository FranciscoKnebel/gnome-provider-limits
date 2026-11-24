import type { ProviderName } from "../constants.js";
import { formatAbsoluteTimestamp } from "../formatters.js";
import type { FieldDef, ReaderResult } from "../readers/base.js";
import { fieldStatusDegrades, isHardError, ReaderStatus } from "../readers/base.js";
import { emptyMeter } from "./cairoDrawing.js";
import type { FieldView, UsageFacts } from "./fieldViews.js";
import { deriveFieldViews, meterFromViews, projectUsageFacts, selectViews } from "./fieldViews.js";
import type { GaugeSpec } from "./gaugeTypes.js";
import type { ProviderHealth } from "./providerHealth.js";
import type { Presentation } from "./providerHealth.js";
import {
  cardBadgeText,
  CACHED_LABEL,
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

export type DiagnosticKind = "error" | "warning" | null;

/** The single diagnostic fact, selected by cards, compact rows and gauge callouts. */
export interface Diagnostic {
  readonly kind: DiagnosticKind;
  readonly text: string | null;
  readonly badge: string | null;
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
  readonly displayStatus: ReaderStatus;
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
  readonly diagnostic: Diagnostic;
  readonly views: ClassifiedPanelViews;
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
  readonly progress: readonly FieldView[];
  readonly keyValue: readonly FieldView[];
}

export interface ClassifiedPanelViews {
  readonly progress: readonly FieldView[];
  readonly keyValue: readonly FieldView[];
  readonly limit: ClassifiedPanelViewGroup;
  readonly telemetry: ClassifiedPanelViewGroup;
}

/** The one panel classification shared by cards, gauges and matrix rows. */
interface MutableClassifiedGroup {
  progress: FieldView[];
  keyValue: FieldView[];
}

function classifyPanelViews(
  panelViews: readonly FieldView[],
  resets: ReadonlyMap<string, ResetPairing>,
): ClassifiedPanelViews {
  const consumed = consumedResetNames(resets);
  const limit: MutableClassifiedGroup = { progress: [], keyValue: [] };
  const telemetry: MutableClassifiedGroup = { progress: [], keyValue: [] };
  const progress: FieldView[] = [];
  const keyValue: FieldView[] = [];
  for (const view of panelViews) {
    if (consumed.has(view.name)) continue;
    const group = view.category === "telemetry" ? telemetry : limit;
    if (view.type === "percent") {
      progress.push(view);
      if (group === limit) group.progress.push(view);
    } else {
      group.keyValue.push(view);
      keyValue.push(view);
    }
  }
  return { progress, keyValue, limit, telemetry };
}

function deriveDiagnostic(
  status: ReaderStatus,
  lastError: string | null,
  fromCache: boolean,
  tr: (s: string) => string,
): Diagnostic {
  if (status === ReaderStatus.ERROR || status === ReaderStatus.UNAVAILABLE) {
    return {
      kind: "error",
      text: lastError ?? tr(status === ReaderStatus.UNAVAILABLE ? "Unavailable" : "Error"),
      badge: tr("Error"),
    };
  }
  if (status === ReaderStatus.PARTIAL && lastError) {
    return {
      kind: "warning",
      text: lastError,
      badge: fromCache ? tr(CACHED_LABEL) : tr("Partial"),
    };
  }
  return { kind: null, text: null, badge: null };
}

/**
 * Message for the compact and gauge error surfaces: lastError falling back to
 * the diagnostic badge. Cards use diagnostic.text directly, preserving the
 * "Unavailable" banner label when an unavailable result has no lastError.
 */
export function diagnosticMessage(result: ReaderResult, diagnostic: Diagnostic): string | null {
  if (diagnostic.kind === null || diagnostic.text === null) return null;
  return diagnostic.kind === "warning" ? diagnostic.text : (result.lastError ?? diagnostic.badge);
}

function deriveDisplayFacts(
  model: Omit<ProviderDisplayModel, "facts">,
  derivation: DisplayModelOptions & { readonly allViews: readonly FieldView[] },
): ProviderDisplayFacts {
  const { result, displayStatus } = model;
  const hardError = isHardError(result);
  const { fieldDefs, statusFields, locale, t: tr, allViews } = derivation;

  const resetTextFor = (view: FieldView): string | null => {
    const pairing = model.resets.get(view.name);
    return pairing ? resetSlotText(pairing, "status", locale, tr) : null;
  };

  const health = deriveProviderHealth({
    result,
    displayStatus,
    views: allViews,
    fieldDefs,
    t: tr,
  });
  const presentation = health.presentation;
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

  const diagnostic = deriveDiagnostic(
    displayStatus,
    result.lastError ?? null,
    result.fromCache,
    tr,
  );
  const views = classifyPanelViews(model.panelViews, model.resets);
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
    views,
    lastUpdatedText,
    isHardError: hardError,
  };
}

function resolveDisplayStatus(result: ReaderResult, views: readonly FieldView[]): ReaderStatus {
  if (result.status !== ReaderStatus.PARTIAL || result.fromCache) {
    return result.status;
  }
  const hasUnavailable = views.some((view) => fieldStatusDegrades(view.status));
  return hasUnavailable ? result.status : ReaderStatus.OK;
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
  const displayStatus = resolveDisplayStatus(result, allViews);

  const modelBase = {
    provider,
    displayName: options.displayName,
    shortDisplayName: options.shortDisplayName,
    result,
    displayStatus,
    statusViews,
    panelViews,
    resets,
  };
  const facts = deriveDisplayFacts(modelBase, { ...options, allViews });
  return { ...modelBase, facts };
}
