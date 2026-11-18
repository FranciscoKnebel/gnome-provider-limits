import type { ProviderName } from "../constants.js";
import type { FieldDef } from "./base.js";

export const CODEX_FIELDS: readonly FieldDef[] = [
  {
    name: "used_percent_primary",
    label: "Used % (5h window)",
    type: "percent",
    description: "Percentage used in the primary 5-hour rolling window.",
    defaultZone: "status",
  },
  {
    name: "remaining_percent_primary",
    label: "Remaining % (5h window)",
    type: "percent",
    description: "Percentage remaining in the primary 5-hour rolling window.",
    defaultZone: "status",
  },
  {
    name: "reset_at_primary",
    label: "Reset at (5h window)",
    type: "timestamp",
    description: "When the primary 5-hour window resets.",
    defaultZone: "status",
  },
  {
    name: "used_percent_secondary",
    label: "Used % (weekly)",
    type: "percent",
    description: "Percentage used in the weekly window.",
    defaultZone: "panel",
  },
  {
    name: "remaining_percent_secondary",
    label: "Remaining % (weekly)",
    type: "percent",
    description: "Percentage remaining in the weekly window.",
    defaultZone: "panel",
  },
  {
    name: "reset_at_secondary",
    label: "Reset at (weekly)",
    type: "timestamp",
    description: "When the weekly window resets.",
    defaultZone: "panel",
  },
  {
    name: "window_minutes_primary",
    label: "Window (5h)",
    type: "count",
    description: "Primary window duration in minutes.",
    defaultZone: "panel",
  },
  {
    name: "window_minutes_secondary",
    label: "Window (weekly)",
    type: "count",
    description: "Secondary window duration in minutes.",
    defaultZone: "panel",
  },
  {
    name: "limit_reached",
    label: "Limit reached",
    type: "bool",
    description: "Whether any rate limit has been reached.",
    defaultZone: "panel",
  },
  {
    name: "plan_type",
    label: "Plan type",
    type: "text",
    description: "Current plan type (e.g. plus, pro).",
    defaultZone: "panel",
  },
  {
    name: "reset_credits_available",
    label: "Resets available",
    type: "count",
    description: "Banked rate-limit reset credits available to redeem.",
    defaultZone: "panel",
  },
  {
    name: "reset_credits_expire_at",
    label: "Resets expire at",
    type: "timestamp",
    description: "When the earliest banked rate-limit reset credit expires.",
    defaultZone: "panel",
  },
];

export const CLAUDE_FIELDS: readonly FieldDef[] = [
  {
    name: "used_percent_session",
    label: "Used % (session 5h)",
    type: "percent",
    description: "Percentage used in the current 5-hour session window.",
    defaultZone: "status",
  },
  {
    name: "remaining_percent_session",
    label: "Remaining % (session 5h)",
    type: "percent",
    description: "Percentage remaining in the current 5-hour session window.",
    defaultZone: "status",
  },
  {
    name: "reset_at_session",
    label: "Reset at (session)",
    type: "timestamp",
    description: "When the session window resets.",
    defaultZone: "status",
  },
  {
    name: "used_percent_weekly",
    label: "Used % (weekly)",
    type: "percent",
    description: "Percentage used in the weekly window.",
    defaultZone: "panel",
  },
  {
    name: "remaining_percent_weekly",
    label: "Remaining % (weekly)",
    type: "percent",
    description: "Percentage remaining in the weekly window.",
    defaultZone: "panel",
  },
  {
    name: "reset_at_weekly",
    label: "Reset at (weekly)",
    type: "timestamp",
    description: "When the weekly window resets.",
    defaultZone: "panel",
  },
  {
    name: "used_percent_sonnet",
    label: "Used % (Sonnet weekly)",
    type: "percent",
    description: "Model-specific weekly usage for Sonnet.",
    defaultZone: "panel",
  },
  {
    name: "remaining_percent_sonnet",
    label: "Remaining % (Sonnet weekly)",
    type: "percent",
    description: "Model-specific weekly remaining for Sonnet.",
    defaultZone: "panel",
  },
  {
    name: "used_percent_opus",
    label: "Used % (Opus weekly)",
    type: "percent",
    description: "Model-specific weekly usage for Opus.",
    defaultZone: "panel",
  },
  {
    name: "remaining_percent_opus",
    label: "Remaining % (Opus weekly)",
    type: "percent",
    description: "Model-specific weekly remaining for Opus.",
    defaultZone: "panel",
  },
  {
    name: "has_extra_usage_enabled",
    label: "Extra usage enabled",
    type: "bool",
    description: "Whether extra usage (overage) is enabled for this account.",
    defaultZone: "panel",
  },
  {
    name: "extra_usage_disabled_reason",
    label: "Extra usage disabled reason",
    type: "text",
    description: "Reason extra usage is disabled, if any.",
    defaultZone: "panel",
  },
];

