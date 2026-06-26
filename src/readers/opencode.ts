import GLib from "gi://GLib";

import { querySqlite } from "../helpers/sqlite.js";
import type { FieldDef, FieldResult, ReaderResult } from "./base.js";
import { BaseReader, FieldStatus } from "./base.js";
import {
  type OpenCodeDbRow,
  type OpenCodeDiskStats,
  normalizeOpenCodeDbRow,
  parseOpenCodeAuthText,
} from "./opencodeParser.js";

const OPENCODE_DB_PATH = `${GLib.get_home_dir()}/.local/share/opencode/opencode.db`;
const OPENCODE_AUTH_PATH = `${GLib.get_home_dir()}/.local/share/opencode/auth.json`;

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
    name: "token_expires_at",
    label: "Token expires in",
    type: "timestamp",
    description: "When the OAuth token expires.",
    defaultZone: "panel",
  },
];

export class OpenCodeReader extends BaseReader {
  get FIELDS(): readonly FieldDef[] {
    return OPENCODE_FIELDS;
  }

  async read(): Promise<ReaderResult> {
    const pathsTried: string[] = [];

    // v1: disk only
    // v1.x will add Web cookies path
    try {
      pathsTried.push("disk");
      const stats = await this._readFromDisk();
      if (stats) {
        return this._parseDiskResult(stats, pathsTried);
      }
    } catch (error) {
      console.warn(`[opencode] disk read failed: ${error}`);
    }

    return this._errorResult(
      "OpenCode: no data. Limits via web cookies coming in v1.x.",
      pathsTried,
    );
  }

  private async _readFromDisk(): Promise<OpenCodeDiskStats | null> {
    let totalCost = 0;
    let sessionsCount = 0;

    try {
      const rows = await querySqlite<OpenCodeDbRow[]>(
        OPENCODE_DB_PATH,
        "SELECT CAST(SUM(cost) AS REAL) AS total_cost, COUNT(*) AS sessions_count FROM session",
        { timeoutSeconds: 5 },
      );
      const stats = normalizeOpenCodeDbRow(rows?.[0]);
      totalCost = stats.totalCost;
      sessionsCount = stats.sessionsCount;
    } catch (error) {
      console.warn(`[opencode] sqlite read failed: ${error}`);
    }

    const tokenExpiresAt = this._readTokenExpiry();

    if (totalCost === 0 && sessionsCount === 0 && tokenExpiresAt === null) {
      return null;
    }

    return { totalCost, sessionsCount, tokenExpiresAt };
  }

  private _readTokenExpiry(): number | null {
    const authPath = OPENCODE_AUTH_PATH;
    const file = GLib.file_get_contents(authPath);
    if (!file) return null;

    let text: string;
    try {
      text = new TextDecoder().decode(file[1]);
    } catch {
      return null;
    }

    return parseOpenCodeAuthText(text);
  }

  private _parseDiskResult(stats: OpenCodeDiskStats, pathsTried: readonly string[]): ReaderResult {
    const fields: FieldResult[] = [];

    // v1: only telemetry fields from disk; limit fields unavailable
    fields.push(...this._makePercentFieldPair("rolling", null, FieldStatus.UNAVAILABLE));
    fields.push(this._makeField("reset_at_rolling", null, FieldStatus.UNAVAILABLE));
    fields.push(...this._makePercentFieldPair("weekly", null, FieldStatus.UNAVAILABLE));
    fields.push(this._makeField("reset_at_weekly", null, FieldStatus.UNAVAILABLE));
    fields.push(this._makeField("total_cost", stats.totalCost, FieldStatus.OK));
    fields.push(this._makeField("sessions_count", stats.sessionsCount, FieldStatus.OK));
    fields.push(
      this._makeField(
        "token_expires_at",
        stats.tokenExpiresAt,
        stats.tokenExpiresAt !== null ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
      ),
    );

    return this._partialResult(
      fields,
      pathsTried,
      "Limit fields unavailable — web cookies not yet implemented.",
    );
  }
}
