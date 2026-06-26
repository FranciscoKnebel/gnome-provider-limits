import { redactForLog } from "../../src/helpers/log.js";

describe("redactForLog", () => {
  it("passes null and undefined through", () => {
    expect(redactForLog(null)).toBeNull();
    expect(redactForLog(undefined)).toBeUndefined();
  });

  it("redacts strings entirely", () => {
    expect(redactForLog("my-secret-token")).toBe("<redacted>");
  });

  it("passes non-object primitives through unchanged", () => {
    expect(redactForLog(42)).toBe(42);
    expect(redactForLog(true)).toBe(true);
  });

  it("redacts all string values in objects (conservative)", () => {
    const input = { token: "abc", name: "user", nested: { access_token: "def", count: 5 } };
    const output = redactForLog(input) as Record<string, unknown>;
    expect(output.token).toBe("<redacted>");
    expect(output.name).toBe("<redacted>");
    expect((output.nested as Record<string, unknown>).access_token).toBe("<redacted>");
    expect((output.nested as Record<string, unknown>).count).toBe(5);
  });

  it("redacts keys that partially match sensitive names", () => {
    const input = { my_token_value: "secret", api_key_primary: "key123" };
    const output = redactForLog(input) as Record<string, unknown>;
    expect(output.my_token_value).toBe("<redacted>");
    expect(output.api_key_primary).toBe("<redacted>");
  });

  it("redacts items in arrays recursively", () => {
    const input = [{ token: "abc" }, { token: "def" }];
    const output = redactForLog(input) as Array<Record<string, unknown>>;
    expect(output[0].token).toBe("<redacted>");
    expect(output[1].token).toBe("<redacted>");
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
