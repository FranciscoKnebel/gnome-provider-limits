import Gio from "gi://Gio";
import GLib from "gi://GLib";

import type { FieldDef, FieldResult, ReaderResult } from "./base.js";
import { BaseReader, FieldStatus } from "./base.js";

const CLAUDE_CREDENTIALS_PATH = `${GLib.get_home_dir()}/.claude/.credentials.json`;
const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

const FIELDS: readonly FieldDef[] = [
  {
    name: "used_percent_session",
    label: "Used % (session 5h)",
    type: "percent",
    description: "Percentage used in the current 5-hour session window.",
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
    name: "used_percent_opus",
    label: "Used % (Opus weekly)",
    type: "percent",
    description: "Model-specific weekly usage for Opus.",
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

interface ClaudeUsagePayload {
  five_hour?: { used_percent?: number; reset_at?: number } | null;
  seven_day?: { used_percent?: number; reset_at?: number } | null;
  seven_day_sonnet?: { used_percent?: number; reset_at?: number } | null;
  seven_day_opus?: { used_percent?: number; reset_at?: number } | null;
  extra_usage?: { enabled?: boolean; disabled_reason?: string } | null;
}

export class ClaudeReader extends BaseReader {
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
      console.warn(`[claude] oauth-api failed: ${error}`);
    }

    // Path 2: CLI PTY fallback (ADR-0011)
    try {
      pathsTried.push("cli-pty");
      const payload = await this._readFromCli();
      if (payload) {
        return this._parsePayload(payload, pathsTried);
      }
    } catch (error) {
      console.warn(`[claude] cli-pty fallback failed: ${error}`);
    }

    return this._errorResult(
      "Claude: all paths failed. Run `claude` to refresh credentials.",
      pathsTried,
    );
  }

  private async _readAuthToken(): Promise<string | null> {
    const file = Gio.File.new_for_path(CLAUDE_CREDENTIALS_PATH);
    const [contents] = await file.load_contents_async(null);
    const text = new TextDecoder().decode(contents);
    const creds = JSON.parse(text);
    return creds?.access_token ?? creds?.token ?? null;
  }

  private async _fetchUsage(token: string): Promise<ClaudeUsagePayload | null> {
    // TODO: implement via helpers/http.ts with header
    // 'anthropic-beta: oauth-2025-04-20'
    void token;
    void CLAUDE_USAGE_URL;
    return null;
  }

  private async _readFromCli(): Promise<ClaudeUsagePayload | null> {
    // TODO: implement via helpers/subprocess.ts — invoke
    // `claude --allowed-tools ""` in PTY, send /usage, parse output
    return null;
  }

  private _parsePayload(payload: ClaudeUsagePayload, pathsTried: readonly string[]): ReaderResult {
    const fields: FieldResult[] = [];

    const session = payload.five_hour;
    const weekly = payload.seven_day;
    const sonnet = payload.seven_day_sonnet;
    const opus = payload.seven_day_opus;
    const extra = payload.extra_usage;

    fields.push(
      this._makeField(
        "used_percent_session",
        session?.used_percent ?? null,
        session ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
      ),
    );
    fields.push(
      this._makeField(
        "reset_at_session",
        session?.reset_at ?? null,
        session ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
      ),
    );
    fields.push(
      this._makeField(
        "used_percent_weekly",
        weekly?.used_percent ?? null,
        weekly ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
      ),
    );
    fields.push(
      this._makeField(
        "reset_at_weekly",
        weekly?.reset_at ?? null,
        weekly ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
      ),
    );
    fields.push(
      this._makeField(
        "used_percent_sonnet",
        sonnet?.used_percent ?? null,
        sonnet ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
      ),
    );
    fields.push(
      this._makeField(
        "used_percent_opus",
        opus?.used_percent ?? null,
        opus ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
      ),
    );
    fields.push(
      this._makeField(
        "has_extra_usage_enabled",
        extra?.enabled ?? null,
        extra ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
      ),
    );
    fields.push(
      this._makeField(
        "extra_usage_disabled_reason",
        extra?.disabled_reason ?? null,
        extra?.disabled_reason ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
      ),
    );

    const hasAny = fields.some((f) => f.status === FieldStatus.OK);
    if (!hasAny) {
      return this._errorResult("Claude: payload had no usable fields.", pathsTried);
    }

    const hasUnavailable = fields.some(
      (f) => f.status === FieldStatus.UNAVAILABLE || f.status === FieldStatus.ERROR,
    );

    return hasUnavailable
      ? this._partialResult(fields, pathsTried)
      : this._okResult(fields, pathsTried);
  }
}
