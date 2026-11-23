import type { FieldTone } from "./fieldRows.js";

export type ProviderState =
  | "idle"
  | "loading"
  | "ok"
  | "partial"
  | "cached"
  | "partialWarning"
  | "cachedWarning"
  | "warning"
  | "critical"
  | "error"
  | "unavailable";

export interface Presentation {
  readonly tone: "ok" | "warning" | "critical" | "partial" | "error" | "idle";
  readonly attention: "quiet" | "partial" | "warning" | "critical" | "error";
  readonly cardBadge: "live" | "cached" | "error" | "unavailable";
  readonly overviewBadge: "ok" | "cached" | "partial" | "error" | "loading";
  readonly statusTag: string;
  readonly label: {
    readonly card: string;
    readonly overview: string;
  };
}

export type ProviderTone = Presentation["tone"];
export type ProviderAttention = Presentation["attention"];

export const PRESENTATION: Readonly<Record<ProviderState, Presentation>> = {
  idle: {
    tone: "idle",
    attention: "quiet",
    cardBadge: "live",
    overviewBadge: "ok",
    statusTag: "",
    label: { card: "Live", overview: "…" },
  },
  loading: {
    tone: "idle",
    attention: "quiet",
    cardBadge: "live",
    overviewBadge: "loading",
    statusTag: "",
    label: { card: "Live", overview: "…" },
  },
  ok: {
    tone: "ok",
    attention: "quiet",
    cardBadge: "live",
    overviewBadge: "ok",
    statusTag: "",
    label: { card: "Live", overview: "OK" },
  },
  partial: {
    tone: "partial",
    attention: "partial",
    cardBadge: "cached",
    overviewBadge: "partial",
    statusTag: "(partial)",
    label: { card: "Cached", overview: "Partial" },
  },
  cached: {
    tone: "partial",
    attention: "partial",
    cardBadge: "cached",
    overviewBadge: "cached",
    statusTag: "(partial)",
    label: { card: "Cached", overview: "Cached" },
  },
  partialWarning: {
    tone: "partial",
    attention: "warning",
    cardBadge: "cached",
    overviewBadge: "partial",
    statusTag: "(partial)",
    label: { card: "Cached", overview: "Partial" },
  },
  cachedWarning: {
    tone: "partial",
    attention: "warning",
    cardBadge: "cached",
    overviewBadge: "cached",
    statusTag: "(partial)",
    label: { card: "Cached", overview: "Cached" },
  },
  warning: {
    tone: "warning",
    attention: "warning",
    cardBadge: "live",
    overviewBadge: "ok",
    statusTag: "",
    label: { card: "Live", overview: "OK" },
  },
  critical: {
    tone: "critical",
    attention: "critical",
    cardBadge: "live",
    overviewBadge: "ok",
    statusTag: "",
    label: { card: "Live", overview: "OK" },
  },
  error: {
    tone: "error",
    attention: "error",
    cardBadge: "error",
    overviewBadge: "error",
    statusTag: "(error)",
    label: { card: "Error", overview: "Error" },
  },
  unavailable: {
    tone: "error",
    attention: "error",
    cardBadge: "unavailable",
    overviewBadge: "error",
    statusTag: "(unavailable)",
    label: { card: "Unavailable", overview: "Error" },
  },
};

export interface ProviderHealth {
  readonly state: ProviderState;
  readonly tone: ProviderTone;
  readonly worstTone: FieldTone | undefined;
  readonly hasUsableField: boolean;
  readonly lastKnownGood: boolean;
  readonly stateTag: string | null;
  readonly stateAccessibleText: string | null;
}
