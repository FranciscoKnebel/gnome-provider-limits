import {
  COOKIE_CACHE_TTL_SECONDS,
  DEFAULT_PROVIDERS_ORDER,
  DEFAULT_REFRESH_LONG_INTERVAL_SECONDS,
  DEFAULT_REFRESH_SHORT_INTERVAL_SECONDS,
  DEFAULT_REFRESH_STABLE_READS_THRESHOLD,
  GETTEXT_DOMAIN,
  HTTP_TIMEOUT_SECONDS,
  PROVIDER_NAMES,
  SCHEMA_ID,
  SQLITE_CACHE_TTL_SECONDS,
  SUBPROCESS_TIMEOUT_SECONDS,
} from "../src/constants.js";

describe("constants", () => {
  it("has the three expected providers", () => {
    expect(PROVIDER_NAMES).toEqual(["codex", "claude", "opencode"]);
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
    expect(DEFAULT_PROVIDERS_ORDER).toEqual(["codex", "claude", "opencode"]);
  });

  it("has a positive SQLite cache TTL", () => {
    expect(SQLITE_CACHE_TTL_SECONDS).toBeGreaterThan(0);
  });

  it("has a positive cookie cache TTL", () => {
    expect(COOKIE_CACHE_TTL_SECONDS).toBeGreaterThan(0);
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
    expect(names).toHaveSize(3);
  });
});
