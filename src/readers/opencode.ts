import GLib from "gi://GLib";

import { logWarn } from "../helpers/log.js";
import { querySqlite } from "../helpers/sqlite.js";
import type { FieldDef, FieldResult, ReaderResult } from "./base.js";
import { BaseReader, FieldStatus } from "./base.js";
import {
  buildOpenCodeObservedSpendLimits,
  type OpenCodeCostEntryRow,
  type OpenCodeDbRow,
  type OpenCodeDiskStats,
  type OpenCodeObservedSpendLimit,
  type OpenCodeObservedSpendWindow,
  normalizeOpenCodeDbRow,
} from "./opencodeParser.js";

const OPENCODE_DB_PATH = `${GLib.get_home_dir()}/.local/share/opencode/opencode.db`;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const OPENCODE_FIELDS: readonly FieldDef[] = [
  {
    name: "used_percent_rolling",
    label: "Used % (rolling 5h)",
    type: "percent",
    description: "Percentage used in the rolling 5-hour window.",
    defaultZone: "status",
  },
  {
    name: "remaining_percent_rolling",
    label: "Remaining % (rolling 5h)",
    type: "percent",
    description: "Percentage remaining in the rolling 5-hour window.",
    defaultZone: "status",
  },
  {
    name: "reset_at_rolling",
    label: "Reset at (rolling)",
    type: "timestamp",
    description: "When the rolling window resets.",
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
    name: "used_percent_monthly",
    label: "Used % (monthly)",
    type: "percent",
    description: "Percentage of the observed local monthly OpenCode Go spend ceiling used.",
    defaultZone: "panel",
  },
  {
    name: "remaining_percent_monthly",
    label: "Remaining % (monthly)",
    type: "percent",
    description: "Percentage of the observed local monthly OpenCode Go spend ceiling remaining.",
    defaultZone: "panel",
  },
  {
    name: "reset_at_monthly",
    label: "Reset at (monthly)",
    type: "timestamp",
    description: "When the local monthly observed spend window resets.",
    defaultZone: "panel",
  },
  {
    name: "used_cost_rolling",
    label: "Used cost (rolling 5h)",
    type: "cost",
    description: "Observed local OpenCode Go spend in the rolling 5-hour window.",
    defaultZone: "panel",
  },
  {
    name: "remaining_cost_rolling",
    label: "Remaining cost (rolling 5h)",
    type: "cost",
    description: "Remaining local OpenCode Go spend before the rolling 5-hour ceiling.",
    defaultZone: "panel",
  },
  {
    name: "used_cost_weekly",
    label: "Used cost (weekly)",
    type: "cost",
    description: "Observed local OpenCode Go spend in the weekly window.",
    defaultZone: "panel",
  },
  {
    name: "remaining_cost_weekly",
    label: "Remaining cost (weekly)",
    type: "cost",
    description: "Remaining local OpenCode Go spend before the weekly ceiling.",
    defaultZone: "panel",
  },
  {
    name: "used_cost_monthly",
    label: "Used cost (monthly)",
    type: "cost",
    description: "Observed local OpenCode Go spend in the monthly window.",
    defaultZone: "panel",
  },
  {
    name: "remaining_cost_monthly",
    label: "Remaining cost (monthly)",
    type: "cost",
    description: "Remaining local OpenCode Go spend before the monthly ceiling.",
    defaultZone: "panel",
  },
  {
    name: "total_cost",
    label: "Total cost",
    type: "cost",
    description: "Total cost across all sessions.",
    defaultZone: "panel",
  },
  {
    name: "sessions_count",
    label: "Sessions count",
    type: "count",
    description: "Total number of sessions.",
    defaultZone: "panel",
  },
  {
    name: "plan_type",
    label: "Plan type",
    type: "text",
    description: "Observed spend model used for OpenCode Go.",
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

export class OpenCodeReader extends BaseReader {
  get FIELDS(): readonly FieldDef[] {
    return OPENCODE_FIELDS;
  }

  async read(): Promise<ReaderResult> {
    const pathsTried: string[] = [];

    try {
      pathsTried.push("disk");
      const stats = await this._readFromDisk();
      if (stats) {
        return this._parseDiskResult(stats, pathsTried);
      }
    } catch (error) {
      logWarn("opencode disk read failed", error);
    }

    return this._errorResult(
      "OpenCode: no local Go usage data. Start OpenCode Go to refresh local state.",
      pathsTried,
    );
  }

  private async _readFromDisk(): Promise<OpenCodeDiskStats | null> {
    let totalCost = 0;
    let sessionsCount = 0;
    let limits: OpenCodeObservedSpendLimit[] = [];

    try {
      const rows = await querySqlite(
        OPENCODE_DB_PATH,
        "SELECT CAST(SUM(cost) AS REAL) AS total_cost, COUNT(*) AS sessions_count FROM session",
        { timeoutSeconds: 5 },
      );
      const firstRow = Array.isArray(rows) ? (rows[0] as OpenCodeDbRow | undefined) : undefined;
      const stats = normalizeOpenCodeDbRow(firstRow);
      totalCost = stats.totalCost;
      sessionsCount = stats.sessionsCount;
    } catch (error) {
      logWarn("opencode sqlite read failed", error);
    }

    try {
      const windows = this._observedSpendWindows();
      const oldestWindow = windows.reduce((max, window) => Math.max(max, window.durationMs), 0);
      const sinceMs = Date.now() - oldestWindow;
      const sinceSeconds = Math.floor(sinceMs / 1000);
      const rows = await querySqlite(
        OPENCODE_DB_PATH,
        `SELECT cost, time_created FROM session WHERE (time_created >= 1000000000000 AND time_created >= ${sinceMs}) OR (time_created < 1000000000000 AND time_created >= ${sinceSeconds}) ORDER BY time_created ASC`,
        { timeoutSeconds: 5 },
      );
      limits = buildOpenCodeObservedSpendLimits(
        Array.isArray(rows) ? (rows as OpenCodeCostEntryRow[]) : [],
        windows,
        Date.now(),
      );
    } catch (error) {
      logWarn("opencode observed spend read failed", error);
    }

    if (totalCost === 0 && sessionsCount === 0 && limits.length === 0) {
      return null;
    }

    return { totalCost, sessionsCount, limits };
  }

  private _observedSpendWindows(): readonly OpenCodeObservedSpendWindow[] {
    return [
      {
        id: "rolling",
        durationMs: 5 * HOUR_MS,
        limitUsd: this._spendLimit("opencode-limit-rolling-5h-usd", 12),
      },
      {
        id: "weekly",
        durationMs: 7 * DAY_MS,
        limitUsd: this._spendLimit("opencode-limit-weekly-usd", 30),
      },
      {
        id: "monthly",
        durationMs: 30 * DAY_MS,
        limitUsd: this._spendLimit("opencode-limit-monthly-usd", 60),
      },
    ];
  }

  private _spendLimit(key: string, fallback: number): number {
    const value = this.settings.get_double(key);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private _parseDiskResult(stats: OpenCodeDiskStats, pathsTried: readonly string[]): ReaderResult {
    const fields: FieldResult[] = [];

    for (const limit of stats.limits) {
      fields.push(this._makeField(`used_percent_${limit.id}`, limit.usedPercent, FieldStatus.OK));
      fields.push(
        this._makeField(`remaining_percent_${limit.id}`, limit.remainingPercent, FieldStatus.OK),
      );
      fields.push(
        this._makeField(
          `reset_at_${limit.id}`,
          limit.resetAt,
          limit.resetAt !== null ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
        ),
      );
      fields.push(this._makeField(`used_cost_${limit.id}`, limit.usedUsd, FieldStatus.OK));
      fields.push(
        this._makeField(`remaining_cost_${limit.id}`, limit.remainingUsd, FieldStatus.OK),
      );
    }

    fields.push(this._makeField("total_cost", stats.totalCost, FieldStatus.OK));
    fields.push(this._makeField("sessions_count", stats.sessionsCount, FieldStatus.OK));
    fields.push(this._makeField("plan_type", "OpenCode Go", FieldStatus.OK));
    fields.push(this._makeField("usage_source", "observed local spend", FieldStatus.OK));

    return this._classifyResult(fields, pathsTried, "OpenCode");
  }
}
