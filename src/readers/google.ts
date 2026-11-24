import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { gettext as _ } from "../helpers/gettext.js";
import { HttpClient, HttpError, TokenError } from "../helpers/http.js";
import { logWarn } from "../helpers/log.js";
import {
  expandHomePath,
  resolveGoogleAdcAuthPaths,
  resolveGooglePrimaryAuthPaths,
  type Env,
} from "../helpers/paths.js";
import { BaseReader, FieldStatus, type FieldDef, type ReaderResult } from "./base.js";
import {
  GOOGLE_CLOUDCODE_DAILY_URL,
  GOOGLE_OAUTH_TOKEN_URL,
  hasActiveGoogleUsage,
  hasCompleteActiveGoogleUsage,
  isAntigravityAuthPath,
  mergeGoogleUsage,
  normalizeGoogleAvailableModels,
  normalizeGoogleQuotaSummary,
  parseGoogleAuth,
  parseGoogleTierName,
  parseGoogleTokenResponse,
  resolveGoogleQuotaEndpoints,
  type GoogleAuth,
  type GoogleUsage,
} from "./googleParser.js";

const GOOGLE_USER_AGENT = "antigravity/hub/2.24.0 (aidev_client; os_type=linux; arch=x64)";
const LOAD_CODE_ASSIST_BODY = {
  metadata: {
    ideType: "IDE_UNSPECIFIED",
    platform: "PLATFORM_UNSPECIFIED",
    pluginType: "GEMINI",
  },
};

if (Gio.File?.prototype) {
  Gio._promisify(Gio.File.prototype, "load_contents_async", "load_contents_finish");
  Gio._promisify(Gio.File.prototype, "enumerate_children_async", "enumerate_children_finish");
  Gio._promisify(Gio.File.prototype, "query_info_async", "query_info_finish");
}
if (Gio.FileEnumerator?.prototype) {
  Gio._promisify(Gio.FileEnumerator.prototype, "next_files_async", "next_files_finish");
  Gio._promisify(Gio.FileEnumerator.prototype, "close_async", "close_finish");
}

import { GOOGLE_FIELDS } from "./fields.js";

function makeGoogleHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "User-Agent": GOOGLE_USER_AGENT,
    Accept: "application/json",
  };
}

