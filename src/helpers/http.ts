import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Soup from "gi://Soup";

import { HTTP_TIMEOUT_SECONDS } from "../constants.js";
import { nextRetry, RETRY_DEADLINE_MS, RETRY_MAX_ATTEMPTS } from "./retry.js";

Gio._promisify(Soup.Session.prototype, "send_and_read_async", "send_and_read_finish");

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly payload?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class TokenError extends HttpError {
  constructor(message: string, payload?: unknown) {
    super(message, 401, payload);
    this.name = "TokenError";
  }
}

export class RateLimitError extends HttpError {
  constructor(
    message: string,
    payload?: unknown,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(message, 429, payload);
    this.name = "RateLimitError";
  }
}

export class ServerError extends HttpError {
  constructor(message: string, statusCode: number, payload?: unknown) {
    super(message, statusCode, payload);
    this.name = "ServerError";
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

export class ProtocolError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "ProtocolError";
  }
}

export interface HttpRequestOptions {
  headers?: Record<string, string>;
  cancellable?: Gio.Cancellable;
}

export interface HttpGetOptions extends HttpRequestOptions {
  retries?: number;
  deadlineMs?: number;
}

export class HttpClient {
  private _session: Soup.Session;

  constructor(session?: Soup.Session) {
    this._session =
      session ??
      new Soup.Session({
        timeout: HTTP_TIMEOUT_SECONDS,
      });
  }

  async getJson(url: string, options?: HttpGetOptions): Promise<unknown> {
    const maxAttempts = 1 + (options?.retries ?? RETRY_MAX_ATTEMPTS - 1);
    const deadlineMs = options?.deadlineMs ?? RETRY_DEADLINE_MS;
    const cancellable = options?.cancellable ?? null;
    const startedAt = GLib.get_monotonic_time() / 1000;
    let attempt = 0;

    for (;;) {
      attempt++;
      try {
        const message = Soup.Message.new("GET", url);
        this._applyHeaders(message, options?.headers);
        return await this._sendAndParse(message, cancellable);
      } catch (error) {
        if (!(error instanceof HttpError) && !(error instanceof NetworkError)) throw error;

        const decision = nextRetry({
          attempt,
          maxAttempts,
          statusCode: error instanceof HttpError ? error.statusCode : null,
          retryAfterSeconds: error instanceof RateLimitError ? error.retryAfterSeconds : null,
          elapsedMs: GLib.get_monotonic_time() / 1000 - startedAt,
          deadlineMs,
        });
        if (decision.delayMs === null) throw error;
        await this._delay(decision.delayMs, cancellable);
      }
    }
  }

  async postJson(url: string, body: unknown, options?: HttpRequestOptions): Promise<unknown> {
    const message = Soup.Message.new("POST", url);
    this._applyHeaders(message, options?.headers);

    const jsonBody = JSON.stringify(body);
    message.set_request_body_from_bytes(
      "application/json",
      new GLib.Bytes(new TextEncoder().encode(jsonBody)),
    );

    return this._sendAndParse(message, options?.cancellable ?? null);
  }

  private _applyHeaders(message: Soup.Message, headers?: Record<string, string>): void {
    if (!headers) return;
    const requestHeaders = message.get_request_headers();
    for (const [key, value] of Object.entries(headers)) {
      requestHeaders.append(key, value);
    }
  }

  private async _sendAndParse(
    message: Soup.Message,
    cancellable: Gio.Cancellable | null,
  ): Promise<unknown> {
    try {
      const bytes = await this._session.send_and_read_async(
        message,
        GLib.PRIORITY_DEFAULT,
        cancellable,
      );

      const statusCode = message.get_status();
      const bodyText = this._decodeBytes(bytes).trim();

      if (statusCode < 200 || statusCode >= 300) {
        throw this._errorForStatus(
          statusCode,
          this._parseBody(bodyText),
          this._parseRetryAfterSeconds(message),
        );
      }

      if (!bodyText) return null;

      try {
        return JSON.parse(bodyText);
      } catch {
        throw new ProtocolError(
          `Expected JSON response but received a non-JSON body (HTTP ${statusCode})`,
          statusCode,
        );
      }
    } catch (error) {
      if (error instanceof HttpError || error instanceof ProtocolError) throw error;
      throw new NetworkError(`Request failed: ${error}`);
    }
  }

  private _parseBody(bodyText: string): unknown {
    if (!bodyText) return null;
    try {
      return JSON.parse(bodyText);
    } catch {
      return null;
    }
  }

  private _parseRetryAfterSeconds(message: Soup.Message): number | null {
    const raw = message.get_response_headers().get_one("Retry-After");
    if (!raw) return null;

    const seconds = Number(raw.trim());
    if (Number.isFinite(seconds) && seconds >= 0) return seconds;

    const dateMs = Date.parse(raw);
    if (!Number.isFinite(dateMs)) return null;
    return Math.max(0, (dateMs - Date.now()) / 1000);
  }

  private _delay(delayMs: number, cancellable: Gio.Cancellable | null): Promise<void> {
    if (cancellable?.is_cancelled()) {
      return Promise.reject(new NetworkError("Request cancelled"));
    }

    return new Promise((resolve, reject) => {
      let cancelId: number | null = null;
      const sourceId = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        Math.max(0, Math.round(delayMs)),
        () => {
          if (cancelId !== null) cancellable?.disconnect(cancelId);
          resolve();
          return GLib.SOURCE_REMOVE;
        },
      );

      cancelId =
        cancellable?.connect(() => {
          GLib.Source.remove(sourceId);
          reject(new NetworkError("Request cancelled"));
        }) ?? null;
    });
  }

  private _errorForStatus(
    statusCode: number,
    payload: unknown,
    retryAfterSeconds: number | null = null,
  ): HttpError {
    const message = this._extractErrorMessage(payload) ?? `HTTP ${statusCode}`;

    if (statusCode === 401 || statusCode === 403) {
      return new TokenError(message, payload);
    }
    if (statusCode === 429) {
      return new RateLimitError(message, payload, retryAfterSeconds);
    }
    if (statusCode >= 500) {
      return new ServerError(message, statusCode, payload);
    }
    return new HttpError(message, statusCode, payload);
  }

  private _extractErrorMessage(payload: unknown): string | null {
    if (!payload || typeof payload !== "object") return null;

    const obj = payload as Record<string, unknown>;
    for (const key of ["message", "detail", "title"]) {
      const value = obj[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }

    const nested = obj.error;
    if (typeof nested === "string" && nested.trim()) {
      return nested.trim();
    }
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return this._extractErrorMessage(nested);
    }
    return null;
  }

  private _decodeBytes(bytes: GLib.Bytes | Uint8Array | null): string {
    if (!bytes) return "";
    const data = bytes instanceof Uint8Array ? bytes : (bytes as GLib.Bytes).toArray();
    return new TextDecoder().decode(data);
  }

  destroy(): void {
    this._session.abort();
  }
}
