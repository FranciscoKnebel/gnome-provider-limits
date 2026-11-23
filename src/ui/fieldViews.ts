import type { ProviderName } from "../constants.js";
import { formatAbsoluteTimestamp, formatField } from "../formatters.js";
import type { FieldDef, FieldResult, FieldType, FieldZone, ReaderResult } from "../readers/base.js";
import { FieldStatus, ReaderStatus } from "../readers/base.js";
import type { FieldCategory } from "../readers/fields.js";
import type { FieldRow, FieldTone } from "./fieldRows.js";
import { fieldTone, getFieldRows } from "./fieldRows.js";
import type {
  Presentation,
  ProviderAttention,
  ProviderHealth,
  ProviderState,
  ProviderTone,
} from "./providerTypes.js";
import { PRESENTATION } from "./providerTypes.js";
import { structureKey } from "./renderStructure.js";
import { clampFillRatio, extractWindowSuffix } from "./usageSnapshot.js";
import type { ProviderViewContext } from "./viewContext.js";

export interface FieldView {
  readonly name: string;
  readonly type: FieldType;
  readonly category: FieldCategory;
  readonly label: string;
  readonly value: unknown;
  readonly valueText: string;
  readonly accessibleText: string;
  readonly tone?: FieldTone;
  readonly errorText?: string;
  readonly ratio: number | null;
  readonly usageRatio: number | null;
  readonly fillPercent?: number;
  readonly hasValue: boolean;
  readonly resetName: string | null;
  readonly resetText: string | null;
  readonly hasResetSlot: boolean;
}

const TONE_SEVERITY: Record<FieldTone, number> = {
  ok: 1,
  warning: 2,
  critical: 3,
};

export function worstFieldTone(tones: readonly (FieldTone | undefined)[]): FieldTone | undefined {
  let worst: FieldTone | undefined;
  for (const candidate of tones) {
    if (candidate && (!worst || TONE_SEVERITY[candidate] > TONE_SEVERITY[worst])) {
      worst = candidate;
    }
  }
  return worst;
}

export function isLimitReached(fields: readonly FieldResult[] | undefined): boolean {
  const field = fields?.find((candidate) => candidate.name === "limit_reached");
  return field?.status === FieldStatus.OK && field.value === true;
}

export function collectFieldTones(
  rows: readonly FieldRow[],
  fields?: readonly FieldResult[],
  fieldDefs?: readonly FieldDef[],
): (FieldTone | undefined)[] {
  const tones: (FieldTone | undefined)[] = rows.map((row) => row.tone);
  if (fields && fieldDefs) {
    for (const def of fieldDefs) {
      if (def.type !== "percent") continue;
      const field = fields.find((candidate) => candidate.name === def.name);
      if (field?.status === FieldStatus.OK) tones.push(fieldTone(def.name, field.value));
    }
  }
  if (isLimitReached(fields)) tones.push("critical");
  return tones;
}

function usedPercentOf(fieldName: string, value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return fieldName.startsWith("remaining_percent") ? 100 - value : value;
}

