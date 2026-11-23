import {
  DEFAULT_PROVIDERS_ORDER,
  DEFAULT_REFRESH_LONG_INTERVAL_SECONDS,
  DEFAULT_REFRESH_SHORT_INTERVAL_SECONDS,
  DEFAULT_REFRESH_STABLE_READS_THRESHOLD,
  GETTEXT_DOMAIN,
  HTTP_TIMEOUT_SECONDS,
  PROVIDER_METADATA,
  PROVIDER_NAMES,
  SCHEMA_ID,
  SQLITE_CACHE_TTL_SECONDS,
  SUBPROCESS_TIMEOUT_SECONDS,
} from "../src/constants.js";

describe("constants", () => {
  it("has the six expected providers", () => {
    expect(PROVIDER_NAMES).toEqual(["codex", "claude", "opencode", "grok", "cursor", "google"]);
  });

  it("has a non-negative refresh short interval", () => {
    expect(DEFAULT_REFRESH_SHORT_INTERVAL_SECONDS).toBeGreaterThan(0);
  });

  it("has a refresh long interval greater than short", () => {
    expect(DEFAULT_REFRESH_LONG_INTERVAL_SECONDS).toBeGreaterThan(
      DEFAULT_REFRESH_SHORT_INTERVAL_SECONDS,
    );
  });

  it("has a positive stable reads threshold", () => {
    expect(DEFAULT_REFRESH_STABLE_READS_THRESHOLD).toBeGreaterThan(0);
  });

  it("has the correct providers order", () => {
    expect(DEFAULT_PROVIDERS_ORDER).toEqual([
      "codex",
      "claude",
      "opencode",
      "grok",
      "cursor",
      "google",
    ]);
  });

  it("has a positive SQLite cache TTL", () => {
    expect(SQLITE_CACHE_TTL_SECONDS).toBeGreaterThan(0);
  });

  it("has a positive HTTP timeout", () => {
    expect(HTTP_TIMEOUT_SECONDS).toBeGreaterThan(0);
  });

  it("has a positive subprocess timeout", () => {
    expect(SUBPROCESS_TIMEOUT_SECONDS).toBeGreaterThan(0);
  });

  it("has the correct schema ID", () => {
    expect(SCHEMA_ID).toBe("org.gnome.shell.extensions.gnome-provider-limits");
  });

  it("has the correct gettext domain", () => {
    expect(GETTEXT_DOMAIN).toBe("gnome-provider-limits");
  });

  it("PROVIDER_NAMES is readonly", () => {
    const names: readonly string[] = PROVIDER_NAMES;
    expect(names).toHaveSize(6);
  });

  it("declares a path kind for every provider", () => {
    expect(PROVIDER_METADATA.codex.pathKind).toBe("cli");
    expect(PROVIDER_METADATA.claude.pathKind).toBe("cli");
    expect(PROVIDER_METADATA.opencode.pathKind).toBe("cli");
    expect(PROVIDER_METADATA.grok.pathKind).toBe("auth-file");
    expect(PROVIDER_METADATA.cursor.pathKind).toBe("auth-file");
    expect(PROVIDER_METADATA.google.pathKind).toBe("auth-file");
    expect(Object.keys(PROVIDER_METADATA).sort()).toEqual([...PROVIDER_NAMES].sort());
  });
});
