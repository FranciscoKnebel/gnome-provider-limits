import type { ProviderName } from "../constants.js";
import { formatField } from "../formatters.js";
import type { FieldDef, FieldType, FieldZone, ReaderResult } from "../readers/base.js";
import { FieldStatus, ReaderStatus } from "../readers/base.js";
import type { FieldCategory } from "../readers/fields.js";
import { companionResetFieldName, resolveFieldCategory } from "../readers/fields.js";
import type { FieldTone } from "./fieldRows.js";
import { getFieldRows } from "./fieldRows.js";
import type {
  CardBadgeValue,
  OverviewBadgeValue,
  ProviderAttention,
  ProviderBadge,
  ProviderHealth,
  ProviderState,
  ProviderStateCore,
  ProviderTone,
} from "./providerTypes.js";
import {
  ATTENTION_BY_STATE,
  CARD_BADGE_BY_BADGE,
  CARD_BADGE_LABEL,
  OVERVIEW_BADGE_BY_BADGE,
  OVERVIEW_BADGE_LABEL,
  STATUS_BADGE_LABEL,
  TONE_BY_STATE,
} from "./providerTypes.js";
import {
  clampFillRatio,
  collectFieldTones,
  extractWindowSuffix,
  isLimitReached,
  worstFieldTone,
} from "./usageSnapshot.js";

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
  readonly fillPercent?: number;
  readonly hasValue: boolean;
  readonly resetName: string | null;
  readonly resetText: string | null;
  readonly hasResetSlot: boolean;
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

    const field = result.fields.find((candidate) => candidate.name === name);
    const tone = limitReached && name === "limit_reached" ? "critical" : row.tone;
    return {
      name,
      type,
      category,
      label: row.label,
      value: field?.value ?? null,
      valueText: row.valueText,
      accessibleText: row.accessibleText ?? `${tr(row.label)}: ${row.valueText}`,
      ratio: row.fillPercent === undefined ? null : clampFillRatio(row.fillPercent / 100),
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

export function isLastKnownGood(result: ReaderResult): boolean {
  return (
    result.status === ReaderStatus.PARTIAL &&
    (result.pathsTried?.includes("last-known-good") ?? false)
  );
}

export function deriveProviderState(
  status: ReaderStatus,
  tones: readonly (FieldTone | undefined)[],
  hasUsableField: boolean,
  lastKnownGood: boolean,
): ProviderStateCore {
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
    badge: badgeForStatus(status, lastKnownGood),
    worstTone,
  };
}

function badgeForStatus(status: ReaderStatus, lastKnownGood: boolean): ProviderBadge {
  switch (status) {
    case ReaderStatus.ERROR:
      return "error";
    case ReaderStatus.UNAVAILABLE:
      return "unavailable";
    case ReaderStatus.PARTIAL:
      return lastKnownGood ? "cached" : "partial";
    case ReaderStatus.DISABLED:
      return "idle";
    case ReaderStatus.OK:
      return "ok";
  }
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

  return {
    status: result.status,
    ...core,
    ...stateText,
    lastKnownGood,
    hasUsableField,
  };
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

  return {
    status,
    ...core,
    ...stateText,
    lastKnownGood: false,
    hasUsableField,
  };
}

export function toHealthTone(health: ProviderHealth): ProviderTone {
  return health.tone;
}

export function toAttention(health: ProviderHealth): ProviderAttention {
  if (health.state === "partial" && health.worstTone === "warning") return "warning";
  return ATTENTION_BY_STATE[health.state];
}

export function toCardBadge(health: ProviderHealth): CardBadgeValue {
  return CARD_BADGE_BY_BADGE[health.badge];
}

export function toOverviewBadge(health: ProviderHealth): OverviewBadgeValue {
  return OVERVIEW_BADGE_BY_BADGE[health.badge];
}

export function cardBadgeText(health: ProviderHealth, t: (s: string) => string): string {
  return t(CARD_BADGE_LABEL[health.badge]);
}

export function overviewBadgeText(health: ProviderHealth, t: (s: string) => string): string {
  if (health.state === "loading" || health.state === "idle") return "…";
  return t(OVERVIEW_BADGE_LABEL[health.badge]);
}

export function statusBadgeText(health: ProviderHealth, t: (s: string) => string): string {
  const label = STATUS_BADGE_LABEL[health.badge];
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
