import type { ProviderName } from "../constants.js";
import { formatField } from "../formatters.js";
import type { FieldDef, FieldResult, FieldType, FieldZone, ReaderResult } from "../readers/base.js";
import { FieldStatus, ReaderStatus } from "../readers/base.js";
import type { FieldCategory } from "../readers/fields.js";
import { companionResetFieldName, resolveFieldCategory } from "../readers/fields.js";
import type { FieldRow, FieldTone } from "./fieldRows.js";
import { fieldTone, getFieldRows } from "./fieldRows.js";
import type {
  CardBadgeValue,
  OverviewBadgeValue,
  ProviderAttention,
  ProviderHealth,
  ProviderState,
  ProviderTone,
} from "./providerTypes.js";
import { clampFillRatio, extractWindowSuffix } from "./usageSnapshot.js";

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
    const category = row.category ?? (def ? resolveFieldCategory(def) : "limit");
    const resetName =
      row.companionResetName ?? companionResetFieldName(def ?? { name, type }) ?? null;
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

const TONE_BY_STATE: Readonly<Record<ProviderState, ProviderTone>> = {
  ok: "ok",
  warning: "warning",
  critical: "critical",
  partial: "partial",
  error: "error",
  unavailable: "error",
  idle: "idle",
  loading: "idle",
};

export function deriveProviderState(
  status: ReaderStatus,
  tones: readonly (FieldTone | undefined)[],
  hasUsableField: boolean,
  lastKnownGood: boolean,
): ProviderHealth {
  const worstTone = worstFieldTone(tones);
  let state: ProviderState;
  if (status === ReaderStatus.ERROR) state = "error";
  else if (status === ReaderStatus.UNAVAILABLE) state = "unavailable";
  else if (status === ReaderStatus.DISABLED) state = "idle";
  else if (worstTone === "critical") state = "critical";
  else if (status === ReaderStatus.PARTIAL) state = "partial";
  else if (worstTone === "warning") state = "warning";
  else if (hasUsableField) state = "ok";
  else state = "idle";

  return {
    state,
    tone: TONE_BY_STATE[state],
    worstTone,
    hasUsableField,
    lastKnownGood,
    stateTag: null,
    stateAccessibleText: null,
  };
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
  result: ReaderResult,
  views: readonly FieldView[],
  t?: (s: string) => string,
  defs?: readonly FieldDef[],
  hasUsableOverride?: boolean,
): ProviderHealth {
  const tr = t ?? ((s: string) => s);
  const tones = collectFieldTones(views, result.fields, defs);
  const hasUsableField =
    hasUsableOverride ??
    (views.some((view) => view.hasValue) ||
      result.fields.some((field) => field.status === FieldStatus.OK));
  const lastKnownGood = isLastKnownGood(result);
  const core = deriveProviderState(result.status, tones, hasUsableField, lastKnownGood);
  const stateText = localizedStateText(result.status, tr);

  return { ...core, ...stateText };
}

export function healthFromStatusAndTones(
  status: ReaderStatus,
  tones: readonly (FieldTone | undefined)[],
  t?: (s: string) => string,
  hasUsableField = false,
): ProviderHealth {
  const tr = t ?? ((s: string) => s);
  const core = deriveProviderState(status, tones, hasUsableField, false);
  const stateText = localizedStateText(status, tr);

  return { ...core, ...stateText };
}

export function toAttention(health: ProviderHealth): ProviderAttention {
  if (health.state === "partial" && health.worstTone === "warning") return "warning";
  switch (health.state) {
    case "error":
    case "unavailable":
      return "error";
    case "partial":
      return "partial";
    case "warning":
      return "warning";
    case "critical":
      return "critical";
    default:
      return "quiet";
  }
}

export type BadgeZone = "card" | "overview" | "status";

export interface BadgeValues {
  readonly card: CardBadgeValue;
  readonly overview: OverviewBadgeValue;
  readonly status: string;
  readonly cardLabel: string;
  readonly overviewLabel: string;
}

type BadgeKey = ProviderState | "cached";

const BADGE_BY_KEY: Readonly<Record<BadgeKey, BadgeValues>> = {
  ok: { card: "live", overview: "ok", status: "", cardLabel: "Live", overviewLabel: "OK" },
  warning: { card: "live", overview: "ok", status: "", cardLabel: "Live", overviewLabel: "OK" },
  critical: { card: "live", overview: "ok", status: "", cardLabel: "Live", overviewLabel: "OK" },
  partial: {
    card: "cached",
    overview: "partial",
    status: "(partial)",
    cardLabel: "Cached",
    overviewLabel: "Partial",
  },
  cached: {
    card: "cached",
    overview: "cached",
    status: "(partial)",
    cardLabel: "Cached",
    overviewLabel: "Cached",
  },
  error: {
    card: "error",
    overview: "error",
    status: "(error)",
    cardLabel: "Error",
    overviewLabel: "Error",
  },
  unavailable: {
    card: "unavailable",
    overview: "error",
    status: "(unavailable)",
    cardLabel: "Unavailable",
    overviewLabel: "Error",
  },
  idle: { card: "live", overview: "ok", status: "", cardLabel: "Live", overviewLabel: "…" },
  loading: {
    card: "live",
    overview: "loading",
    status: "",
    cardLabel: "Live",
    overviewLabel: "…",
  },
};

function badgeValues(health: ProviderHealth): BadgeValues {
  const key: BadgeKey =
    health.lastKnownGood && health.state === "partial" ? "cached" : health.state;
  return BADGE_BY_KEY[key];
}

export function badgeForZone<Z extends BadgeZone>(health: ProviderHealth, zone: Z): BadgeValues[Z] {
  return badgeValues(health)[zone];
}

export function cardBadgeText(health: ProviderHealth, t: (s: string) => string): string {
  return t(badgeValues(health).cardLabel);
}

export function overviewBadgeText(health: ProviderHealth, t: (s: string) => string): string {
  if (health.state === "loading" || health.state === "idle") return "…";
  return t(badgeValues(health).overviewLabel);
}

export function statusBadgeText(health: ProviderHealth, t: (s: string) => string): string {
  const label = badgeForZone(health, "status");
  return label ? t(label) : "";
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

export interface StatusBarSegmentsContext {
  readonly order: readonly ProviderName[];
  readonly results: ReadonlyMap<ProviderName, ReaderResult>;
  readonly locale: string;
  readonly statusFields: (provider: ProviderName) => readonly string[];
  readonly shortDisplayName: (provider: ProviderName) => string;
  readonly fieldDefs: (provider: ProviderName) => readonly FieldDef[];
  readonly t: (s: string) => string;
}

export function deriveStatusBarSegments(
  context: StatusBarSegmentsContext,
): StatusBarProviderSegment[] {
  const segments: StatusBarProviderSegment[] = [];
  for (const provider of context.order) {
    const result = context.results.get(provider);
    if (!result || result.status === ReaderStatus.DISABLED) continue;
    const fieldDefs = context.fieldDefs(provider);
    const statusFields = context.statusFields(provider);
    const views = deriveFieldViews(
      fieldDefs,
      result,
      statusFields,
      "status",
      context.locale,
      context.t,
    );
    segments.push({
      provider,
      displayName: context.shortDisplayName(provider),
      result,
      fieldDefs,
      statusFields,
      views,
      health: deriveProviderHealth(result, views, context.t, fieldDefs),
    });
  }
  return segments;
}

export type StatusBarZonePlan<TSegment> =
  | { readonly kind: "placeholder"; readonly hasEnabled: boolean; readonly key: string }
  | { readonly kind: "segments"; readonly segments: readonly TSegment[]; readonly key: string };
