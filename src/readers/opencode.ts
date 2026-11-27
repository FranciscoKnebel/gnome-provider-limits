import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { HttpClient, TokenError } from "../helpers/http.js";
import { logWarn } from "../helpers/log.js";
import { resolveOpenCodeDataDir } from "../helpers/paths.js";
import { querySqlite } from "../helpers/sqlite.js";
import type { FieldResult, ReadOptions, ReaderResult } from "./base.js";
import { BaseReader, FieldStatus } from "./base.js";
import {
  type OpenCodeDbRow,
  type OpenCodeDiskTelemetry,
  type OpenCodeSourceFailure,
  type OpenCodeUsage,
  normalizeOpenCodeDbRow,
  normalizeOpenCodeUsagePayload,
  openCodePartialError,
  parseOpenCodeAuthKey,
  parseOpenCodeCredential,
} from "./opencodeParser.js";

const OPENCODE_ALL_PATHS_FAILED =
  "OpenCode: no usage data. Run `opencode auth login` and start OpenCode Go.";
const OPENCODE_CREDENTIAL_SQL =
  "SELECT value FROM credential WHERE integration_id = 'opencode' AND active = 1 ORDER BY time_updated DESC LIMIT 1";
const OPENCODE_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";

type OpenCodeCredentialSource = "v2-database" | "v1-auth-file" | "environment";

interface OpenCodeCredential {
  readonly source: OpenCodeCredentialSource;
  readonly token: string;
}

Gio._promisify(Gio.File.prototype, "load_contents_async", "load_contents_finish");

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value)) return null;
  const first: unknown = value[0];
  return isRecord(first) ? first : null;
}

function asDbRow(row: Record<string, unknown> | null): OpenCodeDbRow | null {
  if (!row) return null;
  return {
    sessions_count: typeof row.sessions_count === "number" ? row.sessions_count : null,
    total_cost: typeof row.total_cost === "number" ? row.total_cost : null,
  };
}

export class OpenCodeReader extends BaseReader<"opencode"> {
  private _http: HttpClient | null = null;
  private _cancellable: Gio.Cancellable | null = null;
  private _destroyed = false;

  override destroy(): void {
    this._destroyed = true;
    this._cancellable?.cancel();
    this._cancellable = null;
    this._http?.destroy();
    this._http = null;
    super.destroy();
  }

  async read(_options?: ReadOptions): Promise<ReaderResult> {
    this._cancellable?.cancel();
    const cancellable = new Gio.Cancellable();
    this._cancellable = cancellable;
    const pathsTried = ["usage-api", "disk"];

    const [usageOutcome, telemetryOutcome] = await Promise.allSettled([
      this._readUsage(cancellable),
      this._readDiskTelemetry(),
    ]);

    if (cancellable.is_cancelled()) {
      return this._errorResult("OpenCode: read cancelled.", pathsTried);
    }

    const failures: OpenCodeSourceFailure[] = [];
    let usage: OpenCodeUsage | null = null;
    let telemetry: OpenCodeDiskTelemetry | null = null;

    if (usageOutcome.status === "fulfilled") {
      usage = usageOutcome.value;
    } else {
      failures.push({ source: "usage-api", reason: usageOutcome.reason });
      logWarn("opencode usage-api failed", usageOutcome.reason);
    }

    if (telemetryOutcome.status === "fulfilled") {
      telemetry = telemetryOutcome.value;
    } else {
      failures.push({ source: "disk", reason: telemetryOutcome.reason });
      logWarn("opencode disk read failed", telemetryOutcome.reason);
    }

    if (!usage && !telemetry) {
      return this._lastGoodOrError(OPENCODE_ALL_PATHS_FAILED, pathsTried);
    }

    const lastError = openCodePartialError(usage !== null, telemetry !== null, failures);
    return this._finalizeResult(
      this._parseResult(usage, telemetry, pathsTried, lastError ?? undefined),
      pathsTried,
      OPENCODE_ALL_PATHS_FAILED,
    );
  }

  private _getHttp(): HttpClient | null {
    if (this._destroyed) return null;
    if (!this._http) this._http = new HttpClient();
    return this._http;
  }

  private _dataDir(): string {
    return resolveOpenCodeDataDir(
      { XDG_DATA_HOME: GLib.getenv("XDG_DATA_HOME") },
      GLib.get_home_dir(),
    );
  }

  private async _availableCredentials(
    cancellable: Gio.Cancellable | null,
  ): Promise<OpenCodeCredential[]> {
    const credentials: OpenCodeCredential[] = [];

    const databaseToken = await this._readV2Credential();
    if (databaseToken) credentials.push({ source: "v2-database", token: databaseToken });

    const authFileToken = await this._readV1Credential(cancellable);
    if (authFileToken) credentials.push({ source: "v1-auth-file", token: authFileToken });

    const environmentToken = GLib.getenv("OPENCODE_API_KEY")?.trim();
    if (environmentToken) credentials.push({ source: "environment", token: environmentToken });

    return credentials;
  }

