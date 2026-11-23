import type { ReaderStatus } from "../readers/base.js";
import type { FieldTone } from "./fieldRows.js";

export type ProviderTone = "ok" | "warning" | "critical" | "partial" | "error" | "idle";

export type ProviderAttention = "quiet" | "partial" | "warning" | "critical" | "error";

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

export type CardBadgeValue = "live" | "cached" | "error" | "unavailable";
export type OverviewBadgeValue = "ok" | "cached" | "partial" | "error" | "loading";

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

export interface ProviderStateCore {
  readonly state: ProviderState;
  readonly tone: ProviderTone;
  readonly badge: ProviderBadge;
  readonly worstTone: FieldTone | undefined;
}

export const TONE_BY_STATE: Readonly<Record<ProviderState, ProviderTone>> = {
  ok: "ok",
  warning: "warning",
  critical: "critical",
  partial: "partial",
  error: "error",
  unavailable: "error",
  idle: "idle",
  loading: "idle",
};

export const ATTENTION_BY_STATE: Readonly<Record<ProviderState, ProviderAttention>> = {
  ok: "quiet",
  warning: "warning",
  critical: "critical",
  partial: "partial",
  error: "error",
  unavailable: "error",
  idle: "quiet",
  loading: "quiet",
};

export const CARD_BADGE_BY_BADGE: Readonly<Record<ProviderBadge, CardBadgeValue>> = {
  ok: "live",
  cached: "cached",
  partial: "cached",
  error: "error",
  unavailable: "unavailable",
  idle: "live",
  loading: "live",
};

export const OVERVIEW_BADGE_BY_BADGE: Readonly<Record<ProviderBadge, OverviewBadgeValue>> = {
  ok: "ok",
  cached: "cached",
  partial: "partial",
  error: "error",
  unavailable: "error",
  idle: "ok",
  loading: "loading",
};

export const CARD_BADGE_LABEL: Readonly<Record<ProviderBadge, string>> = {
  ok: "Live",
  cached: "Cached",
  partial: "Cached",
  error: "Error",
  unavailable: "Unavailable",
  idle: "Live",
  loading: "Live",
};

export const OVERVIEW_BADGE_LABEL: Readonly<Record<ProviderBadge, string>> = {
  ok: "OK",
  cached: "Cached",
  partial: "Partial",
  error: "Error",
  unavailable: "Error",
  idle: "…",
  loading: "…",
};

export const STATUS_BADGE_LABEL: Readonly<Record<ProviderBadge, string>> = {
  ok: "",
  cached: "(partial)",
  partial: "(partial)",
  error: "(error)",
  unavailable: "(unavailable)",
  idle: "",
  loading: "",
};
