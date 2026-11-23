import type { ProviderName } from "../constants.js";
import { formatField } from "../formatters.js";
import type { FieldDef, FieldType, FieldZone, ReaderResult } from "../readers/base.js";
import { FieldStatus, ReaderStatus } from "../readers/base.js";
import type { FieldCategory } from "../readers/fields.js";
import { companionResetFieldName, resolveFieldCategory } from "../readers/fields.js";
import type { FieldTone } from "./fieldRows.js";
import { fieldTone, getFieldRows } from "./fieldRows.js";
import {
  clampFillRatio,
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

export type ProviderState =
  | "ok"
  | "warning"
  | "critical"
  | "partial"
  | "error"
  | "unavailable"
  | "idle"
  | "loading";

export type ProviderBadge =
  | "ok"
  | "cached"
  | "partial"
  | "error"
  | "unavailable"
  | "idle"
  | "loading";

export type ProviderTone = "ok" | "warning" | "critical" | "partial" | "error" | "idle";

export type CardBadgeValue = "live" | "cached" | "error" | "unavailable";
export type OverviewBadgeValue = "ok" | "cached" | "partial" | "error" | "loading";
export type AttentionValue = "quiet" | "partial" | "warning" | "critical" | "error";

export interface ProviderHealth {
  readonly status: ReaderStatus;
  readonly state: ProviderState;
  readonly tone: ProviderTone;
  readonly badge: ProviderBadge;
  readonly stateTag: string | null;
  readonly stateAccessibleText: string | null;
  readonly lastKnownGood: boolean;
  readonly worstTone: FieldTone | undefined;
  readonly hasUsableField: boolean;
}

export function isLastKnownGood(result: ReaderResult): boolean {
  return (
    result.status === ReaderStatus.PARTIAL &&
    (result.pathsTried?.includes("last-known-good") ?? false)
  );
}

function toneForState(state: ProviderState): ProviderTone {
  switch (state) {
    case "error":
    case "unavailable":
      return "error";
    case "critical":
      return "critical";
    case "partial":
      return "partial";
    case "warning":
      return "warning";
    case "ok":
      return "ok";
    case "idle":
    case "loading":
      return "idle";
  }
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

export function deriveProviderHealth(
  result: ReaderResult,
  views: readonly FieldView[],
  t?: (s: string) => string,
  defs?: readonly FieldDef[],
  hasUsableOverride?: boolean,
): ProviderHealth {
  const tr = t ?? ((s: string) => s);
  const tones: (FieldTone | undefined)[] = views.map((view) => view.tone);
  if (defs) {
    for (const def of defs) {
      if (def.type !== "percent") continue;
      const field = result.fields.find((candidate) => candidate.name === def.name);
      if (field?.status === FieldStatus.OK) tones.push(fieldTone(def.name, field.value));
    }
  }
  if (isLimitReached(result.fields)) tones.push("critical");

  const worstTone = worstFieldTone(tones);
  const hasUsableField =
    hasUsableOverride ??
    (views.some((view) => view.hasValue) ||
      result.fields.some((field) => field.status === FieldStatus.OK));
  const lastKnownGood = isLastKnownGood(result);

  let state: ProviderState;
  if (result.status === ReaderStatus.ERROR) state = "error";
  else if (result.status === ReaderStatus.UNAVAILABLE) state = "unavailable";
  else if (result.status === ReaderStatus.DISABLED) state = "idle";
  else if (worstTone === "critical") state = "critical";
  else if (result.status === ReaderStatus.PARTIAL) state = "partial";
  else if (worstTone === "warning") state = "warning";
  else if (hasUsableField) state = "ok";
  else state = "idle";

  let stateTag: string | null = null;
  let stateAccessibleText: string | null = null;
  if (result.status === ReaderStatus.ERROR) {
    stateTag = tr("(error)");
    stateAccessibleText = stateTag;
  } else if (result.status === ReaderStatus.UNAVAILABLE) {
    stateTag = tr("(unavailable)");
    stateAccessibleText = stateTag;
  } else if (result.status === ReaderStatus.PARTIAL) {
    stateTag = "~";
    stateAccessibleText = tr("Cached");
  }

  return {
    status: result.status,
    state,
    tone: toneForState(state),
    badge: badgeForStatus(result.status, lastKnownGood),
    stateTag,
    stateAccessibleText,
    lastKnownGood,
    worstTone,
    hasUsableField,
  };
}

export function healthFromStatusAndTones(
  status: ReaderStatus,
  tones: readonly (FieldTone | undefined)[],
  t?: (s: string) => string,
  hasUsableField = false,
): ProviderHealth {
  const views: FieldView[] = tones.map((tone, index) => ({
    name: `tone_${index}`,
    type: "text",
    category: "limit",
    label: "",
    value: null,
    valueText: "",
    accessibleText: "",
    ratio: null,
    hasValue: false,
    resetName: null,
    resetText: null,
    hasResetSlot: false,
    ...(tone ? { tone } : {}),
  }));
  const result: ReaderResult = { provider: "", status, fields: [], lastUpdated: 0 };
  return deriveProviderHealth(result, views, t, undefined, hasUsableField);
}

export function toHealthTone(health: ProviderHealth): ProviderTone {
  return health.tone;
}

export function toAttention(health: ProviderHealth): AttentionValue {
  switch (health.state) {
    case "error":
    case "unavailable":
      return "error";
    case "critical":
      return "critical";
    case "warning":
      return "warning";
    case "partial":
      return health.worstTone === "warning" ? "warning" : "partial";
    case "ok":
    case "idle":
    case "loading":
      return "quiet";
  }
}

export function toCardBadge(health: ProviderHealth): CardBadgeValue {
  switch (health.status) {
    case ReaderStatus.ERROR:
      return "error";
    case ReaderStatus.UNAVAILABLE:
      return "unavailable";
    case ReaderStatus.PARTIAL:
      return "cached";
    case ReaderStatus.OK:
    case ReaderStatus.DISABLED:
      return "live";
  }
}

export function toOverviewBadge(health: ProviderHealth): OverviewBadgeValue {
  switch (health.badge) {
    case "error":
    case "unavailable":
      return "error";
    case "cached":
      return "cached";
    case "partial":
      return "partial";
    case "loading":
      return "loading";
    case "ok":
    case "idle":
      return "ok";
  }
}

export function cardBadgeText(health: ProviderHealth, t: (s: string) => string): string {
  switch (health.status) {
    case ReaderStatus.ERROR:
      return t("Error");
    case ReaderStatus.UNAVAILABLE:
      return t("Unavailable");
    case ReaderStatus.PARTIAL:
      return t("Cached");
    case ReaderStatus.OK:
    case ReaderStatus.DISABLED:
      return t("Live");
  }
}

export function overviewBadgeText(health: ProviderHealth, t: (s: string) => string): string {
  if (health.state === "loading" || health.state === "idle") return "…";
  switch (health.badge) {
    case "error":
    case "unavailable":
      return t("Error");
    case "cached":
      return t("Cached");
    case "partial":
      return t("Partial");
    case "ok":
      return t("OK");
    case "idle":
    case "loading":
      return "…";
  }
}

export function statusBadgeText(health: ProviderHealth, t: (s: string) => string): string {
  switch (health.status) {
    case ReaderStatus.PARTIAL:
      return t("(partial)");
    case ReaderStatus.ERROR:
      return t("(error)");
    case ReaderStatus.UNAVAILABLE:
      return t("(unavailable)");
    case ReaderStatus.OK:
    case ReaderStatus.DISABLED:
      return "";
  }
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