export const OPENCODE_FIELDS: readonly FieldDef[] = [
  {
    name: "used_percent_rolling",
    label: "Used % (rolling 5h)",
    type: "percent",
    description: "Percentage used in the provider-reported rolling 5-hour window.",
    defaultZone: "status",
  },
  {
    name: "remaining_percent_rolling",
    label: "Remaining % (rolling 5h)",
    type: "percent",
    description: "Percentage remaining in the provider-reported rolling 5-hour window.",
    defaultZone: "status",
  },
  {
    name: "reset_at_rolling",
    label: "Reset at (rolling)",
    type: "timestamp",
    description: "When the provider-reported rolling window resets.",
    defaultZone: "status",
  },
  {
    name: "used_percent_weekly",
    label: "Used % (weekly)",
    type: "percent",
    description: "Percentage used in the provider-reported weekly window.",
    defaultZone: "panel",
  },
  {
    name: "remaining_percent_weekly",
    label: "Remaining % (weekly)",
    type: "percent",
    description: "Percentage remaining in the provider-reported weekly window.",
    defaultZone: "panel",
  },
  {
    name: "reset_at_weekly",
    label: "Reset at (weekly)",
    type: "timestamp",
    description: "When the provider-reported weekly window resets.",
    defaultZone: "panel",
  },
  {
    name: "used_percent_monthly",
    label: "Used % (monthly)",
    type: "percent",
    description: "Percentage used in the provider-reported monthly window.",
    defaultZone: "panel",
  },
  {
    name: "remaining_percent_monthly",
    label: "Remaining % (monthly)",
    type: "percent",
    description: "Percentage remaining in the provider-reported monthly window.",
    defaultZone: "panel",
  },
  {
    name: "reset_at_monthly",
    label: "Reset at (monthly)",
    type: "timestamp",
    description: "When the provider-reported monthly window resets.",
    defaultZone: "panel",
  },
  {
    name: "limit_reached",
    label: "Limit reached",
    type: "bool",
    description: "Whether any OpenCode Go usage window is rate-limited.",
    defaultZone: "panel",
  },
  {
    name: "total_cost",
    label: "Total cost",
    type: "cost",
    description: "Total local session cost observed in opencode.db.",
    defaultZone: "panel",
  },
  {
    name: "sessions_count",
    label: "Sessions count",
    type: "count",
    description: "Total number of local sessions.",
    defaultZone: "panel",
  },
  {
    name: "usage_source",
    label: "Usage source",
    type: "text",
    description: "Where OpenCode Go usage was read from.",
    defaultZone: "panel",
  },
];

export const GROK_FIELDS: readonly FieldDef[] = [
  {
    name: "used_percent_credits",
    label: "Used % (credits)",
    type: "percent",
    description: "Provider-reported subscription credit usage, not an API spending limit.",
    defaultZone: "status",
  },
  {
    name: "remaining_percent_credits",
    label: "Remaining % (credits)",
    type: "percent",
    defaultZone: "status",
  },
  {
    name: "reset_at_credits",
    label: "Reset at (credits)",
    type: "timestamp",
    defaultZone: "status",
  },
  {
    name: "prepaid_balance",
    label: "Purchased credits",
    type: "cost",
    description: "Purchased credit balance in USD, separate from subscription credit usage.",
    defaultZone: "panel",
  },
  {
    name: "unified_billing",
    label: "Shared subscription credits",
    type: "bool",
    description: "Whether Grok reports a shared subscription credit pool.",
    defaultZone: "panel",
  },
  { name: "plan_type", label: "Plan type", type: "text", defaultZone: "panel" },
  { name: "usage_source", label: "Usage source", type: "text", defaultZone: "panel" },
];

export const PROVIDER_FIELDS: Record<ProviderName, readonly FieldDef[]> = {
  codex: CODEX_FIELDS,
  claude: CLAUDE_FIELDS,
  opencode: OPENCODE_FIELDS,
  grok: GROK_FIELDS,
};

export interface ProviderDefaultZones {
  readonly status: readonly string[];
  readonly panel: readonly string[];
}

export const DEFAULT_PROVIDER_ZONE_FIELDS: Record<ProviderName, ProviderDefaultZones> = {
  codex: {
    status: ["used_percent_primary", "reset_at_primary"],
    panel: [
      "used_percent_secondary",
      "reset_at_secondary",
      "window_minutes_primary",
      "window_minutes_secondary",
      "limit_reached",
      "plan_type",
      "reset_credits_available",
      "reset_credits_expire_at",
    ],
  },
  claude: {
    status: ["used_percent_session", "reset_at_session"],
    panel: [
      "used_percent_weekly",
      "reset_at_weekly",
      "used_percent_sonnet",
      "used_percent_opus",
      "has_extra_usage_enabled",
      "extra_usage_disabled_reason",
    ],
  },
  opencode: {
    status: ["used_percent_rolling", "reset_at_rolling"],
    panel: [
      "used_percent_weekly",
      "reset_at_weekly",
      "used_percent_monthly",
      "reset_at_monthly",
      "limit_reached",
      "total_cost",
      "sessions_count",
      "usage_source",
    ],
  },
  grok: {
    status: ["used_percent_credits", "reset_at_credits"],
    panel: [
      "remaining_percent_credits",
      "prepaid_balance",
      "unified_billing",
      "plan_type",
      "usage_source",
    ],
  },
};
