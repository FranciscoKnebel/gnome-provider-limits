import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { gettext as _ } from "../helpers/gettext.js";
import { HttpClient, TokenError } from "../helpers/http.js";
import { logWarn } from "../helpers/log.js";
import { BaseReader, FieldStatus, type FieldDef, type ReaderResult } from "./base.js";
import { normalizeGrokUsagePayload, parseGrokAuth } from "./grokParser.js";

const GROK_BASE_URL = "https://cli-chat-proxy.grok.com/v1";

Gio._promisify(Gio.File.prototype, "load_contents_async", "load_contents_finish");

export const GROK_FIELDS: readonly FieldDef[] = [
  {
    name: "used_percent_credits",
    label: "Used % (credits)",
    type: "percent",
    description: "Provider-reported subscription credit usage, not an API spending limit.",
    defaultZone: "status",
  },
  {
    name: "remaining_percent_credits",
    label: "Remaining % (credits)",
    type: "percent",
    defaultZone: "status",
  },
  {
    name: "reset_at_credits",
    label: "Reset at (credits)",
    type: "timestamp",
    defaultZone: "status",
  },
  {
    name: "prepaid_balance",
    label: "Purchased credits",
    type: "cost",
    description: "Purchased credit balance in USD, separate from subscription credit usage.",
    defaultZone: "panel",
  },
  {
    name: "unified_billing",
    label: "Shared subscription credits",
    type: "bool",
    description: "Whether Grok reports a shared subscription credit pool.",
    defaultZone: "panel",
  },
  { name: "plan_type", label: "Plan type", type: "text", defaultZone: "panel" },
  { name: "usage_source", label: "Usage source", type: "text", defaultZone: "panel" },
];

export class GrokReader extends BaseReader {
  private _http: HttpClient | null = null;
  private _destroyed = false;
  private _cancellable = new Gio.Cancellable();

  get FIELDS(): readonly FieldDef[] {
    return GROK_FIELDS;
  }

  override destroy(): void {
    this._destroyed = true;
    this._cancellable.cancel();
    this._http?.destroy();
    this._http = null;
    super.destroy();
  }

  private _assertAlive(): void {
    if (this._destroyed) throw new Error("Grok Reader destroyed");
  }

  async read(): Promise<ReaderResult> {
    this._assertAlive();
    const pathsTried = ["auth-file"];
    let auth = null;
    try {
      const customPath = this.settings.get_string("grok-cli-path").trim();
      const home = GLib.getenv("GROK_HOME")?.trim() || `${GLib.get_home_dir()}/.grok`;
      const path = customPath || `${home}/auth.json`;
      const expandedPath = path.startsWith("~/") ? `${GLib.get_home_dir()}/${path.slice(2)}` : path;
      const [contents] = await Gio.File.new_for_path(expandedPath).load_contents_async(
        this._cancellable,
      );
      auth = parseGrokAuth(new TextDecoder().decode(contents));
    } catch {
      logWarn("grok auth file unavailable");
    }

    this._assertAlive();
    if (!auth) {
      return this._lastGoodOrError(
        _("Grok: no valid login. Run `grok login` to sign in."),
        pathsTried,
      );
    }

    if (!this._http) this._http = new HttpClient();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${auth.token}`,
      "x-xai-token-auth": "xai-grok-cli",
      Accept: "application/json",
    };
    if (auth.userId) headers["x-userid"] = auth.userId;

    pathsTried.push("credits-api");
    let payload: unknown;
    try {
      payload = await this._http.getJson(`${GROK_BASE_URL}/billing?format=credits`, { headers });
    } catch (error) {
      logWarn("grok subscription credits request failed");
      return this._lastGoodOrError(
        error instanceof TokenError
          ? _("Grok: login rejected. Run `grok login` to sign in again.")
          : _("Grok: subscription credits unavailable. Try again later."),
        pathsTried,
      );
    }

    this._assertAlive();
    const usage = normalizeGrokUsagePayload(payload);
    if (
      !usage ||
      (usage.usedPercent === null && usage.resetAt === null && usage.prepaidBalance === null)
    ) {
      return this._lastGoodOrError(
        _("Grok: subscription credits unavailable. Try again later."),
        pathsTried,
      );
    }

    let plan: string | null = null;
    pathsTried.push("settings-api");
    try {
      const settings = await this._http.getJson(`${GROK_BASE_URL}/settings`, { headers });
      if (settings && typeof settings === "object" && "subscription_tier_display" in settings) {
        const value = settings.subscription_tier_display;
        if (typeof value === "string" && value.trim()) plan = value.trim();
      }
    } catch {
      logWarn("grok subscription plan unavailable");
    }

    this._assertAlive();
    const optionalField = (name: string, value: unknown) =>
      this._makeField(name, value, value !== null ? FieldStatus.OK : FieldStatus.UNAVAILABLE);
    const fields = [
      ...this._makeWindowFields("credits", {
        used_percent: usage.usedPercent,
        reset_at: usage.resetAt,
      }),
      optionalField("prepaid_balance", usage.prepaidBalance),
      optionalField("unified_billing", usage.unifiedBilling),
      optionalField("plan_type", plan),
      this._makeField("usage_source", "cli-chat-proxy.grok.com", FieldStatus.OK),
    ];
    return this._finalizeResult(
      this._classifyResult(fields, pathsTried, "Grok"),
      pathsTried,
      _("Grok: subscription credits unavailable. Try again later."),
    );
  }
}
