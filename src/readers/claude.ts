import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { HttpClient, HttpError, TokenError } from "../helpers/http.js";
import { runSubprocess } from "../helpers/subprocess.js";
import type { FieldDef, FieldResult, ReaderResult } from "./base.js";
import { BaseReader, FieldStatus } from "./base.js";
import { type ClaudeUsagePayload, parseClaudeCliOutput } from "./claudeParser.js";

const CLAUDE_CREDENTIALS_PATH = `${GLib.get_home_dir()}/.claude/.credentials.json`;
const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

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

Gio._promisify(Gio.File.prototype, "load_contents_async", "load_contents_finish");

export class ClaudeReader extends BaseReader {
  private _http: HttpClient | null = null;

  get FIELDS(): readonly FieldDef[] {
    return CLAUDE_FIELDS;
  }

  override destroy(): void {
    this._http?.destroy();
    this._http = null;
    super.destroy();
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
    if (!this._http) this._http = new HttpClient();
    try {
      return await this._http.getJson<ClaudeUsagePayload>(CLAUDE_USAGE_URL, {
        headers: {
          Authorization: `Bearer ${token}`,
          "anthropic-beta": "oauth-2025-04-20",
        },
      });
    } catch (error) {
      if (error instanceof TokenError) {
        console.warn(`[claude] oauth token rejected: ${error.message}`);
        return null;
      }
      if (error instanceof HttpError) {
        console.warn(`[claude] oauth http ${error.statusCode}: ${error.message}`);
        return null;
      }
      throw error;
    }
  }

  private async _readFromCli(): Promise<ClaudeUsagePayload | null> {
    const cliPath = this.settings.get_string("claude-cli-path")?.trim() || "claude";
    const probeDir = GLib.build_filenamev([GLib.get_tmp_dir(), "provider-limits-claude-probe"]);
    GLib.mkdir_with_parents(probeDir, 0o700);

    // Drive the bare TUI: start with no tools, send /usage, then /exit.
    const inputLines = ["/usage", "/exit", ""].join("\n") + "\n";

    let result;
    try {
      result = await runSubprocess([cliPath, "--allowed-tools", ""], {
        input: inputLines,
        timeoutSeconds: 15,
        cwd: probeDir,
      });
    } catch (error) {
      console.warn(`[claude] cli probe failed: ${error}`);
      return null;
    }

    return parseClaudeCliOutput(result.stdout);
  }

  private _parsePayload(payload: ClaudeUsagePayload, pathsTried: readonly string[]): ReaderResult {
    const fields: FieldResult[] = [];

    const windows = [
      { key: "session", data: payload.five_hour },
      { key: "weekly", data: payload.seven_day },
    ] as const;

    for (const { key, data } of windows) {
      fields.push(...this._makeWindowFields(key, data));
    }

    const sonnet = payload.seven_day_sonnet;
    fields.push(
      this._makeField(
        "used_percent_sonnet",
        sonnet?.used_percent ?? null,
        sonnet ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
      ),
    );

    const opus = payload.seven_day_opus;
    fields.push(
      this._makeField(
        "used_percent_opus",
        opus?.used_percent ?? null,
        opus ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
      ),
    );

    const extra = payload.extra_usage;
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

    return this._classifyResult(fields, pathsTried, "Claude");
  }
}
