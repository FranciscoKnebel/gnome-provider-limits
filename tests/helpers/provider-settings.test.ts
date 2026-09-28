import type Gio from "gi://Gio";

import { DEFAULT_PROVIDERS_ORDER, PROVIDER_NAMES } from "../../src/constants.js";
import {
  isProviderName,
  normalizeProvidersOrder,
  providerDisplayName,
  providerDisplayNameShort,
} from "../../src/helpers/provider-settings.js";

function settingsWith(values: Record<string, string>): Gio.Settings {
  return {
    get_string: (key: string) => values[key] ?? "",
  } as Gio.Settings;
}

describe("isProviderName", () => {
  it("accepts every known provider", () => {
    for (const name of PROVIDER_NAMES) {
      expect(isProviderName(name)).toBe(true);
    }
  });

  it("rejects unknown names", () => {
    expect(isProviderName("gemini")).toBe(false);
    expect(isProviderName("")).toBe(false);
    expect(isProviderName("codex ")).toBe(false);
  });
});

describe("normalizeProvidersOrder", () => {
  it("preserves the configured order", () => {
    expect(normalizeProvidersOrder(["opencode", "codex", "claude"])).toEqual([
      "opencode",
      "codex",
      "claude",
    ]);
  });

  it("drops duplicate values", () => {
    expect(normalizeProvidersOrder(["codex", "codex", "claude"])).toEqual([
      "codex",
      "claude",
      "opencode",
    ]);
  });

  it("drops unknown values", () => {
    expect(normalizeProvidersOrder(["gemini", "claude"])).toEqual(["claude", "codex", "opencode"]);
  });

  it("appends missing defaults after the configured values", () => {
    expect(normalizeProvidersOrder(["claude"])).toEqual(["claude", "codex", "opencode"]);
  });

  it("returns the default order for empty input", () => {
    expect(normalizeProvidersOrder([])).toEqual([...DEFAULT_PROVIDERS_ORDER]);
  });
});

describe("providerDisplayName", () => {
  it("returns the configured display name", () => {
    const settings = settingsWith({ "codex-display-name": "Codex Pro" });
    expect(providerDisplayName(settings, "codex")).toBe("Codex Pro");
  });

  it("falls back to the provider name when unset", () => {
    expect(providerDisplayName(settingsWith({}), "codex")).toBe("codex");
  });

  it("falls back to the provider name when empty", () => {
    const settings = settingsWith({ "claude-display-name": "" });
    expect(providerDisplayName(settings, "claude")).toBe("claude");
  });
});

describe("providerDisplayNameShort", () => {
  it("returns the configured short name", () => {
    const settings = settingsWith({ "opencode-display-name-short": "OC" });
    expect(providerDisplayNameShort(settings, "opencode")).toBe("OC");
  });

  it("falls back to the provider name when unset", () => {
    expect(providerDisplayNameShort(settingsWith({}), "opencode")).toBe("opencode");
  });

  it("falls back to the provider name when empty", () => {
    const settings = settingsWith({ "codex-display-name-short": "" });
    expect(providerDisplayNameShort(settings, "codex")).toBe("codex");
  });
});
