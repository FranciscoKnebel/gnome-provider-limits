import { test } from "node:test";

import { assert, load } from "../helpers/node-harness.mjs";

const PROVIDER_NAMES = ["codex", "claude", "opencode", "grok", "cursor", "google"];

function loadProviderSettings() {
  return load(
    "src/helpers/provider-settings.ts",
    "({ resolveActiveProviders, normalizeProvidersOrder, providerDisplayName, providerDisplayNameShort })",
    {
      PROVIDER_NAMES,
      DEFAULT_PROVIDERS_ORDER: PROVIDER_NAMES,
      ReaderStatus: { DISABLED: "disabled", OK: "ok" },
    },
  );
}

function loadViewContext() {
  let derivationInput;
  const api = load("src/ui/viewContext.ts", "({ viewContextFor, resolveViewPhase })", {
    PROVIDER_NAMES,
    providerRecord: (make) =>
      Object.fromEntries(PROVIDER_NAMES.map((provider) => [provider, make(provider)])),
    deriveDisplayModels: (input) => {
      derivationInput = input;
      return [];
    },
    ...loadProviderSettings(),
  });
  return { ...api, derivationInput: () => derivationInput };
}

function settingsWith(values) {
  return {
    get_strv: (key) => values[key] ?? [],
    get_boolean: (key) => values[key] === true,
    get_string: (key) => values[key] ?? "",
  };
}

test("active providers have one canonical selector across rendering paths", () => {
  const { resolveActiveProviders } = loadProviderSettings();
  const settings = settingsWith({
    "providers-order": ["claude", "codex"],
    "claude-enabled": true,
  });
  const readers = new Map([["codex", {}]]);
  const results = new Map([
    ["claude", { status: "disabled" }],
    ["google", { status: "ok" }],
  ]);

  assert.deepEqual(Array.from(resolveActiveProviders(settings, readers, results)), [
    "codex",
    "google",
  ]);
  assert.deepEqual(Array.from(resolveActiveProviders(settings, new Map(), results)), ["google"]);
  assert.deepEqual(Array.from(resolveActiveProviders(settingsWith({}), new Map(), new Map())), []);
});

test("the view snapshot exposes one consistent set of provider settings", () => {
  const { resolveActiveProviders } = loadProviderSettings();
  const { viewContextFor, derivationInput } = loadViewContext();
  const settings = settingsWith({
    "providers-order": ["opencode", "codex"],
    "codex-enabled": true,
    "codex-display-name": "Codex Pro",
    "codex-display-name-short": "CX",
    "codex-status-fields": ["used_percent_primary"],
    "codex-panel-fields": ["reset_at_primary"],
  });
  const readers = new Map();
  const results = new Map([["opencode", { status: "ok" }]]);
  const fieldDefs = { codex: [{ name: "used_percent_primary" }] };
  const view = viewContextFor(settings, readers, results, fieldDefs, "en", (text) => text);

  assert.deepEqual(
    Array.from(view.activeProviders),
    Array.from(resolveActiveProviders(settings, readers, results)),
  );
  assert.deepEqual(Array.from(view.activeProviders), ["opencode", "codex"]);
  assert.equal(view.phase, "ready");
  assert.equal(view.activeProviders.includes("codex"), true);
  assert.equal(view.activeProviders.includes("claude"), false);
  assert.equal(view.displayNames.codex, "Codex Pro");
  assert.deepEqual(view.models, []);
  assert.deepEqual(Object.keys(view).sort(), [
    "activeProviders",
    "displayNames",
    "locale",
    "models",
    "phase",
    "results",
    "t",
  ]);

  const input = derivationInput();
  assert.equal(input.shortDisplayNames.codex, "CX");
  assert.deepEqual(input.statusFields.codex, ["used_percent_primary"]);
  assert.deepEqual(input.panelFields.codex, ["reset_at_primary"]);
  assert.equal(input.fieldDefs, fieldDefs);
});

test("view phase comes from enabled providers and results only", () => {
  const { resolveViewPhase } = loadViewContext();
  assert.equal(resolveViewPhase([], new Map()), "empty");
  assert.equal(resolveViewPhase(["codex"], new Map()), "loading");
  assert.equal(resolveViewPhase(["codex"], new Map([["codex", {}]])), "ready");
});
