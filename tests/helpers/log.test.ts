import { logError, logWarn, maskSecrets, redactForLog } from "../../src/helpers/log.js";

const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

class CustomError extends Error {
  stderr: string;
  exitCode: number;

  constructor(message: string, stderr: string, exitCode: number) {
    super(message);
    this.name = "CustomError";
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

describe("redactForLog", () => {
  it("passes null and undefined through", () => {
    expect(redactForLog(null)).toBeNull();
    expect(redactForLog(undefined)).toBeUndefined();
  });

  it("preserves ordinary strings", () => {
    expect(redactForLog("plain message")).toBe("plain message");
  });

  it("passes non-object primitives through unchanged", () => {
    expect(redactForLog(42)).toBe(42);
    expect(redactForLog(true)).toBe(true);
  });

  it("preserves ordinary string values in objects", () => {
    const input = { name: "user", count: 5, nested: { status: "ok" } };
    expect(redactForLog(input)).toEqual(input);
  });

  it("redacts values under sensitive keys but keeps other values", () => {
    const input = { token: "abc", name: "user", nested: { access_token: "def", count: 5 } };
    const output = redactForLog(input) as Record<string, unknown>;
    expect(output.token).toBe("<redacted>");
    expect(output.name).toBe("user");
    expect((output.nested as Record<string, unknown>).access_token).toBe("<redacted>");
    expect((output.nested as Record<string, unknown>).count).toBe(5);
  });

  it("redacts keys that partially match sensitive names", () => {
    const input = { my_token_value: "secret", api_key_primary: "key123" };
    const output = redactForLog(input) as Record<string, unknown>;
    expect(output.my_token_value).toBe("<redacted>");
    expect(output.api_key_primary).toBe("<redacted>");
  });

  it("masks JWT-looking strings", () => {
    expect(redactForLog(`session ${JWT}`)).toBe("session <redacted>");
    expect(redactForLog({ value: JWT })).toEqual({ value: "<redacted>" });
  });

  it("masks Bearer credentials", () => {
    expect(redactForLog("Authorization: Bearer abc.def.ghi")).toBe("Authorization: <redacted>");
  });

  it("masks long hex and base64 blobs", () => {
    const hex = "a1b2c3d4".repeat(8);
    expect(redactForLog(`id=${hex}`)).toBe("id=<redacted>");

    const base64 = "QWxsIHlvdXIgYmFzZTY0IGFyZSBiZWxvbmcgdG8gdXM=";
    expect(redactForLog(`blob=${base64}`)).toBe("blob=<redacted>");
  });

  it("masks base64url blobs", () => {
    const withUnderscore = `${"G".repeat(45)}_${"H".repeat(45)}`;
    expect(redactForLog(`blob=${withUnderscore}`)).toBe("blob=<redacted>");

    const withHyphen = `${"J".repeat(45)}-${"K".repeat(45)}`;
    expect(redactForLog(`blob=${withHyphen}`)).toBe("blob=<redacted>");
  });

  it("renders Errors as name, message and stack", () => {
    const output = redactForLog(new Error("boom")) as Record<string, unknown>;
    expect(output.name).toBe("Error");
    expect(output.message).toBe("boom");
    expect(String(output.stack)).toContain("boom");
  });

  it("masks secrets inside Error messages and stacks", () => {
    const output = redactForLog(new Error(`Bearer ${JWT}`)) as Record<string, unknown>;
    expect(String(output.message)).not.toContain(JWT);
    expect(String(output.stack)).not.toContain(JWT);
  });

  it("renders nested Errors", () => {
    const output = redactForLog({ cause: new Error("boom") }) as Record<string, unknown>;
    const cause = output.cause as Record<string, unknown>;
    expect(cause.name).toBe("Error");
    expect(cause.message).toBe("boom");
  });

  it("includes own enumerable properties on Errors", () => {
    const output = redactForLog(new CustomError("subprocess failed", "cli stderr", 3)) as Record<
      string,
      unknown
    >;
    expect(output.name).toBe("CustomError");
    expect(output.message).toBe("subprocess failed");
    expect(String(output.stack)).toContain("subprocess failed");
    expect(output.stderr).toBe("cli stderr");
    expect(output.exitCode).toBe(3);
  });

  it("masks secrets and sensitive keys in Error properties", () => {
    const withSecret = redactForLog(new CustomError("failed", `Bearer ${JWT}`, 1)) as Record<
      string,
      unknown
    >;
    expect(String(withSecret.stderr)).not.toContain(JWT);

    const error = new Error("boom") as Error & Record<string, unknown>;
    error.access_token = "secret";
    error.payload = { token: "abc", name: "user" };
    const output = redactForLog(error) as Record<string, unknown>;
    expect(output.access_token).toBe("<redacted>");
    expect((output.payload as Record<string, unknown>).token).toBe("<redacted>");
    expect((output.payload as Record<string, unknown>).name).toBe("user");
  });

  it("handles circular references on Errors", () => {
    const error = new CustomError("boom", "stderr", 1) as CustomError & { self?: unknown };
    error.self = error;
    const output = redactForLog(error) as Record<string, unknown>;
    expect(output.self).toBe("[Circular]");
  });

  it("redacts items in arrays recursively", () => {
    const input = [{ token: "abc" }, { name: "kept" }];
    const output = redactForLog(input) as Array<Record<string, unknown>>;
    expect(output[0].token).toBe("<redacted>");
    expect(output[1].name).toBe("kept");
  });

  it("handles circular references", () => {
    const input: Record<string, unknown> = { name: "kept" };
    input.self = input;
    const output = redactForLog(input) as Record<string, unknown>;
    expect(output.name).toBe("kept");
    expect(output.self).toBe("[Circular]");
  });

  it("handles empty objects", () => {
    expect(redactForLog({})).toEqual({});
  });

  it("handles empty arrays", () => {
    expect(redactForLog([])).toEqual([]);
  });

  it("preserves non-string primitives in objects", () => {
    const input = { used_percent: 42, allowed: true };
    const output = redactForLog(input) as Record<string, unknown>;
    expect(output.used_percent).toBe(42);
    expect(output.allowed).toBe(true);
  });
});

describe("maskSecrets", () => {
  it("keeps ordinary text unchanged", () => {
    expect(maskSecrets("no such table: session")).toBe("no such table: session");
  });

  it("masks a JWT", () => {
    expect(maskSecrets(`token=${JWT}`)).toBe("token=<redacted>");
  });

  it("masks a Bearer header", () => {
    expect(maskSecrets("Authorization: Bearer sk-live-123456")).toBe("Authorization: <redacted>");
  });
});

describe("logError", () => {
  it("logs the error message and stack", () => {
    const spy = spyOn(console, "error");
    logError("reader failed", new Error("boom"));

    const args = spy.calls.mostRecent().args;
    expect(String(args[0])).toContain("boom");
    const redacted = args[1] as Record<string, unknown>;
    expect(String(redacted.stack)).toContain("boom");
  });

  it("masks secrets in the logged message", () => {
    const spy = spyOn(console, "error");
    logError("reader failed", new Error(`Bearer ${JWT}`));
    expect(String(spy.calls.mostRecent().args[0])).not.toContain(JWT);
  });
});

describe("logWarn", () => {
  it("renders Errors with their message and stack", () => {
    const spy = spyOn(console, "warn");
    logWarn("reader failed", new Error("boom"));

    const redacted = spy.calls.mostRecent().args[1] as Record<string, unknown>;
    expect(redacted.message).toBe("boom");
    expect(String(redacted.stack)).toContain("boom");
  });
});
