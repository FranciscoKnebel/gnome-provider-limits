import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { HttpClient } from "../helpers/http.js";
import { logWarn } from "../helpers/log.js";
import { resolveOpenCodeDataDir } from "../helpers/paths.js";
import { querySqlite } from "../helpers/sqlite.js";
import type { FieldDef, FieldResult, ReadOptions, ReaderResult } from "./base.js";
import { BaseReader, FieldStatus } from "./base.js";
import {
  type OpenCodeDbRow,
  type OpenCodeSourceFailure,
  type OpenCodeUsage,
  normalizeOpenCodeDbRow,
  normalizeOpenCodeUsagePayload,
  openCodePartialError,
  parseOpenCodeAuthKey,
} from "./opencodeParser.js";

const OPENCODE_ALL_PATHS_FAILED =
  "OpenCode: no usage data. Run `opencode auth login` and start OpenCode Go.";
const OPENCODE_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";

interface OpenCodeDiskTelemetry {
  totalCost: number;
  sessionsCount: number;
}

Gio._promisify(Gio.File.prototype, "load_contents_async", "load_contents_finish");

export const OPENCODE_FIELDS: readonly FieldDef[] = [
  {
    name: "used_percent_rolling",
    label: "Used % (rolling 5h)",
    type: "percent",
    description: "Percentage used in the provider-reported rolling 5-hour window.",
    defaultZone: "status",
  },
  {
    name: "remaining_percent_rolling",
    label: "Remaining % (rolling 5h)",
    type: "percent",
    description: "Percentage remaining in the provider-reported rolling 5-hour window.",
    defaultZone: "status",
  },
  {
    name: "reset_at_rolling",
    label: "Reset at (rolling)",
    type: "timestamp",
    description: "When the provider-reported rolling window resets.",
    defaultZone: "status",
  },
  {
    name: "used_percent_weekly",
    label: "Used % (weekly)",
    type: "percent",
    description: "Percentage used in the provider-reported weekly window.",
    defaultZone: "panel",
  },
  {
    name: "remaining_percent_weekly",
    label: "Remaining % (weekly)",
    type: "percent",
    description: "Percentage remaining in the provider-reported weekly window.",
    defaultZone: "panel",
  },
  {
    name: "reset_at_weekly",
    label: "Reset at (weekly)",
    type: "timestamp",
    description: "When the provider-reported weekly window resets.",
    defaultZone: "panel",
  },
  {
    name: "used_percent_monthly",
    label: "Used % (monthly)",
    type: "percent",
    description: "Percentage used in the provider-reported monthly window.",
    defaultZone: "panel",
  },
  {
    name: "remaining_percent_monthly",
    label: "Remaining % (monthly)",
    type: "percent",
    description: "Percentage remaining in the provider-reported monthly window.",
    defaultZone: "panel",
  },
  {
    name: "reset_at_monthly",
    label: "Reset at (monthly)",
    type: "timestamp",
    description: "When the provider-reported monthly window resets.",
    defaultZone: "panel",
  },
  {
    name: "limit_reached",
    label: "Limit reached",
    type: "bool",
    description: "Whether any OpenCode Go usage window is rate-limited.",
    defaultZone: "panel",
  },
  {
    name: "total_cost",
    label: "Total cost",
    type: "cost",
    description: "Total local session cost observed in opencode.db.",
    defaultZone: "panel",
  },
  {
    name: "sessions_count",
    label: "Sessions count",
    type: "count",
    description: "Total number of local sessions.",
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
  private _http: HttpClient | null = null;
  private _cancellable: Gio.Cancellable | null = null;
  private _destroyed = false;

  get FIELDS(): readonly FieldDef[] {
    return OPENCODE_FIELDS;
  }

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

  private async _readApiKey(cancellable: Gio.Cancellable | null): Promise<string | null> {
    let key: string | null = null;
    try {
      const file = Gio.File.new_for_path(GLib.build_filenamev([this._dataDir(), "auth.json"]));
      const [contents] = await file.load_contents_async(cancellable);
      key = parseOpenCodeAuthKey(new TextDecoder().decode(contents));
    } catch {
      key = null;
    }

    if (key) return key;

    const envKey = GLib.getenv("OPENCODE_API_KEY");
    return envKey && envKey.trim() ? envKey.trim() : null;
  }

  private async _readUsage(cancellable: Gio.Cancellable | null): Promise<OpenCodeUsage | null> {
    const key = await this._readApiKey(cancellable);
    if (!key) return null;
    return this._fetchUsage(key, cancellable);
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
    const rows = await querySqlite(
      GLib.build_filenamev([this._dataDir(), "opencode.db"]),
      "SELECT CAST(SUM(cost) AS REAL) AS total_cost, COUNT(*) AS sessions_count FROM session",
      { timeoutSeconds: 5 },
    );
    const firstRow = Array.isArray(rows) ? (rows[0] as OpenCodeDbRow | undefined) : undefined;
    if (!firstRow) return null;
    return normalizeOpenCodeDbRow(firstRow);
  }

  private _parseResult(
    usage: OpenCodeUsage | null,
    telemetry: OpenCodeDiskTelemetry | null,
    pathsTried: readonly string[],
    lastError?: string,
  ): ReaderResult {
    const fields: FieldResult[] = [];

    const windows = [
      { key: "rolling", data: usage?.rolling },
      { key: "weekly", data: usage?.weekly },
      { key: "monthly", data: usage?.monthly },
    ] as const;

    for (const { key, data } of windows) {
      fields.push(
        ...this._makeWindowFields(
          key,
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
        telemetry ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
      ),
    );
    fields.push(
      this._makeField(
        "sessions_count",
        telemetry?.sessionsCount ?? null,
        telemetry ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
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
