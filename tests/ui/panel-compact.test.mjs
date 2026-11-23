import { test } from "node:test";

import { assert, load } from "../helpers/node-harness.mjs";

class Actor {
  constructor(props = {}) {
    Object.assign(this, props);
    this.children = [];
    this.styleClasses = [];
    this.clutter_text = { line_wrap: false };
  }
  add_child(child) {
    this.children.push(child);
  }
  add_style_class_name(name) {
    this.styleClasses.push(name);
  }
  remove_style_class_name(name) {
    this.styleClasses = this.styleClasses.filter((value) => value !== name);
  }
  connect() {}
  destroy() {}
}

class Label extends Actor {}
class BoxLayout extends Actor {}
class Widget extends Actor {}
class Button extends Actor {}

function providerModel(provider) {
  return {
    provider,
    displayName: provider,
    status: "ok",
    facts: {
      badges: { status: "" },
      usage: { header: { fillRatio: 0.5, tone: "ok", summaryText: "50%" } },
      diagnostic: { errorText: null, detailText: null },
      panelViews: [],
      lastUpdatedText: null,
    },
    panelViews: [],
  };
}

function clampFillRatio(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function loadCompact() {
  const matrixPlan = load(
    "src/ui/matrixPlan.ts",
    "({ areAllProvidersExpanded, formatSegmentedBar, resolveProviderExpanded, toggleAllProvidersExpanded })",
    { clampFillRatio },
  );
  const activations = new Map();
  const api = load("src/ui/panelCompact.ts", "({ CompactPanelSection, createExpandAllControl })", {
    Clutter: {
      ActorAlign: { CENTER: 0, START: 1, END: 2 },
      KEY_Left: 1,
      KEY_Right: 2,
      EVENT_STOP: 1,
      EVENT_PROPAGATE: 0,
    },
    St: { BoxLayout, Label, Widget, Button },
    _: (text) => text,
    bindActivation: (target, callback, options) => {
      activations.set(target, { callback, options });
    },
    ReaderStatus: { PARTIAL: "partial" },
    clampFillRatio,
    ...matrixPlan,
    PanelStyleSection: class {
      constructor(shell) {
        this.shell = shell;
      }
    },
    applyQuietToneClass: () => {},
    applyToneClass: () => {},
    emptyViewContext: () => ({
      activeProviders: [],
      models: [],
      t: (text) => text,
    }),
    phaseResult: () => ({ kind: "ready" }),
    matrixMessages: () => ({}),
    createErrorLabel: (text, styleClass) => new Label({ text, style_class: styleClass }),
  });
  return { ...api, activations };
}

function shellStub() {
  const body = [];
  return {
    body,
    clearBody() {
      body.length = 0;
    },
    addEmptyStateRow() {},
    addStaticRow() {
      return new BoxLayout();
    },
    addBodyItem(item) {
      body.push(item);
    },
  };
}

function chevrons(rows) {
  return rows.map((row) => {
    const stack = row.children[0];
    const topLine = stack.children[0];
    return topLine.children[0].children[0].text;
  });
}

test("compact panel uses the active-provider default for every expand control", () => {
  const { CompactPanelSection, createExpandAllControl, activations } = loadCompact();
  const shell = shellStub();
  const expandAll = createExpandAllControl();
  const section = new CompactPanelSection(shell, expandAll);

  const context = {
    lastRefreshAt: null,
    view: {
      activeProviders: ["codex", "claude", "opencode"],
      models: [providerModel("codex"), providerModel("claude")],
      t: (text) => text,
    },
  };
  section.render(context);

  const headers = () =>
    shell.body.filter((item) => item.styleClasses.includes("provider-limits-matrix-header"));
  assert.deepEqual(chevrons(headers()), ["▸", "▸"]);

  activations.get(headers()[0]).callback();
  assert.deepEqual(chevrons(headers()), ["▾", "▸"]);

  activations.get(expandAll.button).callback();
  assert.deepEqual(chevrons(headers()), ["▾", "▾"]);

  activations.get(expandAll.button).callback();
  assert.deepEqual(chevrons(headers()), ["▸", "▸"]);
});
