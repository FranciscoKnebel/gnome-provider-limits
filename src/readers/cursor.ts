import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { gettext as _ } from "../helpers/gettext.js";
import { HttpClient, TokenError } from "../helpers/http.js";
import { readCursorKeyringCredential } from "../helpers/keyring.js";
import { logWarn } from "../helpers/log.js";
import { expandHomePath, resolveCursorAuthPaths } from "../helpers/paths.js";
import { BaseReader, FieldStatus, type FieldResult, type ReaderResult } from "./base.js";
import {
  CURSOR_BACKEND_URL,
  normalizeCursorUsagePayload,
  parseCursorAuth,
  parseCursorAuthFile,
  parseCursorEnvAuth,
  parseCursorExchangeResponse,
  parseCursorPlanInfo,
  type CursorAuth,
  type CursorAuthFile,
  type CursorUsage,
} from "./cursorParser.js";

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

export class CursorReader extends BaseReader<"cursor"> {
  private _http: HttpClient | null = null;
  private _destroyed = false;
  private _cancellable: Gio.Cancellable | null = null;

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

  protected async _readKeyringCredential(cancellable: Gio.Cancellable): Promise<string | null> {
    return readCursorKeyringCredential(cancellable);
  }

  private async _readAuthFile(
    path: string,
    cancellable: Gio.Cancellable,
    warnIfMissing: boolean,
  ): Promise<CursorAuthFile | null> {
    try {
      const [contents] = await Gio.File.new_for_path(path).load_contents_async(cancellable);
      this._assertAlive();
      if (cancellable.is_cancelled()) return null;
      return parseCursorAuthFile(new TextDecoder().decode(contents));
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

    let storedInOsKeyring = false;

    if (customPath) {
      const file = await this._readAuthFile(expandHomePath(customPath, home), cancellable, true);
      if (cancellable.is_cancelled()) return null;
      if (!file) return null;
      if (file.auth) return file.auth;
      storedInOsKeyring = file.storedInOsKeyring;
    } else {
      const candidates = resolveCursorAuthPaths(
        {
          CURSOR_HOME: GLib.getenv("CURSOR_HOME"),
          XDG_CONFIG_HOME: GLib.getenv("XDG_CONFIG_HOME"),
        },
        home,
      );

      for (const candidate of candidates) {
        const file = await this._readAuthFile(candidate, cancellable, false);
        if (cancellable.is_cancelled()) return null;
        if (!file) continue;
        storedInOsKeyring ||= file.storedInOsKeyring;
        if (file.auth) return file.auth;
      }
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
      return envAuth;
    }
    if (!storedInOsKeyring) return null;

    pathsTried.push("auth-keyring");
    const secret = await this._readKeyringCredential(cancellable);
    this._assertAlive();
    if (cancellable.is_cancelled()) return null;
    if (!secret) return null;
    return parseCursorAuth(secret);
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
    return [
      ...this._makeWindowFields(
        {
          used: "used_percent_credits",
          remaining: "remaining_percent_credits",
          reset: "reset_at_credits",
        },
        {
          used_percent: usage.usedPercentCredits,
          reset_at: resetAtCredits,
        },
      ),
      ...this._makePercentFieldPair(
        { used: "used_percent_auto", remaining: "remaining_percent_auto" },
        usage.usedPercentAuto,
        FieldStatus.OK,
      ),
      ...this._makePercentFieldPair(
        { used: "used_percent_api", remaining: "remaining_percent_api" },
        usage.usedPercentApi,
        FieldStatus.OK,
      ),
      this._makeOptionalField("remaining_credits", usage.remainingCredits),
      this._makeOptionalField("spend_limit_used", usage.spendLimitUsed),
      this._makeOptionalField("limit_reached", usage.limitReached),
      this._makeOptionalField("plan_type", plan),
      this._makeField("usage_source", "api2.cursor.sh", FieldStatus.OK),
    ];
  }
}
