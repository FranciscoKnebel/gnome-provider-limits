import type { ProviderName } from "../constants.js";
import { formatAbsoluteTimestamp } from "../formatters.js";
import type { FieldDef, ReaderResult } from "../readers/base.js";
import { ReaderStatus } from "../readers/base.js";
import type { FieldCategory } from "../readers/fields.js";
import { emptyMeter } from "./cairoDrawing.js";
import type { FieldView, UsageFacts } from "./fieldViews.js";
import { deriveFieldViews, meterFromViews, projectUsageFacts, selectViews } from "./fieldViews.js";
import type { GaugeSpec } from "./gaugeTypes.js";
import type { ProviderHealth } from "./providerHealth.js";
import type { Presentation, ProviderTone } from "./providerHealth.js";
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
  resetDetailText,
  resetSlotText,
  type ResetPairing,
} from "./resetModel.js";
import { STYLE_REGISTRY } from "./styles.js";
import type { ProviderViewContext, ViewPhase } from "./viewContext.js";
import { phaseResult } from "./viewMessages.js";

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

/** Identity plus the already-derived view sets. Presentational facts live in displayFacts(). */
export interface ProviderDisplayModel {
  readonly provider: ProviderName;
  readonly displayName: string;
  readonly shortDisplayName: string;
  readonly result: ReaderResult;
  readonly status: ReaderStatus;
  readonly statusViews: readonly FieldView[];
  readonly panelViews: readonly FieldView[];
  readonly resets: ReadonlyMap<string, ResetPairing>;
}

