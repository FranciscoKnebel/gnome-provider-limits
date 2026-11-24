import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { HttpClient, HttpError, TokenError } from "../helpers/http.js";
import { logWarn } from "../helpers/log.js";
import { resolveClaudeConfigDir } from "../helpers/paths.js";
import { runSubprocess } from "../helpers/subprocess.js";
import type { FieldResult, ReadOptions, ReaderResult } from "./base.js";
import { BaseReader, FieldStatus } from "./base.js";
import {
  type ClaudeUsagePayload,
  normalizeClaudeUsagePayload,
  parseClaudeCliOutput,
} from "./claudeParser.js";
import {
  type ClaudeAuth,
  isCredentialExpired,
  nextCliFailureAt,
  parseClaudeCredentials,
  shouldProbeCli,
} from "./claudeProbe.js";

const CLAUDE_ALL_PATHS_FAILED = "Claude: all paths failed. Run `claude` to refresh credentials.";
const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLI_PROBE_TIMEOUT_SECONDS = 15;

Gio._promisify(Gio.File.prototype, "load_contents_async", "load_contents_finish");

export class ClaudeReader extends BaseReader<"claude"> {
  private _http: HttpClient | null = null;
  private _cancellable: Gio.Cancellable | null = null;
  private _destroyed = false;
  private _lastCliFailureAt: number | null = null;

  override destroy(): void {
    this._destroyed = true;
    this._cancellable?.cancel();
    this._cancellable = null;
    this._http?.destroy();
    this._http = null;
    super.destroy();
  }

  async read(options?: ReadOptions): Promise<ReaderResult> {
    this._cancellable?.cancel();
    const cancellable = new Gio.Cancellable();
    this._cancellable = cancellable;
    const pathsTried: string[] = [];

    // Path 1: OAuth API
    try {
      pathsTried.push("oauth-api");
      const auth = await this._readAuthToken(cancellable);
      if (auth && !isCredentialExpired(auth.expiresAtMs, Date.now())) {
        const payload = await this._fetchUsage(auth.token, cancellable);
        if (payload) {
          return this._finalizeResult(
            this._parsePayload(payload, pathsTried),
            pathsTried,
            CLAUDE_ALL_PATHS_FAILED,
          );
        }
      }
    } catch (error) {
      logWarn("claude oauth-api failed", error);
    }

    if (cancellable.is_cancelled()) {
      return this._errorResult("Claude: read cancelled.", pathsTried);
    }

    // Path 2: CLI PTY fallback
    const force = options?.force ?? false;
    if (
      shouldProbeCli({
        now: Date.now(),
        lastFailureAt: this._lastCliFailureAt,
        force,
      })
    ) {
      try {
        pathsTried.push("cli-pty");
        const payload = await this._readFromCli(cancellable);
        this._lastCliFailureAt = nextCliFailureAt({
          payload,
          cancelled: cancellable.is_cancelled(),
          now: Date.now(),
          previous: this._lastCliFailureAt,
        });
        if (payload) {
          return this._finalizeResult(
            this._parsePayload(payload, pathsTried),
            pathsTried,
            CLAUDE_ALL_PATHS_FAILED,
          );
        }
      } catch (error) {
        this._lastCliFailureAt = nextCliFailureAt({
          payload: null,
          cancelled: cancellable.is_cancelled(),
          now: Date.now(),
          previous: this._lastCliFailureAt,
        });
        logWarn("claude cli-pty fallback failed", error);
      }
    }

    if (cancellable.is_cancelled()) {
      return this._errorResult("Claude: read cancelled.", pathsTried);
    }

    return this._lastGoodOrError(CLAUDE_ALL_PATHS_FAILED, pathsTried);
  }

  private _credentialsPath(): string {
    return GLib.build_filenamev([
      resolveClaudeConfigDir(
        { CLAUDE_CONFIG_DIR: GLib.getenv("CLAUDE_CONFIG_DIR") },
        GLib.get_home_dir(),
      ),
      ".credentials.json",
    ]);
  }

  private _getHttp(): HttpClient | null {
    if (this._destroyed) return null;
    if (!this._http) this._http = new HttpClient();
    return this._http;
  }

