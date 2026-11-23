import type { FieldDef, FieldResult, ReaderResult } from "../readers/base.js";
import { FieldStatus, isLimitReached, ReaderStatus } from "../readers/base.js";
import type { FieldTone } from "./fieldRows.js";
import { fieldTone } from "./fieldRows.js";
import type { FieldView } from "./fieldViews.js";
import type { HealthTone, StatusAttention } from "./tone.js";

export type ProviderState = "idle" | "ok" | "partial" | "cached" | "error" | "unavailable";

const PARTIAL_TAG = "(partial)";
export const ERROR_TAG = "(error)";
export const UNAVAILABLE_TAG = "(unavailable)";
export const CACHED_LABEL = "Cached";
const PILL_PARTIAL_MARKER = "~";

/**
 * The one ordered severity value. Every surface vocabulary is a lookup over
 * this value, so state, tone and attention cannot drift from each other.
 */
export const PROVIDER_SEVERITIES = [
  "idle",
  "ok",
  "warning",
  "partial",
  "partial-warning",
  "cached",
  "cached-warning",
  "critical",
  "error",
  "unavailable",
] as const;
export type ProviderSeverity = (typeof PROVIDER_SEVERITIES)[number];

export interface ProviderHealth {
  readonly severity: ProviderSeverity;
  readonly state: ProviderState;
  readonly tone: HealthTone;
  readonly attention: StatusAttention;
  readonly worstTone: FieldTone | undefined;
  readonly hasUsableField: boolean;
  readonly stateTag: string | null;
  readonly stateAccessibleText: string | null;
}

export interface Presentation {
  readonly cardBadge: "live" | "cached" | "error" | "unavailable";
  readonly overviewBadge: "ok" | "cached" | "partial" | "error" | "loading";
  readonly statusTag: string;
  readonly pillTag: string | null;
  readonly pillAccessibleText: string | null;
  readonly label: {
    readonly card: string;
    readonly overview: string;
  };
}

export const PRESENTATION: Readonly<Record<ProviderState, Presentation>> = {
  idle: {
    cardBadge: "live",
    overviewBadge: "ok",
    statusTag: "",
    pillTag: null,
    pillAccessibleText: null,
    label: { card: "Live", overview: "…" },
  },
  ok: {
    cardBadge: "live",
    overviewBadge: "ok",
    statusTag: "",
    pillTag: null,
    pillAccessibleText: null,
    label: { card: "Live", overview: "OK" },
  },
  partial: {
    cardBadge: "cached",
    overviewBadge: "partial",
    statusTag: PARTIAL_TAG,
    pillTag: PILL_PARTIAL_MARKER,
    pillAccessibleText: CACHED_LABEL,
    label: { card: CACHED_LABEL, overview: "Partial" },
  },
  cached: {
    cardBadge: "cached",
    overviewBadge: "cached",
    statusTag: PARTIAL_TAG,
    pillTag: PILL_PARTIAL_MARKER,
    pillAccessibleText: CACHED_LABEL,
    label: { card: CACHED_LABEL, overview: CACHED_LABEL },
  },
  error: {
    cardBadge: "error",
    overviewBadge: "error",
    statusTag: ERROR_TAG,
    pillTag: ERROR_TAG,
    pillAccessibleText: ERROR_TAG,
    label: { card: "Error", overview: "Error" },
  },
  unavailable: {
    cardBadge: "unavailable",
    overviewBadge: "error",
    statusTag: UNAVAILABLE_TAG,
    pillTag: UNAVAILABLE_TAG,
    pillAccessibleText: UNAVAILABLE_TAG,
    label: { card: "Unavailable", overview: "Error" },
  },
};

export const STATE_BY_SEVERITY: Readonly<Record<ProviderSeverity, ProviderState>> = {
  idle: "idle",
  ok: "ok",
  warning: "ok",
  partial: "partial",
  "partial-warning": "partial",
  cached: "cached",
  "cached-warning": "cached",
  critical: "ok",
  error: "error",
  unavailable: "unavailable",
};