/** Derived once per model on first use; never duplicated in plan builders. */
export interface ProviderDisplayFacts {
  readonly health: ProviderHealth;
  readonly badges: DisplayBadges;
  readonly usage: ProviderDisplayUsage;
  readonly meter: GaugeSpec;
  readonly diagnostic: DisplayDiagnostic;
  readonly callout: DisplayCallout | null;
  readonly lastUpdatedText: string | null;
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

interface DisplayDerivation extends DisplayModelOptions {
  readonly views: readonly FieldView[];
}

const DERIVATIONS = new WeakMap<ProviderDisplayModel, DisplayDerivation>();
const FACTS = new WeakMap<ProviderDisplayModel, ProviderDisplayFacts>();

/** Memoized presentational facts for one canonical model. */
export function displayFacts(model: ProviderDisplayModel): ProviderDisplayFacts {
  const cached = FACTS.get(model);
  if (cached) return cached;
  const derivation = DERIVATIONS.get(model);
  if (!derivation) throw new Error("Display facts require a model built by deriveDisplayModel.");
  const facts = deriveDisplayFacts(model, derivation);
  FACTS.set(model, facts);
  return facts;
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

function deriveDisplayFacts(
  model: ProviderDisplayModel,
  derivation: DisplayDerivation,
): ProviderDisplayFacts {
  const { result } = model;
  const { fieldDefs, statusFields, locale, t: tr, views } = derivation;
  const isHardError =
    result.status === ReaderStatus.ERROR || result.status === ReaderStatus.UNAVAILABLE;

  const resetTextFor = (view: FieldView): string | null => {
    const pairing = model.resets.get(view.name);
    return pairing ? resetSlotText(pairing, "status", locale, tr) : null;
  };

  const health = deriveProviderHealth(result.status, { result, views, fieldDefs, t: tr });
  const badges: DisplayBadges = {
    card: badgeForZone(health, "card"),
    cardText: cardBadgeText(health, tr),
    overview: badgeForZone(health, "overview"),
    overviewText: overviewBadgeText(health, tr),
    status: statusBadgeText(health, tr),
  };

  const usage: ProviderDisplayUsage = {
    header: projectUsageFacts(result, views, statusFields, {
      limitOnly: true,
      requireFiniteValue: true,
      t: tr,
      resetTextFor,
    }),
    overview: projectUsageFacts(
      result,
      views,
      [...new Set([...statusFields, ...derivation.panelFields])],
      { t: tr, resetTextFor },
    ),
  };

  const { diagnostic, callout } = deriveDiagnostics(result, isHardError, tr);
  const lastUpdatedText =
    !isHardError && Number.isFinite(result.lastUpdated)
      ? tr("Last updated: %s").replace("%s", formatAbsoluteTimestamp(result.lastUpdated, locale))
      : null;

  return {
    health,
    badges,
    usage,
    meter: isHardError
      ? emptyMeter("critical", true)
      : meterFromViews([...model.statusViews, ...model.panelViews]),
    diagnostic,
    callout,
    lastUpdatedText,
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
  const isHardError =
    result.status === ReaderStatus.ERROR || result.status === ReaderStatus.UNAVAILABLE;
  const searchOrder = [...new Set([...statusFields, ...panelFields])];
  const viewOptions = { zone: "status" as const, locale, t: tr };
  const allViews = isHardError ? [] : deriveFieldViews(fieldDefs, result, searchOrder, viewOptions);
  const panelSource = isHardError
    ? []
    : deriveFieldViews(fieldDefs, result, searchOrder, { ...viewOptions, zone: "panel" as const });
  const statusViews = selectViews(allViews, statusFields);
  const panelViews = selectViews(panelSource, panelFields);
  const resets = deriveResetPairings(fieldDefs, result, allViews, searchOrder, panelFields);

  const model: ProviderDisplayModel = {
    provider,
    displayName: options.displayName,
    shortDisplayName: options.shortDisplayName,
    result,
    status: result.status,
    statusViews,
    panelViews,
    resets,
  };
  DERIVATIONS.set(model, { ...options, views: allViews });
  return model;
}

/** Only the inputs needed to derive the canonical display model set. */
export interface DisplayModelDerivationInput {
  readonly results: ReadonlyMap<ProviderName, ReaderResult>;
  readonly fieldDefs: Readonly<Record<ProviderName, readonly FieldDef[]>>;
  readonly activeProviders: readonly ProviderName[];
  readonly displayNames: Readonly<Record<ProviderName, string>>;
  readonly shortDisplayNames: Readonly<Record<ProviderName, string>>;
  readonly statusFields: Readonly<Record<ProviderName, readonly string[]>>;
  readonly panelFields: Readonly<Record<ProviderName, readonly string[]>>;
  readonly locale: string;
  readonly t: (text: string) => string;
}

/** Thin loop over the active results, delegating all assembly to deriveDisplayModel. */
export function deriveDisplayModels(input: DisplayModelDerivationInput): ProviderDisplayModel[] {
  const models: ProviderDisplayModel[] = [];

  for (const provider of input.activeProviders) {
    const result = input.results.get(provider);
    if (!result) continue;
    const model = deriveDisplayModel(provider, result, {
      fieldDefs: input.fieldDefs[provider],
      statusFields: input.statusFields[provider],
      panelFields: input.panelFields[provider],
      displayName: input.displayNames[provider],
      shortDisplayName: input.shortDisplayNames[provider],
      locale: input.locale,
      t: input.t,
    });
    if (model) models.push(model);
  }

  return models;
}

import type { FieldTone } from "./fieldRows.js";

export type CardBadgeKind = Presentation["cardBadge"];
export type BannerKind = "warning" | "error";

export interface CardProgressRow {
  kind: "progress";
  name: string;
  label: string;
  valueText: string;
  fillPercent: number;
  hasValue: boolean;
  tone?: FieldTone;
  resetText?: string;
  errorText?: string;
  accessibleText: string;
}

export interface CardKeyValueRow {
  kind: "kv";
  name: string;
  category: FieldCategory;
  label: string;
  valueText: string;
  tone?: FieldTone;
  errorText?: string;
  accessibleText: string;
}

export interface ProviderCardPlan {
  provider: ProviderName;
  displayName: string;
  status: ReaderStatus;
  healthTone: ProviderTone;
  badgeKind: CardBadgeKind;
  badgeText: string;
  lastUpdatedText: string | null;
  bannerKind: BannerKind | null;
  bannerText: string | null;
  limitProgressRows: CardProgressRow[];
  limitMetaRows: CardKeyValueRow[];
  telemetryRows: CardKeyValueRow[];
}

export interface PanelPlan {
  phase: ViewPhase;
  emptyTitle: string | null;
  emptySubtitle: string | null;
  cards: ProviderCardPlan[];
}

function keyValueRow(view: FieldView): CardKeyValueRow {
  return {
    kind: "kv",
    name: view.name,
    category: view.category,
    label: view.labelText,
    valueText: view.valueText,
    accessibleText: view.accessibleText,
    ...(view.tone ? { tone: view.tone } : {}),
    ...(view.errorText ? { errorText: view.errorText } : {}),
  };
}

function progressRow(
  view: FieldView,
  pairing: ResetPairing | undefined,
  locale: string,
  t: (s: string) => string,
): CardProgressRow {
  const detail =
    pairing?.inPanel === true && pairing.claimed
      ? resetDetailText(pairing, "panel", locale, t)
      : undefined;
  const errorText = view.errorText ?? (detail ? (pairing?.errorText ?? undefined) : undefined);
  const accessibleText = detail ? `${view.accessibleText}, ${detail}` : view.accessibleText;

  return {
    kind: "progress",
    name: view.name,
    label: view.labelText,
    valueText: view.valueText,
    fillPercent: view.fillPercent ?? 0,
    hasValue: view.fillPercent !== undefined,
    accessibleText,
    ...(view.tone ? { tone: view.tone } : {}),
    ...(detail ? { resetText: detail } : {}),
    ...(errorText ? { errorText } : {}),
  };
}

/** Pure card projection from one canonical model; the only card derivation. */
export function cardFromModel(
  model: ProviderDisplayModel,
  locale: string,
  t: (s: string) => string,
): ProviderCardPlan {
  const groups = classifyPanelViews(model);
  const facts = displayFacts(model);
  const limitProgressRows: CardProgressRow[] = [];
  const limitMetaRows: CardKeyValueRow[] = [];
  const telemetryRows: CardKeyValueRow[] = [];

  for (const view of groups.limit.progress) {
    limitProgressRows.push(progressRow(view, model.resets.get(view.name), locale, t));
  }
  for (const view of groups.limit.keyValue) {
    limitMetaRows.push(keyValueRow(view));
  }
  for (const view of groups.telemetry.keyValue) {
    telemetryRows.push(keyValueRow(view));
  }

  return {
    provider: model.provider,
    displayName: model.displayName,
    status: model.status,
    healthTone: facts.health.tone,
    badgeKind: facts.badges.card,
    badgeText: facts.badges.cardText,
    lastUpdatedText: facts.lastUpdatedText,
    bannerKind: facts.diagnostic.bannerKind,
    bannerText: facts.diagnostic.bannerText,
    limitProgressRows,
    limitMetaRows,
    telemetryRows,
  };
}

export function planPanel(context: ProviderViewContext, running: boolean): PanelPlan {
  const phase = phaseResult(context, STYLE_REGISTRY.panel.cards, running);

  if (phase.kind === "placeholder") {
    return {
      phase: phase.phase,
      emptyTitle: phase.message.title || null,
      emptySubtitle: phase.message.subtitle || null,
      cards: [],
    };
  }

  const cards = context.models.map((model) => cardFromModel(model, context.locale, context.t));

  return {
    phase: "ready",
    emptyTitle: null,
    emptySubtitle: null,
    cards,
  };
}
