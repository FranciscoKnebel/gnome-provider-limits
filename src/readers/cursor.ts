import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { gettext as _ } from "../helpers/gettext.js";
import { HttpClient, TokenError } from "../helpers/http.js";
import { logWarn } from "../helpers/log.js";
import { expandHomePath, resolveCursorAuthPaths } from "../helpers/paths.js";
import {
  BaseReader,
  FieldStatus,
  type FieldDef,
  type FieldResult,
  type ReaderResult,
} from "./base.js";
import {
  CURSOR_BACKEND_URL,
  normalizeCursorUsagePayload,
  parseCursorAuth,
  parseCursorEnvAuth,
  parseCursorExchangeResponse,
  parseCursorPlanInfo,
  type CursorAuth,
  type CursorUsage,
} from "./cursorParser.js";
import { CURSOR_FIELDS } from "./fields.js";

const CURSOR_EXCHANGE_URL = `${CURSOR_BACKEND_URL}/auth/exchange_user_api_key`;
const CURSOR_USAGE_URL = `${CURSOR_BACKEND_URL}/aiserver.v1.DashboardService/GetCurrentPeriodUsage`;
const CURSOR_PLAN_URL = `${CURSOR_BACKEND_URL}/aiserver.v1.DashboardService/GetPlanInfo`;

Gio._promisify(Gio.File.prototype, "load_contents_async", "load_contents_finish");

function makeRpcHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "connect-protocol-version": "1",
    "x-cursor-client-type": "cli",
    Accept: "application/json",
  };
}

export class CursorReader extends BaseReader {
  private _http: HttpClient | null = null;
  private _destroyed = false;
  private _cancellable: Gio.Cancellable | null = null;

  override get FIELDS(): readonly FieldDef[] {
    return CURSOR_FIELDS;
  }

  override destroy(): void {
    this._destroyed = true;
    this._cancellable?.cancel();
    this._cancellable = null;
    this._http?.destroy();
    this._http = null;
    super.destroy();
  }

  private _assertAlive(): void {
    if (this._destroyed) throw new Error("Cursor Reader destroyed");
  }