export function deriveFieldViews(
  defs: readonly FieldDef[],
  result: ReaderResult,
  fieldNames: readonly string[],
  zone: FieldZone,
  locale: string,
  t?: (s: string) => string,
): FieldView[] {
  const rows = getFieldRows(defs, result, fieldNames, zone, locale, t);
  const tr = t ?? ((s: string) => s);
  const limitReached = isLimitReached(result.fields);

  const activeSuffixes = new Set<string>();
  for (const row of rows) {
    if (row.type !== "percent" || !row.name) continue;
    const suffix = extractWindowSuffix(row.name);
    if (suffix !== null) activeSuffixes.add(suffix);
  }

  const pairedResets = new Set<string>();
  for (const row of rows) {
    if (!row.name?.startsWith("reset_at_") || row.type !== "timestamp") continue;
    const suffix = row.name.slice("reset_at_".length);
    if (activeSuffixes.has(suffix)) pairedResets.add(row.name);
  }

  return rows.map((row) => {
    const name = row.name ?? row.label;
    const def = defs.find((candidate) => candidate.name === name);
    const type = row.type ?? def?.type ?? "text";
    const category = row.category ?? def?.category ?? "limit";
    const resetName = row.companionResetName ?? def?.resetField ?? null;
    const field = result.fields.find((candidate) => candidate.name === name);

    let resetText: string | null = null;
    let hasResetSlot = false;
    if (
      resetName !== null &&
      defs.some((candidate) => candidate.name === resetName && candidate.type === "timestamp")
    ) {
      const resetField = result.fields.find((candidate) => candidate.name === resetName);
      if (
        resetField?.status === FieldStatus.OK &&
        resetField.value !== null &&
        resetField.value !== undefined
      ) {
        resetText = `↻ ${formatField({ type: "timestamp", value: resetField.value, zone, locale, t: tr })}`;
        hasResetSlot = true;
      } else if (pairedResets.has(resetName)) {
        resetText = "↻ —";
        hasResetSlot = true;
      }
    }

    const usedPercent = type === "percent" ? usedPercentOf(name, field?.value) : null;
    let usageRatio = usedPercent === null ? null : clampFillRatio(usedPercent / 100);
    if (limitReached && type === "percent") {
      usageRatio = usageRatio === null ? 1 : Math.max(usageRatio, 1);
    }
    const tone =
      limitReached && (name === "limit_reached" || type === "percent") ? "critical" : row.tone;
    return {
      name,
      type,
      category,
      label: row.label,
      value: field?.value ?? null,
      valueText: row.valueText,
      accessibleText: row.accessibleText ?? `${tr(row.label)}: ${row.valueText}`,
      ratio: row.fillPercent === undefined ? null : clampFillRatio(row.fillPercent / 100),
      usageRatio,
      hasValue: row.valueText !== "—",
      resetName,
      resetText,
      hasResetSlot,
      ...(row.fillPercent !== undefined ? { fillPercent: row.fillPercent } : {}),
      ...(tone ? { tone } : {}),
      ...(row.errorText ? { errorText: row.errorText } : {}),
    };
  });
}

export interface UsageViewSelection {
  readonly limitOnly?: boolean;
  readonly requireFiniteValue?: boolean;
}

export function selectUsageView(
  views: readonly FieldView[],
  preferredNames: readonly string[],
  options: UsageViewSelection = {},
): FieldView | undefined {
  const candidates = views.filter(
    (view) => view.type === "percent" && (!options.limitOnly || view.category === "limit"),
  );
  const isUsable = (view: FieldView): boolean => !options.requireFiniteValue || view.hasValue;
  for (const name of preferredNames) {
    const view = candidates.find((candidate) => candidate.name === name);
    if (view && isUsable(view)) return view;
  }
  return candidates.find(isUsable);
}

export interface UsageFacts {
  readonly valueText: string;
  readonly fillRatio: number | null;
  readonly tone: FieldTone | "error" | undefined;
  readonly resetText: string | null;
  readonly summaryText: string;
}

export interface UsageProjectionOptions extends UsageViewSelection {
  readonly t?: (s: string) => string;
}

export function projectUsageFacts(
  result: ReaderResult,
  views: readonly FieldView[],
  preferredFieldNames: readonly string[],
  options: UsageProjectionOptions = {},
): UsageFacts {
  const tr = options.t ?? ((s: string) => s);
  if (result.status === ReaderStatus.ERROR || result.status === ReaderStatus.UNAVAILABLE) {
    return {
      valueText: "—",
      fillRatio: null,
      tone: "error",
      resetText: null,
      summaryText: result.status === ReaderStatus.ERROR ? tr("Error") : tr("(unavailable)"),
    };
  }

  const primary = selectUsageView(views, preferredFieldNames, options);
  const tokens: string[] = [];
  for (const name of preferredFieldNames) {
    const view = views.find((candidate) => candidate.name === name);
    if (view?.hasValue) tokens.push(view.valueText);
  }
  if (tokens.length === 0) {
    if (primary?.hasValue) tokens.push(primary.valueText);
    const resetView = views.find(
      (candidate) =>
        candidate.type === "timestamp" && candidate.category === "limit" && candidate.hasValue,
    );
    if (resetView) tokens.push(resetView.valueText);
  }

  return {
    valueText: primary?.valueText ?? "—",
    fillRatio: primary?.usageRatio ?? null,
    tone: primary?.tone,
    resetText: primary?.resetText ?? null,
    summaryText: tokens.length > 0 ? tokens.join(" · ") : "—",
  };
}

