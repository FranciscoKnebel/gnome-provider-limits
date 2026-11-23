import type { FieldTone } from "./fieldRows.js";

export type ProviderState = "idle" | "ok" | "partial" | "cached" | "error" | "unavailable";

export type ProviderTone = "ok" | "warning" | "critical" | "partial" | "error" | "idle";
export type ProviderAttention = "quiet" | "partial" | "warning" | "critical" | "error";

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
