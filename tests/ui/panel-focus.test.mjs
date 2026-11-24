import { test } from "node:test";

import { assert, load } from "../helpers/node-harness.mjs";

class FocusStage {
  constructor() {
    this.current = null;
  }
  set(actor) {
    if (this.current === actor) return;
    const previous = this.current;
    this.current = actor;
    previous?.fire("key-focus-out");
    actor?.fire("key-focus-in");
  }
}

class Actor {
  constructor(stage, props = {}) {
    Object.assign(this, props);
    this.stage = stage;
    this.children = [];
    this.styleClasses = new Set();
    this.handlers = new Map();
    this.visible = props.visible ?? true;
    this.text = props.text ?? "";
    this.accessible_name = props.accessible_name ?? "";
    this.destroyed = false;
    this.clutter_text = { line_wrap: false };
  }
  add_child(child) {
    this.children.push(child);
    child.parent = this;
  }
  remove_child(child) {
    this.children = this.children.filter((value) => value !== child);
    child.parent = null;
  }
  add_style_class_name(name) {
    this.styleClasses.add(name);
  }
  remove_style_class_name(name) {
    this.styleClasses.delete(name);
  }
  connect(name, fn) {
    const handlers = this.handlers.get(name) ?? [];
    handlers.push(fn);
    this.handlers.set(name, handlers);
    return handlers.length;
  }
  fire(name, ...args) {
    for (const fn of this.handlers.get(name) ?? []) fn(...args);
  }
  get_first_child() {
    return this.children[0] ?? null;
  }
  get_next_sibling() {
    const siblings = this.parent?.children ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  get_stage() {
    return {};
  }
  grab_key_focus() {
    this.stage.set(this);
  }
  has_key_focus() {
    return this.stage.current === this;
  }
  queue_repaint() {}
  destroy() {
    if (this.destroyed) return;
    if (this.stage.current === this) this.stage.set(null);
    if (this.parent) {
      this.parent.children = this.parent.children.filter((child) => child !== this);
      this.parent = null;
    }
    this.destroyed = true;
  }
}

const Clutter = {
  ActorAlign: { CENTER: 0, START: 1, END: 2 },
  KEY_Return: 1,
  KEY_KP_Enter: 2,
  KEY_space: 3,
  KEY_Left: 4,
  KEY_Right: 5,
  EVENT_STOP: 1,
  EVENT_PROPAGATE: 0,
};
const { clearChildren } = load("src/helpers/children.ts", "({ clearChildren })");

function loadOverview() {
  const stage = new FocusStage();
  const headerItems = [];
  const bodyItems = [];
  const arrows = [];
  let activeTab = "overview";
  const host = {
    settings: {},
    shell: {
      addHeaderItem: (item) => headerItems.push(item),
      addBodyItem: (item) => bodyItems.push(item),
      scrollView: {},
    },
    t: (text) => text,
    selectTab: (tab) => {
      activeTab = tab;
    },
    handleArrowNavigation: (event) => {
      arrows.push(event.get_key_symbol());
      return Clutter.EVENT_STOP;
    },
    getActiveTab: () => activeTab,
    getEnabledProviders: () => ["codex", "claude"],
  };
  class StageActor extends Actor {
    constructor(props = {}) {
      super(stage, props);
    }
  }
  const St = {
    BoxLayout: StageActor,
    Label: StageActor,
    Button: StageActor,
    Widget: StageActor,
    DrawingArea: StageActor,
  };
  const bindActivation = (actor, onActivate, binding) => {
    actor.connect("clicked", onActivate);
    actor.connect("button-release-event", onActivate);
    actor.connect("key-press-event", (_actor, event) => {
      const symbol = event.get_key_symbol();
      if ([Clutter.KEY_Return, Clutter.KEY_KP_Enter, Clutter.KEY_space].includes(symbol)) {
        onActivate();
        return Clutter.EVENT_STOP;
      }
      return binding?.onOtherKey?.(event) ?? Clutter.EVENT_PROPAGATE;
    });
  };
  const overviewModel = (provider) => ({
    provider,
    displayName: provider,
    badgeText: "badge",
    badgeKind: "ok",
    primaryText: "primary",
    secondaryText: null,
    tone: "ok",
    meter: {},
    accessibleText: provider,
  });
  const { OverviewRenderer } = load("src/ui/panelGaugesOverview.ts", "({ OverviewRenderer })", {
    Clutter,
    St,
    PopupMenu: { PopupBaseMenuItem: StageActor },
    clearChildren,
    bindActivation,
    providerDisplayName: (_settings, provider) => provider,
    getAvailableTabs: (enabledProviders) => ["overview", ...enabledProviders],
    buildOverviewRowModel: overviewModel,
    loadingOverviewRow: (provider, name) => ({ ...overviewModel(provider), displayName: name }),
    applyHealthToneClass: () => {},
    applyToneClass: () => {},
    connectRepaint: () => {},
    drawMiniCapsule: () => {},
    ensureActorVisibleInScrollView: () => {},
  });
  return { stage, host, headerItems, bodyItems, arrows, OverviewRenderer };
}

function tabButtons(headerItems) {
  return headerItems[0].children[0].children;
}

test("gauges tab bar restores focus to the same tab after every rebuild", () => {
  const { stage, host, headerItems, arrows, OverviewRenderer } = loadOverview();
  const renderer = new OverviewRenderer(host);
  const models = ["codex", "claude"].map((provider) => ({
    provider,
    displayName: provider,
    facts: { health: { tone: "idle" } },
  }));
  renderer.syncTabHeader(["codex", "claude"], models);

  assert.deepEqual(
    tabButtons(headerItems).map((button) => button.accessible_name),
    ["Overview", "codex", "claude"],
  );

  const overviewButton = tabButtons(headerItems)[0];
  overviewButton.grab_key_focus();
  renderer.syncTabHeader(["codex", "claude"], models);
  assert.notEqual(tabButtons(headerItems)[0], overviewButton, "the tab bar was rebuilt");
  assert.equal(stage.current, tabButtons(headerItems)[0], "focus follows the Overview tab");

  renderer.focusTabButton("claude");
  assert.equal(stage.current.accessible_name, "claude");
  renderer.syncTabHeader(["codex", "claude"], models);
  assert.equal(stage.current, tabButtons(headerItems)[2], "focus follows the Claude tab");

  const event = { get_key_symbol: () => Clutter.KEY_Right };
  stage.current.fire("key-press-event", stage.current, event);
  assert.deepEqual(arrows, [Clutter.KEY_Right], "arrow navigation still reaches the host");
});

test("gauges tab bar does not steal focus from actors outside the tab bar", () => {
  const { stage, host, OverviewRenderer } = loadOverview();
  const renderer = new OverviewRenderer(host);
  renderer.syncTabHeader(["codex"], []);

  const footer = new Actor(stage, { accessible_name: "footer" });
  footer.grab_key_focus();
  renderer.syncTabHeader(["codex"], []);
  assert.equal(stage.current, footer, "an unfocused tab bar stays unfocused after a rebuild");
});

function loadCompact() {
  const stage = new FocusStage();
  class StageActor extends Actor {
    constructor(props = {}) {
      super(stage, props);
    }
  }
  const activations = new Map();
  const { addPlaceholderIfNeeded } = load("src/ui/panelShell.ts", "({ addPlaceholderIfNeeded })", {
    PopupMenu: { PopupMenuSection: class {} },
    phaseResult: () => ({ kind: "ready" }),
  });
  const matrixPlan = load(
    "src/ui/matrixPlan.ts",
    "({ areAllProvidersExpanded, formatSegmentedBar, resolveProviderExpanded, toggleAllProvidersExpanded })",
    {
      clampFillRatio: (value) => Math.min(1, Math.max(0, value ?? 0)),
    },
  );
  const { CompactPanelSection, createExpandAllControl } = load(
    "src/ui/panelCompact.ts",
    "({ CompactPanelSection, createExpandAllControl })",
    {
      Clutter,
      St: { BoxLayout: StageActor, Label: StageActor, Widget: StageActor, Button: StageActor },
      _: (text) => text,
      bindActivation: (target, callback, options) => {
        activations.set(target, { callback, options });
      },
      ReaderStatus: { PARTIAL: "partial" },
      createErrorLabel: (text) => new Actor(stage, { text }),
      clampFillRatio: (value) => Math.min(1, Math.max(0, value ?? 0)),
      ...matrixPlan,
      PanelStyleSection: class {
        constructor(shell) {
          this.shell = shell;
        }
      },
      applyToneClass: () => {},
      emptyViewContext: () => ({ activeProviders: [], models: [], t: (text) => text }),
      addPlaceholderIfNeeded,
      matrixMessages: () => ({}),
    },
  );
  const body = [];
  const shell = {
    clearBody() {
      for (const item of body) item.destroy();
      body.length = 0;
    },
    addEmptyStateRow() {},
    addStaticRow: () => new Actor(stage),
    addBodyItem: (item) => body.push(item),
  };
  return { stage, shell, body, activations, CompactPanelSection, createExpandAllControl };
}

function headers(body) {
  return body.filter((item) => item.styleClasses.has("provider-limits-matrix-header"));
}

function compactContext() {
  const model = (provider) => ({
    provider,
    displayName: provider,
    facts: {
      displayStatus: "ok",
      badges: { status: "" },
      usage: { header: { fillRatio: 0.5, tone: "ok", summaryText: "50%" } },
      diagnostic: { kind: null },
      panelViews: [],
      lastUpdatedText: null,
    },
    panelViews: [],
  });
  return {
    lastRefreshAt: null,
    view: {
      activeProviders: ["codex", "claude"],
      models: [model("codex"), model("claude")],
      t: (text) => text,
    },
  };
}

test("compact headers restore focus after refresh and expansion rebuilds", () => {
  const { stage, shell, body, activations, CompactPanelSection, createExpandAllControl } =
    loadCompact();
  const section = new CompactPanelSection(shell, createExpandAllControl());
  const context = compactContext();
  section.render(context);

  headers(body)[1].grab_key_focus();
  const focused = headers(body)[1];
  assert.equal(stage.current, focused);

  section.render(context);
  assert.notEqual(headers(body)[1], focused, "the header was rebuilt");
  assert.equal(stage.current, headers(body)[1], "focus follows the Claude header");

  activations.get(headers(body)[1]).callback();
  assert.equal(stage.current, headers(body)[1], "focus survives an expansion rebuild");

  const footer = new Actor(stage, { accessible_name: "footer" });
  footer.grab_key_focus();
  section.render(context);
  assert.equal(stage.current, footer, "an unfocused header does not steal focus");
});
