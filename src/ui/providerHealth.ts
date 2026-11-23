import type { FieldDef, FieldResult, ReaderResult } from "../readers/base.js";
import { FieldStatus, isLimitReached, ReaderStatus } from "../readers/base.js";
import type { FieldTone } from "./fieldRows.js";
import { fieldTone } from "./fieldRows.js";
import type { FieldView } from "./fieldViews.js";

export type ProviderState = "idle" | "ok" | "partial" | "cached" | "error" | "unavailable";

export type ProviderTone = "ok" | "warning" | "critical" | "partial" | "error" | "idle";
export type ProviderAttention = "quiet" | "partial" | "warning" | "critical" | "error";

export interface ProviderHealth {
  readonly state: ProviderState;
  readonly tone: ProviderTone;
  readonly attention: ProviderAttention;
  readonly worstTone: FieldTone | undefined;
  readonly hasUsableField: boolean;
  readonly lastKnownGood: boolean;
  readonly stateTag: string | null;
  readonly stateAccessibleText: string | null;
}

export interface Presentation {
  readonly cardBadge: "live" | "cached" | "error" | "unavailable";
  readonly overviewBadge: "ok" | "cached" | "partial" | "error" | "loading";
  readonly statusTag: string;
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
    label: { card: "Live", overview: "…" },
  },
  ok: {
    cardBadge: "live",
    overviewBadge: "ok",
    statusTag: "",
    label: { card: "Live", overview: "OK" },
  },
  partial: {
    cardBadge: "cached",
    overviewBadge: "partial",
    statusTag: "(partial)",
    label: { card: "Cached", overview: "Partial" },
  },
  cached: {
    cardBadge: "cached",
    overviewBadge: "cached",
    statusTag: "(partial)",
    label: { card: "Cached", overview: "Cached" },
  },
  error: {
    cardBadge: "error",
    overviewBadge: "error",
    statusTag: "(error)",
    label: { card: "Error", overview: "Error" },
  },
  unavailable: {
    cardBadge: "unavailable",
    overviewBadge: "error",
    statusTag: "(unavailable)",
    label: { card: "Unavailable", overview: "Error" },
  },
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

export function deriveState(
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

export function deriveTone(state: ProviderState, worstTone: FieldTone | undefined): ProviderTone {
  if (state === "error" || state === "unavailable") return "error";
  if (state === "idle") return "idle";
  if (state === "partial" || state === "cached") return "partial";
  return worstTone === "warning" || worstTone === "critical" ? worstTone : "ok";
}

export function deriveAttention(
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
  const lastKnownGood = isLastKnownGood(result);
  const state = deriveState(status, worstTone, hasUsableField, lastKnownGood);

  return {
    state,
    tone: deriveTone(state, worstTone),
    attention: deriveAttention(state, worstTone),
    worstTone,
    hasUsableField,
    lastKnownGood,
    ...localizedStateText(status, tr),
  };
}

export type BadgeZone = "card" | "overview";

export function badgeForZone(health: ProviderHealth, zone: "card"): Presentation["cardBadge"];
export function badgeForZone(
  health: ProviderHealth,
  zone: "overview",
): Presentation["overviewBadge"];
export function badgeForZone(health: ProviderHealth, zone: BadgeZone): string {
  const presentation = PRESENTATION[health.state];
  return zone === "card" ? presentation.cardBadge : presentation.overviewBadge;
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
