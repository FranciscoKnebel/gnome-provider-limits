import type { ProviderName } from "../constants.js";
import { formatAbsoluteTimestamp, formatField } from "../formatters.js";
import type { FieldDef, FieldZone, ReaderResult } from "../readers/base.js";
import { FieldStatus, ReaderStatus } from "../readers/base.js";
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

/** A reset field paired with one percent field, with all display text ready. */
export interface DisplayResetDescriptor {
  readonly text: string;
  readonly errorText: string | null;
  readonly accessibleText: string;
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

/** All derived field rows and their reset pairings for one provider. */
export interface FieldRowSet {
  readonly statusViews: readonly FieldView[];
  readonly panelViews: readonly FieldView[];
  readonly headerViews: readonly FieldView[];
  readonly groupedViews: ProviderDisplayViews;
  readonly resetPairs: ReadonlyMap<string, DisplayResetDescriptor>;
  readonly consumedResets: ReadonlySet<string>;
}

/** Usage facts, meter, diagnostic and human-facing timestamps. */
export interface UsageSummary {
  readonly usage: ProviderDisplayUsage;
  readonly meter: MicroMeterSpec;
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

interface ResetSlot {
  readonly text: string;
  readonly hasSlot: boolean;
}

/** Builds gauge reset slots from explicit FieldDef pairings only. */
function resetSlotsForViews(
  defs: readonly FieldDef[],
  result: ReaderResult,
  views: readonly FieldView[],
  zoneFields: readonly string[],
  zone: FieldZone,
  locale: string,
  tr: (s: string) => string,
): ReadonlyMap<string, ResetSlot> {
  const defByName = new Map(defs.map((def) => [def.name, def]));
  const fieldByName = new Map(result.fields.map((field) => [field.name, field]));
  const slots = new Map<string, ResetSlot>();

  for (const view of views) {
    if (view.type !== "percent" || view.resetName === null) continue;
    if (defByName.get(view.resetName)?.type !== "timestamp") continue;
    const resetField = fieldByName.get(view.resetName);
    if (
      resetField?.status === FieldStatus.OK &&
      resetField.value !== null &&
      resetField.value !== undefined
    ) {
      const text = formatField({ type: "timestamp", value: resetField.value, zone, locale, t: tr });
      slots.set(view.name, { text: `↻ ${text}`, hasSlot: true });
    } else if (zoneFields.includes(view.resetName)) {
      slots.set(view.name, { text: "↻ —", hasSlot: true });
    }
  }
  return slots;
}

function withResetSlots(
  views: readonly FieldView[],
  slots: ReadonlyMap<string, ResetSlot>,
): FieldView[] {
  return views.map((view) => {
    const slot = slots.get(view.name);
    return slot ? { ...view, resetText: slot.text, hasResetSlot: slot.hasSlot } : view;
  });
}

/** Pairs panel percent views with their reset field once, in configured order. */
function pairPanelResets(
  views: readonly FieldView[],
  locale: string,
  tr: (s: string) => string,
): { pairs: Map<string, DisplayResetDescriptor>; consumed: Set<string> } {
  const byName = new Map(views.map((view) => [view.name, view]));
  const pairs = new Map<string, DisplayResetDescriptor>();
  const consumed = new Set<string>();

  for (const view of views) {
    if (view.type !== "percent" || view.resetName === null || !view.hasResetSlot) continue;
    if (consumed.has(view.resetName)) continue;
    const reset = byName.get(view.resetName);
    if (!reset) continue;

    const resetValueText = reset.hasValue
      ? formatField({ type: "timestamp", value: reset.value, zone: "panel", locale, t: tr })
      : reset.valueText;
    const text = `${tr(reset.label)}: ${resetValueText}`;
    pairs.set(view.name, {
      text,
      errorText: view.errorText ?? reset.errorText ?? null,
      accessibleText: `${view.accessibleText}, ${text}`,
    });
    consumed.add(view.resetName);
  }
  return { pairs, consumed };
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

  const searchOrder = [...statusFields, ...panelFields];
  const rawStatusViews = isHardError
    ? []
    : deriveFieldViews(fieldDefs, result, statusFields, "status", locale, tr);
  const rawPanelViews = isHardError
    ? []
    : deriveFieldViews(fieldDefs, result, panelFields, "panel", locale, tr);
  const rawHeaderViews = isHardError
    ? []
    : deriveFieldViews(fieldDefs, result, searchOrder, "status", locale, tr);

  const statusViews = withResetSlots(
    rawStatusViews,
    resetSlotsForViews(fieldDefs, result, rawStatusViews, statusFields, "status", locale, tr),
  );
  const panelViews = withResetSlots(
    rawPanelViews,
    resetSlotsForViews(fieldDefs, result, rawPanelViews, panelFields, "panel", locale, tr),
  );
  const headerViews = withResetSlots(
    rawHeaderViews,
    resetSlotsForViews(fieldDefs, result, rawHeaderViews, searchOrder, "status", locale, tr),
  );

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

  const { pairs, consumed } = pairPanelResets(panelViews, locale, tr);

  const usage: ProviderDisplayUsage = {
    header: projectUsageFacts(result, headerViews, statusFields, {
      limitOnly: true,
      requireFiniteValue: true,
      t: tr,
    }),
    overview: projectUsageFacts(result, headerViews, searchOrder, { t: tr }),
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
    headerViews,
    meter: isHardError ? errorMicroMeter() : meterFromViews([...statusViews, ...panelViews]),
    groupedViews: groupViewsByCategory(panelViews),
    resetPairs: pairs,
    consumedResets: consumed,
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
