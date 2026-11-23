import type { ProviderName } from "../constants.js";
import { formatAbsoluteTimestamp } from "../formatters.js";
import type { FieldDef, ReaderResult } from "../readers/base.js";
import { ReaderStatus } from "../readers/base.js";
import { GAUGE_START_ANGLE, TONE_RGB } from "./cairoDrawing.js";
import type { FieldView, UsageFacts } from "./fieldViews.js";
import { deriveFieldViews, meterFromViews, projectUsageFacts } from "./fieldViews.js";
import type { MicroMeterSpec } from "./gaugeTypes.js";
import type { ProviderHealth } from "./providerHealth.js";
import type { Presentation } from "./providerHealth.js";
import {
  badgeForZone,
  cardBadgeText,
  deriveProviderHealth,
  overviewBadgeText,
  statusBadgeText,
} from "./providerHealth.js";
import type { ProviderViewContext } from "./viewContext.js";

export type DisplayBannerKind = "warning" | "error";

export interface DisplayDiagnostic {
  readonly bannerKind: DisplayBannerKind | null;
  readonly bannerText: string | null;
  readonly errorText: string | null;
  readonly detailText: string | null;
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

export interface ProviderDisplayViews {
  readonly limit: readonly FieldView[];
  readonly telemetry: readonly FieldView[];
}

export interface ProviderDisplayModel {
  readonly provider: ProviderName;
  readonly displayName: string;
  readonly shortDisplayName: string;
  readonly result: ReaderResult;
  readonly status: ReaderStatus;
  readonly isHardError: boolean;
  readonly health: ProviderHealth;
  readonly badges: DisplayBadges;
  readonly statusViews: readonly FieldView[];
  readonly panelViews: readonly FieldView[];
  readonly headerViews: readonly FieldView[];
  readonly meter: MicroMeterSpec;
  readonly groupedViews: ProviderDisplayViews;
  readonly resetPairs: ReadonlyMap<string, FieldView>;
  readonly consumedResets: ReadonlySet<string>;
  readonly usage: ProviderDisplayUsage;
  readonly summaryText: string;
  readonly lastUpdatedText: string | null;
  readonly diagnostic: DisplayDiagnostic;
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

function errorMicroMeter(): MicroMeterSpec {
  return {
    ratio: 0,
    hasValue: false,
    startAngle: GAUGE_START_ANGLE,
    endAngle: GAUGE_START_ANGLE,
    tone: "critical",
    rgb: TONE_RGB.critical,
    isError: true,
  };
}

function groupViewsByCategory(views: readonly FieldView[]): ProviderDisplayViews {
  const limit: FieldView[] = [];
  const telemetry: FieldView[] = [];
  for (const view of views) {
    if (view.category === "telemetry") telemetry.push(view);
    else limit.push(view);
  }
  return { limit, telemetry };
}

function pairResetViews(views: readonly FieldView[]): {
  pairs: Map<string, FieldView>;
  consumed: Set<string>;
} {
  const byName = new Map<string, FieldView>();
  for (const view of views) byName.set(view.name, view);

  const pairs = new Map<string, FieldView>();
  const consumed = new Set<string>();
  for (const view of views) {
    if (view.type !== "percent" || view.resetName === null) continue;
    if (consumed.has(view.resetName)) continue;
    const reset = byName.get(view.resetName);
    if (!reset) continue;
    pairs.set(view.name, reset);
    consumed.add(view.resetName);
  }
  return { pairs, consumed };
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

  const statusViews = isHardError
    ? []
    : deriveFieldViews(fieldDefs, result, statusFields, "status", locale, tr);
  const panelViews = isHardError
    ? []
    : deriveFieldViews(fieldDefs, result, panelFields, "panel", locale, tr);
  const headerViews = isHardError
    ? []
    : deriveFieldViews(fieldDefs, result, [...statusFields, ...panelFields], "status", locale, tr);

  const health = deriveProviderHealth(result.status, {
    result,
    views: headerViews,
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

  const { pairs, consumed } = pairResetViews(panelViews);
  const searchOrder = [...statusFields, ...panelFields];

  const usage: ProviderDisplayUsage = {
    header: projectUsageFacts(result, headerViews, statusFields, {
      limitOnly: true,
      requireFiniteValue: true,
      t: tr,
    }),
    overview: projectUsageFacts(result, headerViews, searchOrder, { t: tr }),
  };

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

  const lastUpdatedText =
    !isHardError && Number.isFinite(result.lastUpdated)
      ? tr("Last updated: %s").replace("%s", formatAbsoluteTimestamp(result.lastUpdated, locale))
      : null;

  const model: ProviderDisplayModel = {
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
    headerViews,
    meter: isHardError ? errorMicroMeter() : meterFromViews([...statusViews, ...panelViews]),
    groupedViews: groupViewsByCategory(panelViews),
    resetPairs: pairs,
    consumedResets: consumed,
    usage,
    summaryText: usage.header.summaryText,
    lastUpdatedText,
    diagnostic: {
      bannerKind,
      bannerText,
      errorText: isHardError ? (result.lastError ?? tr("Error")) : null,
      detailText: result.status === ReaderStatus.PARTIAL ? (result.lastError ?? null) : null,
    },
  };

  return model;
}

/** Thin loop over the active results, delegating all assembly to deriveDisplayModel. */
export function deriveDisplayModels(context: ProviderViewContext): ProviderDisplayModel[] {
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
