import type { FieldTone } from "./fieldRows.js";

export type ProviderState =
  | "ok"
  | "warning"
  | "critical"
  | "partial"
  | "error"
  | "unavailable"
  | "idle"
  | "loading";

export type ProviderTone = "ok" | "warning" | "critical" | "partial" | "error" | "idle";

export type ProviderAttention = "quiet" | "partial" | "warning" | "critical" | "error";

export type CardBadgeValue = "live" | "cached" | "error" | "unavailable";
export type OverviewBadgeValue = "ok" | "cached" | "partial" | "error" | "loading";

export interface ProviderHealth {
  readonly state: ProviderState;
  readonly tone: ProviderTone;
  readonly worstTone: FieldTone | undefined;
  readonly hasUsableField: boolean;
  readonly lastKnownGood: boolean;
  readonly stateTag: string | null;
  readonly stateAccessibleText: string | null;
}