  private async _readV2Credential(): Promise<string | null> {
    const dbPath = GLib.build_filenamev([this._dataDir(), "opencode.db"]);
    const rows = await querySqlite(dbPath, OPENCODE_CREDENTIAL_SQL, {
      timeoutSeconds: 5,
      cache: false,
    });
    if (!Array.isArray(rows)) return null;
    for (const row of rows) {
      if (!isRecord(row)) continue;
      const value = row.value;
      if (typeof value !== "string") continue;
      const token = parseOpenCodeCredential(value);
      if (token) return token;
    }
    return null;
  }

  private async _readV1Credential(cancellable: Gio.Cancellable | null): Promise<string | null> {
    try {
      const file = Gio.File.new_for_path(GLib.build_filenamev([this._dataDir(), "auth.json"]));
      const [contents] = await file.load_contents_async(cancellable);
      return parseOpenCodeAuthKey(new TextDecoder().decode(contents));
    } catch {
      return null;
    }
  }

  private async _readUsage(cancellable: Gio.Cancellable | null): Promise<OpenCodeUsage | null> {
    const credentials = await this._availableCredentials(cancellable);
    let firstError: unknown = null;

    for (const credential of credentials) {
      if (cancellable?.is_cancelled()) break;
      try {
        const usage = await this._fetchUsage(credential.token, cancellable);
        if (usage) return usage;
      } catch (error) {
        firstError ??= error;
        if (!(error instanceof TokenError)) throw error;
      }
    }

    if (firstError) throw firstError;
    return null;
  }

  private async _fetchUsage(
    key: string,
    cancellable: Gio.Cancellable | null,
  ): Promise<OpenCodeUsage | null> {
    const http = this._getHttp();
    if (!http) return null;

    const payload = await http.getJson(OPENCODE_USAGE_URL, {
      headers: { Authorization: `Bearer ${key}` },
      cancellable: cancellable ?? undefined,
    });
    return normalizeOpenCodeUsagePayload(payload);
  }

  private async _readDiskTelemetry(): Promise<OpenCodeDiskTelemetry | null> {
    const dbPath = GLib.build_filenamev([this._dataDir(), "opencode.db"]);
    const [sessions, costs] = await Promise.all([
      querySqlite(dbPath, "SELECT COUNT(*) AS sessions_count FROM session", { timeoutSeconds: 5 }),
      querySqlite(
        dbPath,
        `
        SELECT COALESCE(SUM(CASE WHEN json_extract(data, '$.role') = 'assistant'
          AND json_type(data, '$.cost') IN ('integer', 'real')
          AND json_extract(data, '$.cost') >= 0
          THEN json_extract(data, '$.cost') END), 0) AS total_cost
        FROM message WHERE json_valid(data)
      `,
        { timeoutSeconds: 5 },
      ),
    ]);
    const sessionRow = asDbRow(firstRecord(sessions));
    const costRow = asDbRow(firstRecord(costs));
    if (!sessionRow && !costRow) return null;
    return normalizeOpenCodeDbRow({
      sessions_count: sessionRow?.sessions_count ?? null,
      total_cost: costRow?.total_cost ?? null,
    });
  }

  private _parseResult(
    usage: OpenCodeUsage | null,
    telemetry: OpenCodeDiskTelemetry | null,
    pathsTried: readonly string[],
    lastError?: string,
  ): ReaderResult {
    const fields: FieldResult[] = [];

    const windows = [
      {
        names: {
          used: "used_percent_rolling",
          remaining: "remaining_percent_rolling",
          reset: "reset_at_rolling",
        },
        data: usage?.rolling,
      },
      {
        names: {
          used: "used_percent_weekly",
          remaining: "remaining_percent_weekly",
          reset: "reset_at_weekly",
        },
        data: usage?.weekly,
      },
      {
        names: {
          used: "used_percent_monthly",
          remaining: "remaining_percent_monthly",
          reset: "reset_at_monthly",
        },
        data: usage?.monthly,
      },
    ] as const;

    for (const { names, data } of windows) {
      fields.push(
        ...this._makeWindowFields(
          names,
          data ? { used_percent: data.percent, reset_at: data.reset_at } : null,
        ),
      );
    }

    const limitReached = usage ? windows.some(({ data }) => data?.status === "rate-limited") : null;
    fields.push(
      this._makeField(
        "limit_reached",
        limitReached,
        limitReached !== null ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
      ),
    );

    fields.push(
      this._makeField(
        "total_cost",
        telemetry?.totalCost ?? null,
        telemetry?.totalCost !== null && telemetry?.totalCost !== undefined
          ? FieldStatus.OK
          : FieldStatus.UNAVAILABLE,
      ),
    );
    fields.push(
      this._makeField(
        "sessions_count",
        telemetry?.sessionsCount ?? null,
        telemetry?.sessionsCount !== null && telemetry?.sessionsCount !== undefined
          ? FieldStatus.OK
          : FieldStatus.UNAVAILABLE,
      ),
    );
    fields.push(
      this._makeField(
        "usage_source",
        usage ? "opencode.ai usage API" : telemetry ? "local disk" : null,
        usage || telemetry ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
      ),
    );

    return this._classifyResult(fields, pathsTried, "OpenCode", lastError);
  }
}