export const TONE_BY_SEVERITY: Readonly<Record<ProviderSeverity, HealthTone>> = {
  idle: "idle",
  ok: "ok",
  warning: "warning",
  partial: "partial",
  "partial-warning": "partial",
  cached: "partial",
  "cached-warning": "partial",
  critical: "critical",
  error: "error",
  unavailable: "error",
};

export const ATTENTION_BY_SEVERITY: Readonly<Record<ProviderSeverity, StatusAttention>> = {
  idle: "quiet",
  ok: "quiet",
  warning: "warning",
  partial: "partial",
  "partial-warning": "warning",
  cached: "partial",
  "cached-warning": "warning",
  critical: "critical",
  error: "error",
  unavailable: "error",
};

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

export function collectFieldTones(
  rows: readonly { readonly tone?: FieldTone }[],
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

export function isLastKnownGood(result: ReaderResult): boolean {
  return result.status === ReaderStatus.PARTIAL && result.fromCache;
}

/** The single derivation: all surface vocabularies are lookups over this value. */
export function deriveSeverity(
  status: ReaderStatus,
  worstTone: FieldTone | undefined,
  hasUsableField: boolean,
  lastKnownGood: boolean,
): ProviderSeverity {
  if (status === ReaderStatus.ERROR) return "error";
  if (status === ReaderStatus.UNAVAILABLE) return "unavailable";
  if (status === ReaderStatus.DISABLED) return "idle";
  if (status === ReaderStatus.PARTIAL && worstTone !== "critical") {
    if (worstTone === "warning") return lastKnownGood ? "cached-warning" : "partial-warning";
    return lastKnownGood ? "cached" : "partial";
  }
  if (worstTone === "critical") return "critical";
  if (worstTone === "warning") return "warning";
  if (hasUsableField) return "ok";
  return "idle";
}

/** The pill text is a second field on the same presentation contract, not a second mapping. */
function pillPresentation(status: ReaderStatus): Presentation {
  if (status === ReaderStatus.ERROR) return PRESENTATION.error;
  if (status === ReaderStatus.UNAVAILABLE) return PRESENTATION.unavailable;
  if (status === ReaderStatus.PARTIAL) return PRESENTATION.partial;
  return PRESENTATION.idle;
}

function pillStateText(
  presentation: Presentation,
  tr: (s: string) => string,
): Pick<ProviderHealth, "stateTag" | "stateAccessibleText"> {
  if (presentation.pillTag === null) return { stateTag: null, stateAccessibleText: null };
  return {
    stateTag:
      presentation.pillTag === PILL_PARTIAL_MARKER ? PILL_PARTIAL_MARKER : tr(presentation.pillTag),
    stateAccessibleText: presentation.pillAccessibleText
      ? tr(presentation.pillAccessibleText)
      : null,
  };
}

/** The single health contract: all data is required, no injection knobs. */
export interface ProviderHealthData {
  readonly result: ReaderResult;
  readonly views: readonly FieldView[];
  readonly fieldDefs: readonly FieldDef[];
  readonly t: (s: string) => string;
}

export function deriveProviderHealth(
  status: ReaderStatus,
  { result, views, fieldDefs, t: tr }: ProviderHealthData,
): ProviderHealth {
  const worstTone = worstFieldTone(collectFieldTones(views, result.fields, fieldDefs));
  const hasUsableField =
    views.some((view) => view.hasValue) ||
    result.fields.some((field) => field.status === FieldStatus.OK);
  const severity = deriveSeverity(status, worstTone, hasUsableField, isLastKnownGood(result));

  return {
    severity,
    state: STATE_BY_SEVERITY[severity],
    tone: TONE_BY_SEVERITY[severity],
    attention: ATTENTION_BY_SEVERITY[severity],
    worstTone,
    hasUsableField,
    ...pillStateText(pillPresentation(status), tr),
  };
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
