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

/** The one ordered severity value. Every surface vocabulary is keyed by it. */
export const PROVIDER_SEVERITIES = [
  "idle",
  "ok",
  "warning",
  "partial",
  "partial-warning",
  "cached",
  "cached-warning",
  "critical",
  "critical-partial",
  "error",
  "unavailable",
] as const;
export type ProviderSeverity = (typeof PROVIDER_SEVERITIES)[number];

export interface ProviderHealth {
  readonly severity: ProviderSeverity;
  readonly state: ProviderState;
  readonly tone: HealthTone;
  readonly attention: StatusAttention;
  readonly presentation: Presentation;
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

export interface HealthProfile {
  readonly state: ProviderState;
  readonly tone: HealthTone;
  readonly attention: StatusAttention;
  readonly presentation: Presentation;
}

function profile(
  state: ProviderState,
  tone: HealthTone,
  attention: StatusAttention,
  presentation: Presentation,
): HealthProfile {
  return { state, tone, attention, presentation };
}

/**
 * The single health table. State, tone, attention and presentation live in one
 * entry per severity, so no surface can recombine them into a different tuple.
 */
export const HEALTH_BY_SEVERITY: Readonly<Record<ProviderSeverity, HealthProfile>> = {
  idle: profile("idle", "idle", "quiet", {
    cardBadge: "live",
    overviewBadge: "ok",
    statusTag: "",
    pillTag: null,
    pillAccessibleText: null,
    label: { card: "Live", overview: "…" },
  }),
  ok: profile("ok", "ok", "quiet", {
    cardBadge: "live",
    overviewBadge: "ok",
    statusTag: "",
    pillTag: null,
    pillAccessibleText: null,
    label: { card: "Live", overview: "OK" },
  }),
  warning: profile("ok", "warning", "warning", {
    cardBadge: "live",
    overviewBadge: "ok",
    statusTag: "",
    pillTag: null,
    pillAccessibleText: null,
    label: { card: "Live", overview: "OK" },
  }),
  partial: profile("partial", "partial", "partial", {
    cardBadge: "cached",
    overviewBadge: "partial",
    statusTag: PARTIAL_TAG,
    pillTag: PILL_PARTIAL_MARKER,
    pillAccessibleText: CACHED_LABEL,
    label: { card: CACHED_LABEL, overview: "Partial" },
  }),
  "partial-warning": profile("partial", "partial", "warning", {
    cardBadge: "cached",
    overviewBadge: "partial",
    statusTag: PARTIAL_TAG,
    pillTag: PILL_PARTIAL_MARKER,
    pillAccessibleText: CACHED_LABEL,
    label: { card: CACHED_LABEL, overview: "Partial" },
  }),
  cached: profile("cached", "partial", "partial", {
    cardBadge: "cached",
    overviewBadge: "cached",
    statusTag: PARTIAL_TAG,
    pillTag: PILL_PARTIAL_MARKER,
    pillAccessibleText: CACHED_LABEL,
    label: { card: CACHED_LABEL, overview: CACHED_LABEL },
  }),
  "cached-warning": profile("cached", "partial", "warning", {
    cardBadge: "cached",
    overviewBadge: "cached",
    statusTag: PARTIAL_TAG,
    pillTag: PILL_PARTIAL_MARKER,
    pillAccessibleText: CACHED_LABEL,
    label: { card: CACHED_LABEL, overview: CACHED_LABEL },
  }),
  critical: profile("ok", "critical", "critical", {
    cardBadge: "live",
    overviewBadge: "ok",
    statusTag: "",
    pillTag: null,
    pillAccessibleText: null,
    label: { card: "Live", overview: "OK" },
  }),
  // PARTIAL read with a critical field: cached/partial presentation, critical tone.
  "critical-partial": profile("ok", "critical", "critical", {
    cardBadge: "cached",
    overviewBadge: "partial",
    statusTag: PARTIAL_TAG,
    pillTag: PILL_PARTIAL_MARKER,
    pillAccessibleText: CACHED_LABEL,
    label: { card: CACHED_LABEL, overview: "Partial" },
  }),
  error: profile("error", "error", "error", {
    cardBadge: "error",
    overviewBadge: "error",
    statusTag: ERROR_TAG,
    pillTag: ERROR_TAG,
    pillAccessibleText: ERROR_TAG,
    label: { card: "Error", overview: "Error" },
  }),
  unavailable: profile("unavailable", "error", "error", {
    cardBadge: "unavailable",
    overviewBadge: "error",
    statusTag: UNAVAILABLE_TAG,
    pillTag: UNAVAILABLE_TAG,
    pillAccessibleText: UNAVAILABLE_TAG,
    label: { card: "Unavailable", overview: "Error" },
  }),
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
      if (field?.status === FieldStatus.OK) tones.push(fieldTone(def.valueKind, field.value));
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
  if (status === ReaderStatus.PARTIAL) {
    if (worstTone === "critical") return "critical-partial";
    if (worstTone === "warning") return lastKnownGood ? "cached-warning" : "partial-warning";
    return lastKnownGood ? "cached" : "partial";
  }
  if (worstTone === "critical") return "critical";
  if (worstTone === "warning") return "warning";
  if (hasUsableField) return "ok";
  return "idle";
}

/** The single health contract: all data is required, no injection knobs. */
export interface ProviderHealthData {
  readonly result: ReaderResult;
  readonly displayStatus: ReaderStatus;
  readonly views: readonly FieldView[];
  readonly fieldDefs: readonly FieldDef[];
  readonly t: (s: string) => string;
}

export function deriveProviderHealth({
  result,
  displayStatus,
  views,
  fieldDefs,
  t: tr,
}: ProviderHealthData): ProviderHealth {
  const worstTone = worstFieldTone(collectFieldTones(views, result.fields, fieldDefs));
  const hasUsableField =
    views.some((view) => view.hasValue) ||
    result.fields.some((field) => field.status === FieldStatus.OK);
  const severity = deriveSeverity(
    displayStatus,
    worstTone,
    hasUsableField,
    isLastKnownGood(result),
  );
  const { presentation, state, tone, attention } = HEALTH_BY_SEVERITY[severity];
  const { pillTag, pillAccessibleText } = presentation;

  return {
    severity,
    state,
    tone,
    attention,
    presentation,
    worstTone,
    hasUsableField,
    stateTag: pillTag === null || pillTag === PILL_PARTIAL_MARKER ? pillTag : tr(pillTag),
    stateAccessibleText: pillAccessibleText === null ? null : tr(pillAccessibleText),
  };
}

export function cardBadgeText(health: ProviderHealth, t: (s: string) => string): string {
  return t(health.presentation.label.card);
}

export function overviewBadgeText(health: ProviderHealth, t: (s: string) => string): string {
  return t(health.presentation.label.overview);
}

export function statusBadgeText(health: ProviderHealth, t: (s: string) => string): string {
  const tag = health.presentation.statusTag;
  return tag ? t(tag) : "";
}
