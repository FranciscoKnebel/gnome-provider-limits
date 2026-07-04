import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { HttpClient, HttpError, TokenError } from "../helpers/http.js";
import { logWarn } from "../helpers/log.js";
import { querySqlite } from "../helpers/sqlite.js";
import type { FieldDef, FieldResult, ReaderResult } from "./base.js";
import { BaseReader, FieldStatus } from "./base.js";
import {
  type OpenCodeDbRow,
  type OpenCodeDiskStats,
  type OpenCodeRateLimitsPayload,
  normalizeOpenCodeDbRow,
  normalizeOpenCodeOauthPayload,
  parseOpenCodeAccessToken,
  parseOpenCodeAuthText,
} from "./opencodeParser.js";

const OPENCODE_DB_PATH = `${GLib.get_home_dir()}/.local/share/opencode/opencode.db`;
const OPENCODE_AUTH_PATH = `${GLib.get_home_dir()}/.local/share/opencode/auth.json`;
const OPENCODE_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

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

Gio._promisify(Gio.File.prototype, "load_contents_async", "load_contents_finish");

export class OpenCodeReader extends BaseReader {
  private _http: HttpClient | null = null;

  get FIELDS(): readonly FieldDef[] {
    return OPENCODE_FIELDS;
  }

  override destroy(): void {
    this._http?.destroy();
    this._http = null;
    super.destroy();
  }

  async read(): Promise<ReaderResult> {
    const pathsTried: string[] = [];

    try {
      pathsTried.push("oauth-api");
      const authText = await this._readAuthText();
      const token = authText ? parseOpenCodeAccessToken(authText) : null;
      if (authText && token) {
        const payload = await this._fetchUsage(token);
        if (payload) {
          return this._parsePayload(payload, parseOpenCodeAuthText(authText), pathsTried);
        }
      }
    } catch (error) {
      logWarn("opencode oauth-api failed", error);
    }

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
      "OpenCode: no data. Run `opencode auth login` or start OpenCode to refresh local state.",
      pathsTried,
    );
  }

  private async _readAuthText(): Promise<string | null> {
    const file = Gio.File.new_for_path(OPENCODE_AUTH_PATH);
    const [contents] = await file.load_contents_async(null);
    return new TextDecoder().decode(contents);
  }

  private async _fetchUsage(token: string): Promise<OpenCodeRateLimitsPayload | null> {
    if (!this._http) this._http = new HttpClient();
    try {
      const payload = await this._http.getJson(OPENCODE_USAGE_URL, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return normalizeOpenCodeOauthPayload(payload);
    } catch (error) {
      if (error instanceof TokenError) {
        logWarn("opencode oauth token rejected", error);
        return null;
      }
      if (error instanceof HttpError) {
        logWarn(`opencode oauth http ${error.statusCode}`, error);
        return null;
      }
      throw error;
    }
  }

  private async _readFromDisk(): Promise<OpenCodeDiskStats | null> {
    let totalCost = 0;
    let sessionsCount = 0;

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
      "Limit fields unavailable from OAuth API; showing disk telemetry only.",
    );
  }

  private _parsePayload(
    payload: OpenCodeRateLimitsPayload,
    tokenExpiresAt: number | null,
    pathsTried: readonly string[],
  ): ReaderResult {
    const rl = payload.rate_limits;
    if (!rl) {
      return this._errorResult("OpenCode: no rate_limits in payload.", pathsTried);
    }

    const fields: FieldResult[] = [];
    fields.push(...this._makeWindowFields("rolling", rl.rolling));
    fields.push(...this._makeWindowFields("weekly", rl.weekly));
    fields.push(this._makeField("total_cost", null, FieldStatus.UNAVAILABLE));
    fields.push(this._makeField("sessions_count", null, FieldStatus.UNAVAILABLE));
    fields.push(
      this._makeField(
        "token_expires_at",
        tokenExpiresAt,
        tokenExpiresAt !== null ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
      ),
    );

    return this._classifyResult(fields, pathsTried, "OpenCode");
  }
}