  private async _readAuthToken(cancellable: Gio.Cancellable | null): Promise<ClaudeAuth | null> {
    const file = Gio.File.new_for_path(this._credentialsPath());
    const [contents] = await file.load_contents_async(cancellable);
    const text = new TextDecoder().decode(contents);
    const creds = JSON.parse(text) as unknown;
    return parseClaudeCredentials(creds);
  }

  private async _fetchUsage(
    token: string,
    cancellable: Gio.Cancellable | null,
  ): Promise<ClaudeUsagePayload | null> {
    const http = this._getHttp();
    if (!http) return null;

    try {
      const payload = await http.getJson(CLAUDE_USAGE_URL, {
        headers: {
          Authorization: `Bearer ${token}`,
          "anthropic-beta": "oauth-2025-04-20",
        },
        cancellable: cancellable ?? undefined,
      });
      return normalizeClaudeUsagePayload(payload);
    } catch (error) {
      if (error instanceof TokenError) {
        logWarn("claude oauth token rejected", error);
        return null;
      }
      if (error instanceof HttpError) {
        logWarn(`claude oauth http ${error.statusCode}`, error);
        return null;
      }
      throw error;
    }
  }

  private async _readFromCli(
    cancellable: Gio.Cancellable | null,
  ): Promise<ClaudeUsagePayload | null> {
    const cliPath = this.settings.get_string("claude-cli-path")?.trim() || "claude";

    let probeDir: string | null;
    try {
      probeDir = GLib.Dir.make_tmp("provider-limits-claude-XXXXXX");
    } catch (error) {
      logWarn("claude cli probe temp dir failed", error);
      return null;
    }
    if (!probeDir) return null;

    // Drive the bare TUI: start with no tools, send /usage, then /exit.
    const inputLines = ["/usage", "/exit", ""].join("\n") + "\n";

    try {
      const result = await runSubprocess([cliPath, "--allowed-tools", ""], {
        input: inputLines,
        timeoutSeconds: CLI_PROBE_TIMEOUT_SECONDS,
        cwd: probeDir,
        env: { LC_ALL: "C" },
        cancellable: cancellable ?? undefined,
      });
      return parseClaudeCliOutput(result.stdout);
    } finally {
      this._removeProbeDir(probeDir);
    }
  }

  private _removeProbeDir(path: string): void {
    try {
      const dir = Gio.File.new_for_path(path);
      const enumerator = dir.enumerate_children(
        "standard::name,standard::type",
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
        null,
      );
      let info: Gio.FileInfo | null;
      while ((info = enumerator.next_file(null)) !== null) {
        const child = dir.get_child(info.get_name());
        if (info.get_file_type() === Gio.FileType.DIRECTORY) {
          this._removeProbeDir(child.get_path() ?? path);
        } else {
          child.delete(null);
        }
      }
      enumerator.close(null);
      GLib.rmdir(path);
    } catch (error) {
      logWarn("claude cli probe cleanup failed", error);
    }
  }

  private _parsePayload(payload: ClaudeUsagePayload, pathsTried: readonly string[]): ReaderResult {
    const fields: FieldResult[] = [];

    const windows = [
      {
        names: {
          used: "used_percent_session",
          remaining: "remaining_percent_session",
          reset: "reset_at_session",
        },
        data: payload.five_hour,
      },
      {
        names: {
          used: "used_percent_weekly",
          remaining: "remaining_percent_weekly",
          reset: "reset_at_weekly",
        },
        data: payload.seven_day,
      },
    ] as const;

    for (const { names, data } of windows) {
      fields.push(...this._makeWindowFields(names, data));
    }

    const sonnet = payload.seven_day_sonnet;
    fields.push(
      ...this._makePercentFieldPair(
        {
          used: "used_percent_sonnet",
          remaining: "remaining_percent_sonnet",
        },
        sonnet?.used_percent,
        sonnet ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
      ),
    );

    const opus = payload.seven_day_opus;
    fields.push(
      ...this._makePercentFieldPair(
        { used: "used_percent_opus", remaining: "remaining_percent_opus" },
        opus?.used_percent,
        opus ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
      ),
    );

    const extra = payload.extra_usage;
    fields.push(
      this._makeField(
        "has_extra_usage_enabled",
        extra?.enabled ?? null,
        typeof extra?.enabled === "boolean" ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
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
