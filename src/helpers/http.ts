import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Soup from "gi://Soup";

import { HTTP_TIMEOUT_SECONDS } from "../constants.js";

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
  constructor(message: string, payload?: unknown) {
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

export interface HttpRequestOptions {
  headers?: Record<string, string>;
  timeoutSeconds?: number;
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

  async getJson<T>(url: string, options?: HttpRequestOptions): Promise<T> {
    const message = Soup.Message.new("GET", url);
    this._applyHeaders(message, options?.headers);

    return this._sendAndParse<T>(message, options);
  }

  async postJson<T>(url: string, body: unknown, options?: HttpRequestOptions): Promise<T> {
    const message = Soup.Message.new("POST", url);
    this._applyHeaders(message, options?.headers);

    const jsonBody = JSON.stringify(body);
    message.set_request_body_from_bytes(
      "application/json",
      new GLib.Bytes(new TextEncoder().encode(jsonBody)),
    );

    return this._sendAndParse<T>(message, options);
  }

  private _applyHeaders(message: Soup.Message, headers?: Record<string, string>): void {
    if (!headers) return;
    const requestHeaders = message.get_request_headers();
    for (const [key, value] of Object.entries(headers)) {
      requestHeaders.append(key, value);
    }
  }

  private async _sendAndParse<T>(message: Soup.Message, _options?: HttpRequestOptions): Promise<T> {
    try {
      const bytes = await this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);

      const statusCode = message.get_status();
      const bodyText = this._decodeBytes(bytes);

      let payload: unknown = null;
      if (bodyText) {
        try {
          payload = JSON.parse(bodyText);
        } catch {
          // Non-JSON response
        }
      }

      if (statusCode < 200 || statusCode >= 300) {
        throw this._errorForStatus(statusCode, payload, bodyText);
      }

      return payload as T;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new NetworkError(`Request failed: ${error}`);
    }
  }

  private _errorForStatus(statusCode: number, payload: unknown, bodyText: string): HttpError {
    const message = this._extractErrorMessage(payload) ?? bodyText ?? `HTTP ${statusCode}`;

    if (statusCode === 401 || statusCode === 403) {
      return new TokenError(message, payload);
    }
    if (statusCode === 429) {
      return new RateLimitError(message, payload);
    }
    if (statusCode >= 500) {
      return new ServerError(message, statusCode, payload);
    }
    return new HttpError(message, statusCode, payload);
  }

  private _extractErrorMessage(payload: unknown): string | null {
    if (!payload || typeof payload !== "object") return null;

    const obj = payload as Record<string, unknown>;
    for (const key of ["message", "error", "detail", "title"]) {
      const value = obj[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
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
