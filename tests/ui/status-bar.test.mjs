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
  return load("src/ui/viewContext.ts", "({ viewContextFor, resolveViewPhase })", {
    PROVIDER_NAMES,
    ...loadProviderSettings(),
  });
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
  const { viewContextFor } = loadViewContext();
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
  assert.equal(view.shortDisplayNames.codex, "CX");
  assert.deepEqual(view.statusFields.codex, ["used_percent_primary"]);
  assert.deepEqual(view.panelFields.codex, ["reset_at_primary"]);
  assert.equal(view.fieldDefs, fieldDefs);
  assert.deepEqual(Array.from(view.order), [
    "opencode",
    "codex",
    "claude",
    "grok",
    "cursor",
    "google",
  ]);
});

test("view phase comes from enabled providers and results only", () => {
  const { resolveViewPhase } = loadViewContext();
  assert.equal(resolveViewPhase([], new Map()), "empty");
  assert.equal(resolveViewPhase(["codex"], new Map()), "loading");
  assert.equal(resolveViewPhase(["codex"], new Map([["codex", {}]])), "ready");
});

test("status bar renderer plans once per render and owns structure rebuilds", () => {
  const destroyed = [];
  const parent = {
    children: [],
    add_child(child) {
      this.children.push(child);
      child.parent = this;
    },
    get_first_child() {
      return this.children[0] ?? null;
    },
  };
  const makeChild = (id) => ({
    id,
    parent: null,
    get_next_sibling() {
      const siblings = this.parent?.children ?? [];
      return siblings[siblings.indexOf(this) + 1] ?? null;
    },
    destroy() {
      destroyed.push(this.id);
      if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    },
  });
  const { PlanRenderer } = load("src/ui/planRenderer.ts", "({ PlanRenderer })");
  const { StatusBarRenderer } = load("src/ui/statusBarRenderer.ts", "({ StatusBarRenderer })", {
    PlanRenderer,
  });

  const plans = [];
  const builds = [];
  const updates = [];
  class Renderer extends StatusBarRenderer {
    plan(context) {
      plans.push(context.key);
      return { key: context.key, value: context.value };
    }
    build(plan) {
      builds.push(plan.key);
      const child = makeChild(plan.key);
      this.parent.add_child(child);
    }
    update(plan) {
      updates.push(plan.value);
    }
  }
  const renderer = new Renderer(parent);

  renderer.render({ key: "a", value: 1 });
  assert.deepEqual(plans, ["a"], "one plan per render");
  assert.deepEqual(builds, ["a"], "first render builds");
  assert.deepEqual(updates, []);
  assert.equal(parent.children.length, 1);

  renderer.render({ key: "a", value: 2 });
  assert.deepEqual(plans, ["a", "a"], "one plan per render on update");
  assert.deepEqual(builds, ["a"], "same structure key updates in place");
  assert.deepEqual(updates, [2]);
  assert.equal(parent.children.length, 1);

  renderer.render({ key: "b", value: 3 });
  assert.deepEqual(plans, ["a", "a", "b"]);
  assert.deepEqual(builds, ["a", "b"], "changed structure key rebuilds");
  assert.deepEqual(destroyed, ["a"], "old children are disposed on rebuild");
  assert.equal(parent.children.length, 1);

  renderer.dispose();
  assert.deepEqual(destroyed, ["a", "b"]);
  assert.equal(parent.children.length, 0);

  renderer.render({ key: "b", value: 4 });
  assert.deepEqual(builds, ["a", "b", "b"], "dispose clears the structure key");
  assert.deepEqual(updates, [2]);
});

test("PlanRenderer provides the shared lifecycle to any renderer", () => {
  const events = [];
  const { PlanRenderer } = load("src/ui/planRenderer.ts", "({ PlanRenderer })");

  class Renderer extends PlanRenderer {
    plan(context) {
      events.push(`plan:${context.key}`);
      return { key: context.key, value: context.value };
    }
    build(plan) {
      events.push(`build:${plan.key}`);
    }
    update(plan) {
      events.push(`update:${plan.value}`);
    }
    clear() {
      events.push("clear");
    }
    onDispose() {
      events.push("dispose");
    }
  }
  const renderer = new Renderer();
  renderer.render({ key: "a", value: 1 });
  renderer.render({ key: "a", value: 2 });
  renderer.render({ key: "b", value: 3 });
  renderer.dispose();

  assert.deepEqual(events, [
    "plan:a",
    "clear",
    "dispose",
    "build:a",
    "plan:a",
    "update:2",
    "plan:b",
    "clear",
    "dispose",
    "build:b",
    "clear",
    "dispose",
  ]);
});
