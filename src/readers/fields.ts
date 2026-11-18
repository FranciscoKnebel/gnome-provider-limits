import type { ProviderName } from "../constants.js";
import type { FieldCategory, FieldDef, FieldType, FieldZone } from "./base.js";

export type { FieldCategory, FieldDef, FieldType, FieldZone };

export const CODEX_FIELDS: readonly FieldDef[] = [
  {
    name: "used_percent_primary",
    label: "Used % (5h window)",
    type: "percent",
    description: "Percentage used in the primary 5-hour rolling window.",
    defaultZone: "status",
    category: "limit",
    windowGroup: "primary",
  },
  {
    name: "remaining_percent_primary",
    label: "Remaining % (5h window)",
    type: "percent",
    description: "Percentage remaining in the primary 5-hour rolling window.",
    defaultZone: "status",
    category: "limit",
    windowGroup: "primary",
  },
  {
    name: "reset_at_primary",
    label: "Reset at (5h window)",
    type: "timestamp",
    description: "When the primary 5-hour window resets.",
    defaultZone: "status",
    category: "limit",
    windowGroup: "primary",
  },
  {
    name: "used_percent_secondary",
    label: "Used % (weekly)",
    type: "percent",
    description: "Percentage used in the weekly window.",
    defaultZone: "panel",
    category: "limit",
    windowGroup: "secondary",
  },
  {
    name: "remaining_percent_secondary",
    label: "Remaining % (weekly)",
    type: "percent",
    description: "Percentage remaining in the weekly window.",
    defaultZone: "panel",
    category: "limit",
    windowGroup: "secondary",
  },
  {
    name: "reset_at_secondary",
    label: "Reset at (weekly)",
    type: "timestamp",
    description: "When the weekly window resets.",
    defaultZone: "panel",
    category: "limit",
    windowGroup: "secondary",
  },
  {
    name: "window_minutes_primary",
    label: "Window (5h)",
    type: "count",
    description: "Primary window duration in minutes.",
    defaultZone: "panel",
    category: "limit",
  },
  {
    name: "window_minutes_secondary",
    label: "Window (weekly)",
    type: "count",
    description: "Secondary window duration in minutes.",
    defaultZone: "panel",
    category: "limit",
  },
  {
    name: "limit_reached",
    label: "Limit reached",
    type: "bool",
    description: "Whether any rate limit has been reached.",
    defaultZone: "panel",
    category: "limit",
  },
  {
    name: "plan_type",
    label: "Plan type",
    type: "text",
    description: "Current plan type (e.g. plus, pro).",
    defaultZone: "panel",
    category: "telemetry",
  },
  {
    name: "reset_credits_available",
    label: "Resets available",
    type: "count",
    description: "Banked rate-limit reset credits available to redeem.",
    defaultZone: "panel",
    category: "limit",
  },
  {
    name: "reset_credits_expire_at",
    label: "Resets expire at",
    type: "timestamp",
    description: "When the earliest banked rate-limit reset credit expires.",
    defaultZone: "panel",
    category: "limit",
  },
];