  private async _readAuthFile(
    path: string,
    cancellable: Gio.Cancellable,
    warnIfMissing: boolean,
  ): Promise<CursorAuth | null> {
    try {
      const [contents] = await Gio.File.new_for_path(path).load_contents_async(cancellable);
      this._assertAlive();
      if (cancellable.is_cancelled()) return null;
      return parseCursorAuth(new TextDecoder().decode(contents));
    } catch (error) {
      this._assertAlive();
      if (cancellable.is_cancelled()) return null;
      const isNotFound =
        typeof (error as { matches?: unknown })?.matches === "function" &&
        (error as GLib.Error).matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND);
      if (warnIfMissing || !isNotFound) {
        logWarn("cursor auth file unavailable", error);
      }
      return null;
    }
  }

  private async _loadAuth(
    cancellable: Gio.Cancellable,
    pathsTried: string[],
  ): Promise<CursorAuth | null> {
    const home = GLib.get_home_dir();
    const customPath = this.settings.get_string("cursor-cli-path").trim();
    pathsTried.push("auth-file");

    if (customPath) {
      return this._readAuthFile(expandHomePath(customPath, home), cancellable, true);
    }

    const candidates = resolveCursorAuthPaths(
      {
        CURSOR_HOME: GLib.getenv("CURSOR_HOME"),
        XDG_CONFIG_HOME: GLib.getenv("XDG_CONFIG_HOME"),
      },
      home,
    );

    for (const candidate of candidates) {
      const auth = await this._readAuthFile(candidate, cancellable, false);
      if (cancellable.is_cancelled()) return null;
      if (auth) return auth;
    }

    const envAuth = parseCursorEnvAuth({
      CURSOR_AUTH_TOKEN: GLib.getenv("CURSOR_AUTH_TOKEN"),
      CURSOR_API_KEY: GLib.getenv("CURSOR_API_KEY"),
      CURSOR_BACKEND_URL: GLib.getenv("CURSOR_BACKEND_URL"),
      CURSOR_API_ENDPOINT: GLib.getenv("CURSOR_API_ENDPOINT"),
      CURSOR_AUTH_API_BASE_URL: GLib.getenv("CURSOR_AUTH_API_BASE_URL"),
    });
    if (envAuth) {
      pathsTried.push("auth-env");
    }
    return envAuth;
  }

  private async _exchangeApiKey(
    apiKey: string,
    cancellable: Gio.Cancellable,
    pathsTried: string[],
  ): Promise<string | null> {
    pathsTried.push("token-exchange");
    const response = await this._http!.postJson(
      CURSOR_EXCHANGE_URL,
      {},
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        cancellable,
        noRedirect: true,
      },
    );
    this._assertAlive();
    return parseCursorExchangeResponse(response);
  }

  async read(): Promise<ReaderResult> {
    this._assertAlive();
    this._cancellable?.cancel();
    const cancellable = new Gio.Cancellable();
    this._cancellable = cancellable;

    const pathsTried: string[] = [];
    const cancelledResult = () => this._errorResult("Cursor: read cancelled.", pathsTried);

    const auth = await this._loadAuth(cancellable, pathsTried);
    this._assertAlive();
    if (cancellable.is_cancelled()) return cancelledResult();

    if (!auth) {
      return this._lastGoodOrError(
        _("Cursor: no valid login. Run `cursor-agent login` to sign in."),
        pathsTried,
      );
    }

    if (!this._http) this._http = new HttpClient();

    let bearerToken = auth.accessToken;
    if (!bearerToken && auth.apiKey) {
      try {
        bearerToken = await this._exchangeApiKey(auth.apiKey, cancellable, pathsTried);
      } catch (error) {
        this._assertAlive();
        if (cancellable.is_cancelled()) return cancelledResult();
        logWarn("cursor token exchange failed", error);
        return this._lastGoodOrError(
          error instanceof TokenError
            ? _("Cursor: login rejected. Run `cursor-agent login` to sign in again.")
            : _("Cursor: subscription credits unavailable. Try again later."),
          pathsTried,
        );
      }
      if (cancellable.is_cancelled()) return cancelledResult();
      if (!bearerToken) {
        return this._lastGoodOrError(
          _("Cursor: login rejected. Run `cursor-agent login` to sign in again."),
          pathsTried,
        );
      }
    }

    pathsTried.push("usage-api");
    let payload: unknown;
    try {
      payload = await this._http.postJson(
        CURSOR_USAGE_URL,
        {},
        {
          headers: makeRpcHeaders(bearerToken!),
          cancellable,
          noRedirect: true,
        },
      );
    } catch (error) {
      this._assertAlive();
      if (cancellable.is_cancelled()) return cancelledResult();
      if (error instanceof TokenError && auth.accessToken && auth.apiKey) {
        try {
          const exchanged = await this._exchangeApiKey(auth.apiKey, cancellable, pathsTried);
          if (cancellable.is_cancelled()) return cancelledResult();
          if (!exchanged) {
            return this._lastGoodOrError(
              _("Cursor: login rejected. Run `cursor-agent login` to sign in again."),
              pathsTried,
            );
          }
          bearerToken = exchanged;
          payload = await this._http.postJson(
            CURSOR_USAGE_URL,
            {},
            {
              headers: makeRpcHeaders(bearerToken),
              cancellable,
              noRedirect: true,
            },
          );
        } catch (retryError) {
          this._assertAlive();
          if (cancellable.is_cancelled()) return cancelledResult();
          logWarn("cursor subscription usage request failed", retryError);
          return this._lastGoodOrError(
            retryError instanceof TokenError
              ? _("Cursor: login rejected. Run `cursor-agent login` to sign in again.")
              : _("Cursor: subscription credits unavailable. Try again later."),
            pathsTried,
          );
        }
      } else {
        logWarn("cursor subscription usage request failed", error);
        return this._lastGoodOrError(
          error instanceof TokenError
            ? _("Cursor: login rejected. Run `cursor-agent login` to sign in again.")
            : _("Cursor: subscription credits unavailable. Try again later."),
          pathsTried,
        );
      }
    }

    this._assertAlive();
    if (cancellable.is_cancelled()) return cancelledResult();
    const usage = normalizeCursorUsagePayload(payload);
    if (!usage) {
      return this._lastGoodOrError(
        _("Cursor: subscription credits unavailable. Try again later."),
        pathsTried,
      );
    }

    let plan: string | null = null;
    let planResetAt: number | null = null;
    pathsTried.push("plan-api");
    try {
      const planPayload = await this._http.postJson(
        CURSOR_PLAN_URL,
        {},
        {
          headers: makeRpcHeaders(bearerToken!),
          cancellable,
          noRedirect: true,
        },
      );
      this._assertAlive();
      if (cancellable.is_cancelled()) return cancelledResult();
      const info = parseCursorPlanInfo(planPayload);
      plan = info.planName;
      planResetAt = info.resetAt;
    } catch (error) {
      this._assertAlive();
      if (cancellable.is_cancelled()) return cancelledResult();
      logWarn("cursor subscription plan unavailable", error);
    }

    this._assertAlive();
    if (cancellable.is_cancelled()) return cancelledResult();
    const resetAtCredits = usage.resetAtCredits ?? planResetAt;
    const fields = this._fieldsFromUsage(usage, plan, resetAtCredits);

    return this._finalizeResult(
      this._classifyResult(fields, pathsTried, "Cursor"),
      pathsTried,
      _("Cursor: subscription credits unavailable. Try again later."),
    );
  }

  private _fieldsFromUsage(
    usage: CursorUsage,
    plan: string | null,
    resetAtCredits: number | null,
  ): FieldResult[] {
    const optionalField = <T>(name: string, value: T | null) =>
      this._makeField(name, value, value !== null ? FieldStatus.OK : FieldStatus.UNAVAILABLE);
    return [
      ...this._makeWindowFields("credits", {
        used_percent: usage.usedPercentCredits,
        reset_at: resetAtCredits,
      }),
      ...this._makePercentFieldPair("auto", usage.usedPercentAuto, FieldStatus.OK),
      ...this._makePercentFieldPair("api", usage.usedPercentApi, FieldStatus.OK),
      optionalField("remaining_credits", usage.remainingCredits),
      optionalField("spend_limit_used", usage.spendLimitUsed),
      optionalField("limit_reached", usage.limitReached),
      optionalField("plan_type", plan),
      this._makeField("usage_source", "api2.cursor.sh", FieldStatus.OK),
    ];
  }
}