function hostFromEndpoint(endpoint: string): string {
  return endpoint.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

function pushOnce(list: string[], entry: string): void {
  if (!list.includes(entry)) list.push(entry);
}

interface CandidateQuotaOutcome {
  auth: GoogleAuth;
  accessToken: string;
  usage: GoogleUsage;
  endpointUsed: string;
}

export class GoogleReader extends BaseReader {
  private _http: HttpClient | null = null;
  private _destroyed = false;
  private _cancellable: Gio.Cancellable | null = null;

  get FIELDS(): readonly FieldDef[] {
    return GOOGLE_FIELDS;
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
    if (this._destroyed) throw new Error("Google Reader destroyed");
  }

  private async _discoverT3AntigravityTokenPaths(
    home: string,
    cancellable: Gio.Cancellable,
  ): Promise<string[]> {
    const rootPath = GLib.build_filenamev([home, ".t3", "userdata", "providers", "antigravity"]);
    const rootDir = Gio.File.new_for_path(rootPath);
    if (typeof rootDir.enumerate_children_async !== "function") return [];

    const priority = GLib.PRIORITY_DEFAULT ?? 0;
    const flags = Gio.FileQueryInfoFlags?.NOFOLLOW_SYMLINKS ?? Gio.FileQueryInfoFlags?.NONE ?? 0;
    const dirType = Gio.FileType?.DIRECTORY ?? 2;
    const entries: { path: string; mtime: number }[] = [];

    try {
      const enumerator = await rootDir.enumerate_children_async(
        "standard::name,standard::type",
        flags,
        priority,
        cancellable,
      );
      this._assertAlive();
      try {
        while (!cancellable.is_cancelled()) {
          const infos = await enumerator.next_files_async(32, priority, cancellable);
          this._assertAlive();
          if (cancellable.is_cancelled() || infos.length === 0) break;

          for (const info of infos) {
            if (info.get_file_type() !== dirType) continue;
            const tokenPath = GLib.build_filenamev([
              rootPath,
              info.get_name(),
              "antigravity-acp",
              "acp_token.json",
            ]);
            const tokenFile = Gio.File.new_for_path(tokenPath);
            try {
              const tokenInfo = await tokenFile.query_info_async(
                "time::modified",
                flags,
                priority,
                cancellable,
              );
              this._assertAlive();
              if (cancellable.is_cancelled()) break;
              const mtime = tokenInfo.get_modification_date_time()?.to_unix() ?? 0;
              entries.push({ path: tokenPath, mtime });
            } catch {
              this._assertAlive();
              if (cancellable.is_cancelled()) break;
            }
          }
        }
      } finally {
        try {
          await enumerator.close_async(priority, null);
        } catch {
          // Ignore close errors during cleanup.
        }
        this._assertAlive();
      }
    } catch {
      this._assertAlive();
      return [];
    }

    if (cancellable.is_cancelled()) return [];
    return entries.toSorted((a, b) => b.mtime - a.mtime).map((e) => e.path);
  }

  private async _readAuthFile(
    path: string,
    cancellable: Gio.Cancellable,
    warnIfMissing: boolean,
  ): Promise<GoogleAuth | null> {
    try {
      const [contents] = await Gio.File.new_for_path(path).load_contents_async(cancellable);
      this._assertAlive();
      if (cancellable.is_cancelled()) return null;
      return parseGoogleAuth(new TextDecoder().decode(contents));
    } catch (error) {
      this._assertAlive();
      if (cancellable.is_cancelled()) return null;
      const isNotFound =
        typeof (error as { matches?: unknown })?.matches === "function" &&
        (error as GLib.Error).matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND);
      if (warnIfMissing || !isNotFound) {
        logWarn("google auth file unavailable", error);
      }
      return null;
    }
  }

  private async _refreshAccessToken(
    auth: GoogleAuth,
    cancellable: Gio.Cancellable,
    pathsTried: string[],
  ): Promise<string | null> {
    if (!auth.refreshToken || !auth.clientId || !auth.clientSecret) return null;
    pushOnce(pathsTried, "oauth-refresh");
    let response: unknown;
    try {
      response = await this._http!.postForm(
        GOOGLE_OAUTH_TOKEN_URL,
        {
          client_id: auth.clientId,
          client_secret: auth.clientSecret,
          refresh_token: auth.refreshToken,
          grant_type: "refresh_token",
        },
        {
          headers: { Accept: "application/json" },
          cancellable,
          noRedirect: true,
        },
      );
    } catch (error) {
      if (
        error instanceof HttpError &&
        error.statusCode === 400 &&
        typeof error.payload === "object" &&
        error.payload !== null &&
        "error" in error.payload &&
        error.payload.error === "invalid_grant"
      ) {
        throw new TokenError("Google OAuth refresh grant rejected", 400);
      }
      throw error;
    }
    this._assertAlive();
    if (cancellable.is_cancelled()) return null;
    return parseGoogleTokenResponse(response);
  }

  private async _fetchEndpointUsage(
    endpoint: string,
    token: string,
    projectId: string | null,
    cancellable: Gio.Cancellable,
  ): Promise<GoogleUsage | null> {
    const headers = makeGoogleHeaders(token);
    const body = projectId ? { project: projectId } : {};
    const requestedAtMs = Date.now();

    try {
      const summaryRaw = await this._http!.postJson(
        `${endpoint}/v1internal:retrieveUserQuotaSummary`,
        body,
        {
          headers,
          cancellable,
          noRedirect: true,
        },
      );
      this._assertAlive();
      if (cancellable.is_cancelled()) return null;
      const summary = normalizeGoogleQuotaSummary(summaryRaw, requestedAtMs);
      if (summary) return summary;
    } catch (error) {
      this._assertAlive();
      if (cancellable.is_cancelled()) return null;
      if (error instanceof TokenError && error.statusCode === 401) throw error;
      logWarn("google quota summary request failed", error);
    }

    const modelsRaw = await this._http!.postJson(
      `${endpoint}/v1internal:fetchAvailableModels`,
      body,
      {
        headers,
        cancellable,
        noRedirect: true,
      },
    );
    this._assertAlive();
    if (cancellable.is_cancelled()) return null;
    return normalizeGoogleAvailableModels(modelsRaw, requestedAtMs);
  }

  private async _queryQuotaWithToken(
    token: string,
    projectId: string | null,
    endpoints: readonly [string, string],
    cancellable: Gio.Cancellable,
  ): Promise<{ usage: GoogleUsage | null; endpointUsed: string }> {
    let combined: GoogleUsage | null = null;
    let endpointUsed = endpoints[0];
    let lastError: unknown = null;

    for (const endpoint of endpoints) {
      try {
        const current = await this._fetchEndpointUsage(endpoint, token, projectId, cancellable);
        if (cancellable.is_cancelled()) return { usage: null, endpointUsed };
        if (current) {
          if (!combined || (!hasActiveGoogleUsage(combined) && hasActiveGoogleUsage(current))) {
            endpointUsed = endpoint;
          }
          combined = mergeGoogleUsage(combined, current);
          if (
            hasCompleteActiveGoogleUsage(combined) ||
            (endpoint === GOOGLE_CLOUDCODE_DAILY_URL && hasActiveGoogleUsage(combined))
          ) {
            break;
          }
        }
      } catch (error) {
        this._assertAlive();
        if (cancellable.is_cancelled()) return { usage: null, endpointUsed };
        if (error instanceof TokenError && error.statusCode === 401 && !combined) {
          throw error;
        }
        lastError = error;
        if (!combined) {
          logWarn("google quota endpoint failed", error);
        }
      }
    }

    if (!combined && lastError) throw lastError;
    return { usage: combined, endpointUsed };
  }

  async read(): Promise<ReaderResult> {
    this._assertAlive();
    this._cancellable?.cancel();
    const cancellable = new Gio.Cancellable();
    this._cancellable = cancellable;
    const pathsTried: string[] = [];
    const cancelledResult = () => this._errorResult("Google: read cancelled.", pathsTried);

    try {
      const home = GLib.get_home_dir();
      const customPath = this.settings.get_string("google-cli-path").trim();
      pathsTried.push("auth-file");

      const env: Env = {
        XDG_CONFIG_HOME: GLib.getenv("XDG_CONFIG_HOME"),
        GEMINI_CLI_HOME: GLib.getenv("GEMINI_CLI_HOME"),
        GEMINI_HOME: GLib.getenv("GEMINI_HOME"),
        CLOUDSDK_CONFIG: GLib.getenv("CLOUDSDK_CONFIG"),
        GOOGLE_APPLICATION_CREDENTIALS: GLib.getenv("GOOGLE_APPLICATION_CREDENTIALS"),
        ANTIGRAVITY_ACP_TOKEN_PATH: GLib.getenv("ANTIGRAVITY_ACP_TOKEN_PATH"),
      };

      const seenPaths = new Set<string>();
      let sawValidAuthFile = false;
      let sawTokenRejection = false;
      let fatalQuotaError: unknown = null;
      let resolved: CandidateQuotaOutcome | null = null;

      const tryCandidatePaths = async (
        candidates: readonly string[],
        warnIfMissing: boolean,
      ): Promise<boolean> => {
        for (const candidate of candidates) {
          if (seenPaths.has(candidate)) continue;
          seenPaths.add(candidate);

          const auth = await this._readAuthFile(candidate, cancellable, warnIfMissing);
          if (cancellable.is_cancelled()) return true;
          if (!auth) continue;

          sawValidAuthFile = true;
          if (!this._http) this._http = new HttpClient();

          let accessToken = auth.accessToken;
          if (!accessToken) {
            try {
              accessToken = await this._refreshAccessToken(auth, cancellable, pathsTried);
            } catch (error) {
              this._assertAlive();
              if (cancellable.is_cancelled()) return true;
              logWarn("google oauth token refresh failed", error);
              if (error instanceof TokenError) {
                sawTokenRejection = true;
                continue;
              }
              fatalQuotaError = error;
              return true;
            }
            if (cancellable.is_cancelled()) return true;
            if (!accessToken) {
              sawTokenRejection = true;
              continue;
            }
          }

          const endpoints = resolveGoogleQuotaEndpoints(
            auth.projectId,
            isAntigravityAuthPath(candidate),
          );
          pushOnce(pathsTried, "quota-api");

          let usage: GoogleUsage | null = null;
          let endpointUsed: string = endpoints[0];
          try {
            const outcome = await this._queryQuotaWithToken(
              accessToken,
              auth.projectId,
              endpoints,
              cancellable,
            );
            if (cancellable.is_cancelled()) return true;
            usage = outcome.usage;
            endpointUsed = outcome.endpointUsed;
          } catch (error) {
            this._assertAlive();
            if (cancellable.is_cancelled()) return true;
            if (error instanceof TokenError && auth.accessToken && auth.refreshToken) {
              try {
                const refreshed = await this._refreshAccessToken(auth, cancellable, pathsTried);
                if (cancellable.is_cancelled()) return true;
                if (!refreshed) {
                  sawTokenRejection = true;
                  continue;
                }
                accessToken = refreshed;
                const retryOutcome = await this._queryQuotaWithToken(
                  accessToken,
                  auth.projectId,
                  endpoints,
                  cancellable,
                );
                if (cancellable.is_cancelled()) return true;
                usage = retryOutcome.usage;
                endpointUsed = retryOutcome.endpointUsed;
              } catch (retryError) {
                this._assertAlive();
                if (cancellable.is_cancelled()) return true;
                logWarn("google quota request failed", retryError);
                if (retryError instanceof TokenError) {
                  sawTokenRejection = true;
                  continue;
                }
                fatalQuotaError = retryError;
                return true;
              }
            } else {
              logWarn("google quota request failed", error);
              if (error instanceof TokenError) {
                sawTokenRejection = true;
                continue;
              }
              fatalQuotaError = error;
              return true;
            }
          }

          if (usage) {
            resolved = { auth, accessToken, usage, endpointUsed };
            return true;
          }
        }
        return false;
      };

      if (customPath) {
        await tryCandidatePaths([expandHomePath(customPath, home)], true);
      } else {
        let done = await tryCandidatePaths(resolveGooglePrimaryAuthPaths(env, home), false);
        if (!done && !cancellable.is_cancelled()) {
          const t3Paths = await this._discoverT3AntigravityTokenPaths(home, cancellable);
          if (!cancellable.is_cancelled() && t3Paths.length > 0) {
            done = await tryCandidatePaths(t3Paths, false);
          }
        }
        if (!done && !cancellable.is_cancelled()) {
          await tryCandidatePaths(resolveGoogleAdcAuthPaths(env, home), false);
        }
      }

      this._assertAlive();
      if (cancellable.is_cancelled()) return cancelledResult();

      if (!resolved) {
        if (!sawValidAuthFile) {
          return this._lastGoodOrError(
            _("Google: no valid login. Sign in with Gemini CLI or Antigravity."),
            pathsTried,
          );
        }
        if (sawTokenRejection && !fatalQuotaError) {
          return this._lastGoodOrError(
            _("Google: login rejected. Sign in again with Gemini CLI or Antigravity."),
            pathsTried,
          );
        }
        return this._lastGoodOrError(
          _("Google: subscription quota unavailable. Try again later."),
          pathsTried,
        );
      }

      const { auth, accessToken, usage, endpointUsed } = resolved as CandidateQuotaOutcome;

      let plan: string | null = null;
      pushOnce(pathsTried, "tier-api");
      try {
        const tierPayload = await this._http!.postJson(
          `${endpointUsed}/v1internal:loadCodeAssist`,
          auth.projectId
            ? { ...LOAD_CODE_ASSIST_BODY, cloudaicompanionProject: auth.projectId }
            : LOAD_CODE_ASSIST_BODY,
          {
            headers: makeGoogleHeaders(accessToken),
            cancellable,
            noRedirect: true,
          },
        );
        this._assertAlive();
        if (cancellable.is_cancelled()) return cancelledResult();
        plan = parseGoogleTierName(tierPayload);
      } catch (error) {
        this._assertAlive();
        if (cancellable.is_cancelled()) return cancelledResult();
        logWarn("google subscription tier unavailable", error);
      }

      this._assertAlive();
      if (cancellable.is_cancelled()) return cancelledResult();

      const optionalField = <T>(name: string, value: T | null) =>
        this._makeField(name, value, value !== null ? FieldStatus.OK : FieldStatus.UNAVAILABLE);

      const fields = [
        ...this._makeWindowFields("session", {
          used_percent: usage.session?.usedPercent ?? null,
          reset_at: usage.session?.resetAt ?? null,
        }),
        ...this._makeWindowFields("weekly", {
          used_percent: usage.weekly?.usedPercent ?? null,
          reset_at: usage.weekly?.resetAt ?? null,
        }),
        ...this._makeWindowFields("3p_session", {
          used_percent: usage.thirdPartySession?.usedPercent ?? null,
          reset_at: usage.thirdPartySession?.resetAt ?? null,
        }),
        ...this._makeWindowFields("3p_weekly", {
          used_percent: usage.thirdPartyWeekly?.usedPercent ?? null,
          reset_at: usage.thirdPartyWeekly?.resetAt ?? null,
        }),
        optionalField("limit_reached", usage.limitReached),
        optionalField("plan_type", plan),
        this._makeField("usage_source", hostFromEndpoint(endpointUsed), FieldStatus.OK),
      ];

      return this._finalizeResult(
        this._classifyResult(fields, pathsTried, "Google"),
        pathsTried,
        _("Google: subscription quota unavailable. Try again later."),
      );
    } finally {
      if (this._cancellable === cancellable) {
        this._cancellable = null;
      }
    }
  }
}