export function isLastKnownGood(result: ReaderResult): boolean {
  return (
    result.status === ReaderStatus.PARTIAL &&
    (result.pathsTried?.includes("last-known-good") ?? false)
  );
}

export interface DeriveHealthOptions {
  readonly tones?: readonly (FieldTone | undefined)[];
  readonly result?: ReaderResult;
  readonly views?: readonly FieldView[];
  readonly fieldDefs?: readonly FieldDef[];
  readonly t?: (s: string) => string;
  readonly hasUsableField?: boolean;
  readonly lastKnownGood?: boolean;
}

function deriveState(
  status: ReaderStatus,
  worstTone: FieldTone | undefined,
  hasUsableField: boolean,
  lastKnownGood: boolean,
): ProviderState {
  if (status === ReaderStatus.ERROR) return "error";
  if (status === ReaderStatus.UNAVAILABLE) return "unavailable";
  if (status === ReaderStatus.DISABLED) return "idle";
  if (status === ReaderStatus.PARTIAL && worstTone !== "critical") {
    return lastKnownGood ? "cached" : "partial";
  }
  if (worstTone === "warning" || worstTone === "critical" || hasUsableField) return "ok";
  return "idle";
}

function deriveTone(state: ProviderState, worstTone: FieldTone | undefined): ProviderTone {
  if (state === "error" || state === "unavailable") return "error";
  if (state === "idle") return "idle";
  if (state === "partial" || state === "cached") return "partial";
  return worstTone === "warning" || worstTone === "critical" ? worstTone : "ok";
}

function deriveAttention(
  state: ProviderState,
  worstTone: FieldTone | undefined,
): ProviderAttention {
  if (state === "error" || state === "unavailable") return "error";
  if (state === "idle") return "quiet";
  if (state === "partial" || state === "cached") {
    return worstTone === "warning" ? "warning" : "partial";
  }
  return worstTone === "warning" || worstTone === "critical" ? worstTone : "quiet";
}

function localizedStateText(
  status: ReaderStatus,
  tr: (s: string) => string,
): { stateTag: string | null; stateAccessibleText: string | null } {
  if (status === ReaderStatus.ERROR) {
    const tag = tr("(error)");
    return { stateTag: tag, stateAccessibleText: tag };
  }
  if (status === ReaderStatus.UNAVAILABLE) {
    const tag = tr("(unavailable)");
    return { stateTag: tag, stateAccessibleText: tag };
  }
  if (status === ReaderStatus.PARTIAL) {
    return { stateTag: "~", stateAccessibleText: tr("Cached") };
  }
  return { stateTag: null, stateAccessibleText: null };
}

export function deriveProviderHealth(
  status: ReaderStatus,
  options: DeriveHealthOptions = {},
): ProviderHealth {
  const tr = options.t ?? ((s: string) => s);
  const { result, views, fieldDefs } = options;
  const tones =
    options.tones ?? (result && views ? collectFieldTones(views, result.fields, fieldDefs) : []);
  const worstTone = worstFieldTone(tones);
  const hasUsableField =
    options.hasUsableField ??
    (result && views
      ? views.some((view) => view.hasValue) ||
        result.fields.some((field) => field.status === FieldStatus.OK)
      : false);
  const lastKnownGood = options.lastKnownGood ?? (result ? isLastKnownGood(result) : false);
  const state = deriveState(status, worstTone, hasUsableField, lastKnownGood);
  const stateText = localizedStateText(status, tr);

  return {
    state,
    tone: deriveTone(state, worstTone),
    attention: deriveAttention(state, worstTone),
    worstTone,
    hasUsableField,
    lastKnownGood,
    ...stateText,
  };
}

