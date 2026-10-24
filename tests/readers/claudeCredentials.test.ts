import { parseClaudeCredentials } from "../../src/readers/claudeProbe.js";

describe("parseClaudeCredentials", () => {
  it("reads nested token and expiry from the same object", () => {
    expect(
      parseClaudeCredentials({
        expiresAt: 1,
        claudeAiOauth: { accessToken: "synthetic", expiresAt: 4070908800000 },
      }),
    ).toEqual({ token: "synthetic", expiresAtMs: 4070908800000 });
  });

  it("intentionally supports legacy top-level tokens", () => {
    for (const key of ["access_token", "token"]) {
      expect(parseClaudeCredentials({ [key]: "synthetic", expires_at: 4070908800 })).toEqual({
        token: "synthetic",
        expiresAtMs: 4070908800000,
      });
      expect(parseClaudeCredentials({ [key]: "synthetic" })).toEqual({
        token: "synthetic",
        expiresAtMs: null,
      });
    }
  });

  it("does not fall back from malformed nested credentials to a different token", () => {
    for (const nested of [
      null,
      [],
      "bad",
      {},
      { accessToken: " " },
      { accessToken: "synthetic", expiresAt: "bad" },
    ]) {
      expect(parseClaudeCredentials({ token: "legacy", claudeAiOauth: nested })).toBeNull();
    }
  });
});