export const CLAUDE_FIELDS: readonly FieldDef[] = [
  {
    name: "used_percent_session",
    label: "Used % (session 5h)",
    type: "percent",
    description: "Percentage used in the current 5-hour session window.",
    defaultZone: "status",
    category: "limit",
    windowGroup: "session",
  },
  {
    name: "remaining_percent_session",
    label: "Remaining % (session 5h)",
    type: "percent",
    description: "Percentage remaining in the current 5-hour session window.",
    defaultZone: "status",
    category: "limit",
    windowGroup: "session",
  },
  {
    name: "reset_at_session",
    label: "Reset at (session)",
    type: "timestamp",
    description: "When the session window resets.",
    defaultZone: "status",
    category: "limit",
    windowGroup: "session",
  },
  {
    name: "used_percent_weekly",
    label: "Used % (weekly)",
    type: "percent",
    description: "Percentage used in the weekly window.",
    defaultZone: "panel",
    category: "limit",
    windowGroup: "weekly",
  },
  {
    name: "remaining_percent_weekly",
    label: "Remaining % (weekly)",
    type: "percent",
    description: "Percentage remaining in the weekly window.",
    defaultZone: "panel",
    category: "limit",
    windowGroup: "weekly",
  },
  {
    name: "reset_at_weekly",
    label: "Reset at (weekly)",
    type: "timestamp",
    description: "When the weekly window resets.",
    defaultZone: "panel",
    category: "limit",
    windowGroup: "weekly",
  },
  {
    name: "used_percent_sonnet",
    label: "Used % (Sonnet weekly)",
    type: "percent",
    description: "Model-specific weekly usage for Sonnet.",
    defaultZone: "panel",
    category: "limit",
    windowGroup: "sonnet",
  },
  {
    name: "remaining_percent_sonnet",
    label: "Remaining % (Sonnet weekly)",
    type: "percent",
    description: "Model-specific weekly remaining for Sonnet.",
    defaultZone: "panel",
    category: "limit",
    windowGroup: "sonnet",
  },
  {
    name: "used_percent_opus",
    label: "Used % (Opus weekly)",
    type: "percent",
    description: "Model-specific weekly usage for Opus.",
    defaultZone: "panel",
    category: "limit",
    windowGroup: "opus",
  },
  {
    name: "remaining_percent_opus",
    label: "Remaining % (Opus weekly)",
    type: "percent",
    description: "Model-specific weekly remaining for Opus.",
    defaultZone: "panel",
    category: "limit",
    windowGroup: "opus",
  },
  {
    name: "has_extra_usage_enabled",
    label: "Extra usage enabled",
    type: "bool",
    description: "Whether extra usage (overage) is enabled for this account.",
    defaultZone: "panel",
    category: "limit",
  },
  {
    name: "extra_usage_disabled_reason",
    label: "Extra usage disabled reason",
    type: "text",
    description: "Reason extra usage is disabled, if any.",
    defaultZone: "panel",
    category: "limit",
  },
];

export const OPENCODE_FIELDS: readonly FieldDef[] = [
  {
    name: "used_percent_rolling",
    label: "Used % (rolling 5h)",
    type: "percent",
    description: "Percentage used in the provider-reported rolling 5-hour window.",
    defaultZone: "status",
    category: "limit",
    windowGroup: "rolling",
  },
  {
    name: "remaining_percent_rolling",
    label: "Remaining % (rolling 5h)",
    type: "percent",
    description: "Percentage remaining in the provider-reported rolling 5-hour window.",
    defaultZone: "status",
    category: "limit",
    windowGroup: "rolling",
  },
  {
    name: "reset_at_rolling",
    label: "Reset at (rolling)",
    type: "timestamp",
    description: "When the provider-reported rolling window resets.",
    defaultZone: "status",
    category: "limit",
    windowGroup: "rolling",
  },
  {
    name: "used_percent_weekly",
    label: "Used % (weekly)",
    type: "percent",
    description: "Percentage used in the provider-reported weekly window.",
    defaultZone: "panel",
    category: "limit",
    windowGroup: "weekly",
  },
  {
    name: "remaining_percent_weekly",
    label: "Remaining % (weekly)",
    type: "percent",
    description: "Percentage remaining in the provider-reported weekly window.",
    defaultZone: "panel",
    category: "limit",
    windowGroup: "weekly",
  },
  {
    name: "reset_at_weekly",
    label: "Reset at (weekly)",
    type: "timestamp",
    description: "When the provider-reported weekly window resets.",
    defaultZone: "panel",
    category: "limit",
    windowGroup: "weekly",
  },
  {
    name: "used_percent_monthly",
    label: "Used % (monthly)",
    type: "percent",
    description: "Percentage used in the provider-reported monthly window.",
    defaultZone: "panel",
    category: "limit",
    windowGroup: "monthly",
  },
  {
    name: "remaining_percent_monthly",
    label: "Remaining % (monthly)",
    type: "percent",
    description: "Percentage remaining in the provider-reported monthly window.",
    defaultZone: "panel",
    category: "limit",
    windowGroup: "monthly",
  },
  {
    name: "reset_at_monthly",
    label: "Reset at (monthly)",
    type: "timestamp",
    description: "When the provider-reported monthly window resets.",
    defaultZone: "panel",
    category: "limit",
    windowGroup: "monthly",
  },
  {
    name: "limit_reached",
    label: "Limit reached",
    type: "bool",
    description: "Whether any OpenCode Go usage window is rate-limited.",
    defaultZone: "panel",
    category: "limit",
  },
  {
    name: "total_cost",
    label: "Total cost",
    type: "cost",
    description: "Total local session cost observed in opencode.db.",
    defaultZone: "panel",
    category: "telemetry",
  },
  {
    name: "sessions_count",
    label: "Sessions count",
    type: "count",
    description: "Total number of local sessions.",
    defaultZone: "panel",
    category: "telemetry",
  },
  {
    name: "usage_source",
    label: "Usage source",
    type: "text",
    description: "Where OpenCode Go usage was read from.",
    defaultZone: "panel",
    category: "telemetry",
  },
];