export type BadgeZone = "card" | "overview" | "status";

export function badgeForZone(health: ProviderHealth, zone: "card"): Presentation["cardBadge"];
export function badgeForZone(
  health: ProviderHealth,
  zone: "overview",
): Presentation["overviewBadge"];
export function badgeForZone(health: ProviderHealth, zone: "status"): string;
export function badgeForZone(health: ProviderHealth, zone: BadgeZone): string {
  const presentation = PRESENTATION[health.state];
  if (zone === "card") return presentation.cardBadge;
  if (zone === "overview") return presentation.overviewBadge;
  return presentation.statusTag;
}

export function cardBadgeText(health: ProviderHealth, t: (s: string) => string): string {
  return t(PRESENTATION[health.state].label.card);
}

export function overviewBadgeText(health: ProviderHealth, t: (s: string) => string): string {
  return t(PRESENTATION[health.state].label.overview);
}

export function statusBadgeText(health: ProviderHealth, t: (s: string) => string): string {
  const tag = PRESENTATION[health.state].statusTag;
  return tag ? t(tag) : "";
}

export interface StatusBarProviderSegment {
  readonly provider: ProviderName;
  readonly displayName: string;
  readonly result: ReaderResult;
  readonly fieldDefs: readonly FieldDef[];
  readonly statusFields: readonly string[];
  readonly views: readonly FieldView[];
  readonly health: ProviderHealth;
}

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
  readonly state: ProviderState;
  readonly tone: ProviderTone;
  readonly attention: ProviderAttention;
  readonly worstTone: FieldTone | undefined;
  readonly hasUsableField: boolean;
  readonly lastKnownGood: boolean;
  readonly stateTag: string | null;
  readonly stateAccessibleText: string | null;
  readonly badges: DisplayBadges;
  readonly statusViews: readonly FieldView[];
  readonly panelViews: readonly FieldView[];
  readonly headerViews: readonly FieldView[];
  readonly groupedViews: ProviderDisplayViews;
  readonly resetPairs: ReadonlyMap<string, FieldView>;
  readonly consumedResets: ReadonlySet<string>;
  readonly usage: ProviderDisplayUsage;
  readonly summaryText: string;
  readonly lastUpdatedText: string | null;
  readonly diagnostic: DisplayDiagnostic;
  readonly structureKey: string;
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

function modelStructureKey(
  context: ProviderViewContext,
  model: Omit<ProviderDisplayModel, "structureKey">,
  statusFields: readonly string[],
  panelFields: readonly string[],
): string {
  const parts: string[] = [
    model.provider,
    model.displayName,
    model.shortDisplayName,
    model.status,
    context.locale,
    model.badges.card,
    model.badges.cardText,
    model.badges.overview,
    model.badges.overviewText,
    model.badges.status ? "1" : "0",
    model.diagnostic.bannerKind ?? "",
    model.diagnostic.errorText !== null ? "1" : "0",
    model.diagnostic.detailText !== null ? "1" : "0",
    model.lastUpdatedText === null ? "0" : "1",
    statusFields.join(","),
    panelFields.join(","),
    ...model.statusViews.map((view) => [view.name, view.type, view.category].join(":")),
    ...model.panelViews.map((view) =>
      [
        view.name,
        view.type,
        view.category,
        view.resetName ?? "",
        view.hasResetSlot ? "1" : "0",
        view.errorText ? "1" : "0",
        view.resetText ? "1" : "0",
      ].join(":"),
    ),
  ];
  return structureKey(parts);
}

