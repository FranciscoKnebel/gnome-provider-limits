import Gio from "gi://Gio";
import GLib from "gi://GLib";

import type { FieldDef, FieldResult, ReaderResult } from "./base.js";
import { BaseReader, FieldStatus } from "./base.js";

const CODEX_AUTH_PATH = `${GLib.get_home_dir()}/.codex/auth.json`;
const CODEX_LOGS_DB = `${GLib.get_home_dir()}/.codex/logs_2.sqlite`;

const FIELDS: readonly FieldDef[] = [
  {
    name: "used_percent_primary",
    label: "Used % (5h window)",
    type: "percent",
    description: "Percentage used in the primary 5-hour rolling window.",
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

interface CodexRateLimitWindow {
  used_percent?: number;
  window_minutes?: number;
  reset_after_seconds?: number;
  reset_at?: number;
}

interface CodexRateLimitsPayload {
  rate_limits?: {
    allowed?: boolean;
    limit_reached?: boolean;
    primary?: CodexRateLimitWindow | null;
    secondary?: CodexRateLimitWindow | null;
  };
  plan_type?: string;
  credits?: { balance?: string; has_credits?: boolean; unlimited?: boolean } | null;
}

export class CodexReader extends BaseReader {
  get FIELDS(): readonly FieldDef[] {
    return FIELDS;
  }

  async read(): Promise<ReaderResult> {
    const pathsTried: string[] = [];

    // Path 1: OAuth API (ADR-0011)
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
      console.warn(`[codex] oauth-api failed: ${error}`);
    }

    // Path 2: disk fallback (ADR-0011)
    try {
      pathsTried.push("disk");
      const payload = await this._readFromDisk();
      if (payload) {
        return this._parsePayload(payload, pathsTried);
      }
    } catch (error) {
      console.warn(`[codex] disk fallback failed: ${error}`);
    }

    return this._errorResult("Codex: all paths failed. Run `codex login`.", pathsTried);
  }

  private async _readAuthToken(): Promise<string | null> {
    const file = Gio.File.new_for_path(CODEX_AUTH_PATH);
    const [contents] = await file.load_contents_async(null);
    const text = new TextDecoder().decode(contents);
    const auth = JSON.parse(text);
    return auth?.tokens?.access_token ?? null;
  }

  private async _fetchUsage(token: string): Promise<CodexRateLimitsPayload | null> {
    // TODO: implement via helpers/http.ts (Soup.Session)
    void token;
    return null;
  }

  private async _readFromDisk(): Promise<CodexRateLimitsPayload | null> {
    // TODO: implement via helpers/sqlite.ts (python3 subprocess)
    void CODEX_LOGS_DB;
    return null;
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
    const primary = rl.primary;
    const secondary = rl.secondary;

    fields.push(
      this._makeField(
        "used_percent_primary",
        primary?.used_percent ?? null,
        primary ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
      ),
    );
    fields.push(
      this._makeField(
        "reset_at_primary",
        primary?.reset_at ?? null,
        primary ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
      ),
    );
    fields.push(
      this._makeField(
        "used_percent_secondary",
        secondary?.used_percent ?? null,
        secondary ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
      ),
    );
    fields.push(
      this._makeField(
        "reset_at_secondary",
        secondary?.reset_at ?? null,
        secondary ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
      ),
    );
    fields.push(
      this._makeField(
        "window_minutes_primary",
        primary?.window_minutes ?? null,
        primary ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
      ),
    );
    fields.push(
      this._makeField(
        "window_minutes_secondary",
        secondary?.window_minutes ?? null,
        secondary ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
      ),
    );
    fields.push(this._makeField("limit_reached", rl.limit_reached ?? null, FieldStatus.OK));
    fields.push(
      this._makeField(
        "plan_type",
        payload.plan_type ?? null,
        payload.plan_type ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
      ),
    );

    const hasAny = fields.some((f) => f.status === FieldStatus.OK);
    if (!hasAny) {
      return this._errorResult("Codex: payload had no usable fields.", pathsTried);
    }

    const hasUnavailable = fields.some(
      (f) => f.status === FieldStatus.UNAVAILABLE || f.status === FieldStatus.ERROR,
    );

    return hasUnavailable
      ? this._partialResult(fields, pathsTried)
      : this._okResult(fields, pathsTried);
  }
}
