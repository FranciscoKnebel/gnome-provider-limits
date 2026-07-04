import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { HttpClient, HttpError, TokenError } from "../helpers/http.js";
import { logWarn } from "../helpers/log.js";
import { querySqlite } from "../helpers/sqlite.js";
import type { FieldDef, FieldResult, ReaderResult } from "./base.js";
import { BaseReader, FieldStatus } from "./base.js";
import {
  codexWindowMinutes,
  type CodexLogRow,
  type CodexRateLimitsPayload,
  normalizeCodexOauthPayload,
  parseCodexLogBody,
} from "./codexParser.js";

const CODEX_AUTH_PATH = `${GLib.get_home_dir()}/.codex/auth.json`;
const CODEX_LOGS_DB = `${GLib.get_home_dir()}/.codex/logs_2.sqlite`;
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

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
];

Gio._promisify(Gio.File.prototype, "load_contents_async", "load_contents_finish");

export class CodexReader extends BaseReader {
  private _http: HttpClient | null = null;

  get FIELDS(): readonly FieldDef[] {
    return CODEX_FIELDS;
  }

  async read(): Promise<ReaderResult> {
    const pathsTried: string[] = [];

    // Path 1: OAuth API
    try {
      pathsTried.push("oauth-api");
      const token = await this._readAuthToken();
      if (token) {
        const payload = await this._fetchUsage(token);
        if (payload) {
          return this._parsePayload(payload, pathsTried);
        }
      }
    } catch (error) {
      logWarn("codex oauth-api failed", error);
    }

    // Path 2: disk fallback
    try {
      pathsTried.push("disk");
      const payload = await this._readFromDisk();
      if (payload) {
        return this._parsePayload(payload, pathsTried);
      }
    } catch (error) {
      logWarn("codex disk fallback failed", error);
    }

    return this._errorResult("Codex: all paths failed. Run `codex login`.", pathsTried);
  }

  override destroy(): void {
    this._http?.destroy();
    this._http = null;
    super.destroy();
  }

  private async _readAuthToken(): Promise<string | null> {
    const file = Gio.File.new_for_path(CODEX_AUTH_PATH);
    const [contents] = await file.load_contents_async(null);
    const text = new TextDecoder().decode(contents);
    const auth = JSON.parse(text) as unknown;
    if (!auth || typeof auth !== "object" || !("tokens" in auth)) return null;
    const tokens = auth.tokens;
    if (!tokens || typeof tokens !== "object" || !("access_token" in tokens)) return null;
    const token = tokens.access_token;
    return typeof token === "string" && token.trim() ? token : null;
  }

  private async _fetchUsage(token: string): Promise<CodexRateLimitsPayload | null> {
    if (!this._http) this._http = new HttpClient();
    try {
      const payload = await this._http.getJson(CODEX_USAGE_URL, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return normalizeCodexOauthPayload(payload);
    } catch (error) {
      // 401 means stale token; let the upper fallback chain try disk.
      if (error instanceof TokenError) {
        logWarn("codex oauth token rejected", error);
        return null;
      }
      if (error instanceof HttpError) {
        logWarn(`codex oauth http ${error.statusCode}`, error);
        return null;
      }
      throw error;
    }
  }

  private async _readFromDisk(): Promise<CodexRateLimitsPayload | null> {
    const rows = await querySqlite(
      CODEX_LOGS_DB,
      "SELECT feedback_log_body FROM logs WHERE feedback_log_body LIKE '%codex.rate_limits%' ORDER BY ts DESC LIMIT 1",
      { timeoutSeconds: 5 },
    );

    const firstRow = Array.isArray(rows) ? (rows[0] as CodexLogRow | undefined) : undefined;
    const body = firstRow?.feedback_log_body;
    if (!body) return null;

    return parseCodexLogBody(body);
  }

  private _parsePayload(
    payload: CodexRateLimitsPayload,
    pathsTried: readonly string[],
  ): ReaderResult {
    const rl = payload.rate_limits;
    if (!rl) {
      return this._errorResult("Codex: no rate_limits in payload.", pathsTried);
    }

    const fields: FieldResult[] = [];

    const windows = [
      { key: "primary", data: rl.primary },
      { key: "secondary", data: rl.secondary },
    ] as const;

    for (const { key, data } of windows) {
      fields.push(...this._makeWindowFields(key, data));
      const minutes = codexWindowMinutes(data ?? null);
      fields.push(
        this._makeField(
          `window_minutes_${key}`,
          minutes,
          typeof minutes === "number" && Number.isFinite(minutes)
            ? FieldStatus.OK
            : FieldStatus.UNAVAILABLE,
        ),
      );
    }

    fields.push(
      this._makeField(
        "limit_reached",
        rl.limit_reached ?? null,
        typeof rl.limit_reached === "boolean" ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
      ),
    );
    fields.push(
      this._makeField(
        "plan_type",
        payload.plan_type ?? null,
        payload.plan_type ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
      ),
    );

    return this._classifyResult(fields, pathsTried, "Codex");
  }
}