export function deriveDisplayModels(context: ProviderViewContext): ProviderDisplayModel[] {
  const models: ProviderDisplayModel[] = [];

  for (const provider of context.activeProviders) {
    const result = context.results.get(provider);
    if (!result || result.status === ReaderStatus.DISABLED) continue;

    const fieldDefs = context.fieldDefs[provider];
    const statusFields = context.statusFields[provider] ?? [];
    const panelFields = context.panelFields[provider] ?? [];
    const isHardError =
      result.status === ReaderStatus.ERROR || result.status === ReaderStatus.UNAVAILABLE;

    const statusViews = isHardError
      ? []
      : deriveFieldViews(fieldDefs, result, statusFields, "status", context.locale, context.t);
    const panelViews = isHardError
      ? []
      : deriveFieldViews(fieldDefs, result, panelFields, "panel", context.locale, context.t);
    const headerViews = isHardError
      ? []
      : deriveFieldViews(
          fieldDefs,
          result,
          [...statusFields, ...panelFields],
          "status",
          context.locale,
          context.t,
        );

    const health = deriveProviderHealth(result.status, {
      result,
      views: headerViews,
      fieldDefs,
      t: context.t,
    });

    const badges: DisplayBadges = {
      card: badgeForZone(health, "card"),
      cardText: cardBadgeText(health, context.t),
      overview: badgeForZone(health, "overview"),
      overviewText: overviewBadgeText(health, context.t),
      status: statusBadgeText(health, context.t),
    };

    const { pairs, consumed } = pairResetViews(panelViews);
    const searchOrder = [...statusFields, ...panelFields];

    const usage: ProviderDisplayUsage = {
      header: projectUsageFacts(result, headerViews, statusFields, {
        limitOnly: true,
        requireFiniteValue: true,
        t: context.t,
      }),
      overview: projectUsageFacts(result, headerViews, searchOrder, { t: context.t }),
    };

    let bannerKind: DisplayBannerKind | null = null;
    let bannerText: string | null = null;
    if (result.status === ReaderStatus.ERROR) {
      bannerKind = "error";
      bannerText = result.lastError ?? context.t("Error");
    } else if (result.status === ReaderStatus.UNAVAILABLE) {
      bannerKind = "error";
      bannerText = result.lastError ?? context.t("Unavailable");
    } else if (result.status === ReaderStatus.PARTIAL && result.lastError) {
      bannerKind = "warning";
      bannerText = result.lastError;
    }

    const lastUpdatedText =
      !isHardError && Number.isFinite(result.lastUpdated)
        ? context
            .t("Last updated: %s")
            .replace("%s", formatAbsoluteTimestamp(result.lastUpdated, context.locale))
        : null;

    const partialModel: Omit<ProviderDisplayModel, "structureKey"> = {
      provider,
      displayName: context.displayNames[provider] ?? provider,
      shortDisplayName: context.shortDisplayNames[provider] ?? provider,
      result,
      status: result.status,
      isHardError,
      state: health.state,
      tone: health.tone,
      attention: health.attention,
      worstTone: health.worstTone,
      hasUsableField: health.hasUsableField,
      lastKnownGood: health.lastKnownGood,
      stateTag: health.stateTag,
      stateAccessibleText: health.stateAccessibleText,
      badges,
      statusViews,
      panelViews,
      headerViews,
      groupedViews: groupViewsByCategory(panelViews),
      resetPairs: pairs,
      consumedResets: consumed,
      usage,
      summaryText: usage.header.summaryText,
      lastUpdatedText,
      diagnostic: {
        bannerKind,
        bannerText,
        errorText: isHardError ? (result.lastError ?? context.t("Error")) : null,
        detailText: result.status === ReaderStatus.PARTIAL ? (result.lastError ?? null) : null,
      },
    };

    models.push({
      ...partialModel,
      structureKey: modelStructureKey(context, partialModel, statusFields, panelFields),
    });
  }

  return models;
}

export function deriveStatusBarSegments(context: ProviderViewContext): StatusBarProviderSegment[] {
  return deriveDisplayModels(context).map((model) => ({
    provider: model.provider,
    displayName: model.shortDisplayName,
    result: model.result,
    fieldDefs: context.fieldDefs[model.provider],
    statusFields: context.statusFields[model.provider] ?? [],
    views: model.statusViews,
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

export type StatusBarZonePlan<TSegment> =
  | { readonly kind: "placeholder"; readonly hasEnabled: boolean; readonly key: string }
  | { readonly kind: "segments"; readonly segments: readonly TSegment[]; readonly key: string };