export const GROK_FIELDS: readonly FieldDef[] = [
  {
    name: "used_percent_credits",
    label: "Used % (credits)",
    type: "percent",
    description: "Provider-reported subscription credit usage, not an API spending limit.",
    defaultZone: "status",
    category: "limit",
    windowGroup: "credits",
  },
  {
    name: "remaining_percent_credits",
    label: "Remaining % (credits)",
    type: "percent",
    defaultZone: "status",
    category: "limit",
    windowGroup: "credits",
  },
  {
    name: "reset_at_credits",
    label: "Reset at (credits)",
    type: "timestamp",
    defaultZone: "status",
    category: "limit",
    windowGroup: "credits",
  },
  {
    name: "prepaid_balance",
    label: "Purchased credits",
    type: "cost",
    description: "Purchased credit balance in USD, separate from subscription credit usage.",
    defaultZone: "panel",
    category: "telemetry",
  },
  {
    name: "unified_billing",
    label: "Shared subscription credits",
    type: "bool",
    description: "Whether Grok reports a shared subscription credit pool.",
    defaultZone: "panel",
    category: "telemetry",
  },
  {
    name: "plan_type",
    label: "Plan type",
    type: "text",
    defaultZone: "panel",
    category: "telemetry",
  },
  {
    name: "usage_source",
    label: "Usage source",
    type: "text",
    defaultZone: "panel",
    category: "telemetry",
  },
];

export const PROVIDER_FIELDS: Record<ProviderName, readonly FieldDef[]> = {
  codex: CODEX_FIELDS,
  claude: CLAUDE_FIELDS,
  opencode: OPENCODE_FIELDS,
  grok: GROK_FIELDS,
};

export function getProviderFields(provider: ProviderName): readonly FieldDef[] {
  return PROVIDER_FIELDS[provider];
}

export function resolveFieldCategory(
  def: Pick<FieldDef, "name" | "type" | "category">,
): FieldCategory {
  if (def.category) return def.category;
  if (
    def.type === "percent" ||
    def.name.startsWith("used_percent") ||
    def.name.startsWith("remaining_percent") ||
    def.name.startsWith("reset_") ||
    def.name.startsWith("window_") ||
    def.name === "limit_reached" ||
    def.name.startsWith("has_extra_usage") ||
    def.name.startsWith("extra_usage_")
  ) {
    return "limit";
  }
  return "telemetry";
}

export function companionResetFieldName(
  def: Pick<FieldDef, "name" | "type" | "windowGroup">,
): string | null {
  if (def.type !== "percent") return null;
  if (def.windowGroup) return `reset_at_${def.windowGroup}`;
  if (def.name.startsWith("used_percent_")) {
    return `reset_at_${def.name.slice("used_percent_".length)}`;
  }
  if (def.name.startsWith("remaining_percent_")) {
    return `reset_at_${def.name.slice("remaining_percent_".length)}`;
  }
  if (def.name === "used_percent" || def.name === "remaining_percent") {
    return "reset_at";
  }
  return null;
}
