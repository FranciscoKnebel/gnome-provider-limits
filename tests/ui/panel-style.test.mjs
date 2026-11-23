import { test } from "node:test";

import { assert, load } from "../helpers/node-harness.mjs";

test("Panel swaps style sections on setting change and forwards render and running state", () => {
  class Actor {
    children = [];
    constructor(props = {}) {
      Object.assign(this, props);
    }
    add_child(child) {
      this.children.push(child);
    }
    remove_child(child) {
      this.children = this.children.filter((value) => value !== child);
    }
  }
  class Section {
    actor = new Actor();
    box = this.actor;
    items = [];
    addMenuItem(item, position) {
      if (position === undefined) this.items.push(item);
      else this.items.splice(position, 0, item);
      this.box.add_child(item.actor ?? item);
    }
    destroy() {}
  }
  class ShellStub extends Actor {
    constructor(options) {
      super();
      this.options = options;
      this.actor = this;
      this.destroyed = false;
      this.running = false;
    }
    destroy() {
      this.destroyed = true;
    }
    setLastRefreshAt(lastRefreshAt, locale) {
      this.lastRefreshAt = lastRefreshAt;
      this.locale = locale;
    }
    setRunning(running) {
      this.running = running;
    }
    isRunning() {
      return this.running;
    }
  }
  const created = [];
  class SectionStub {
    constructor(shell) {
      this.shell = shell;
      this.rendered = [];
      this.running = false;
      created.push(this);
    }
    render(context) {
      this.rendered.push(context);
    }
    setRunning(running) {
      this.running = running;
    }
  }
  class GaugesStub extends SectionStub {
    constructor(settings, shell) {
      super(shell);
    }
  }
  class CardsStub extends SectionStub {}
  class CompactStub extends SectionStub {
    constructor(shell, expandAll) {
      super(shell);
      this.expandAll = expandAll;
    }
  }

  const { STYLE_CATALOG, resolvePanelStyle } = load(
    "src/ui/styleCatalog.ts",
    "({ STYLE_CATALOG, resolvePanelStyle })",
  );
  const { STYLE_REGISTRY } = load("src/ui/styles.ts", "({ STYLE_REGISTRY })", {
    STYLE_CATALOG,
    GaugesPanelSection: GaugesStub,
    CardsPanelSection: CardsStub,
    CompactPanelSection: CompactStub,
    createExpandAllControl: () => ({ button: new Actor(), label: new Actor() }),
    buildGaugesFooter: () => ({}),
    buildCardsFooter: () => ({}),
    buildHudFooter: () => ({}),
  });
  const view = { marker: "provider-view-settings", locale: "en" };
  const K = load("src/ui/panel.ts", "PanelWidget", {
    PopupMenu: { PopupMenuSection: Section },
    PanelShell: ShellStub,
    resolvePanelStyle,
    STYLE_REGISTRY,
    _: (message) => message,
  });

  let style = "gauges";
  let nextListenerId = 1;
  const listeners = new Map();
  const settings = {
    get_string: () => style,
    connect: (name, fn) => {
      const id = nextListenerId++;
      listeners.set(id, { name, fn });
      return id;
    },
    disconnect: (id) => listeners.delete(id),
  };
  // Style ownership is central: the indicator re-renders on key change, so the
  // panel observes a new style through render(), not through its own signal handler.
  const fireStyleChange = () => panel.render(view, 100);
  const openPreferences = () => {};
  const onRefresh = () => {};
  const closeMenu = () => {};
  const panel = new K(settings, openPreferences, onRefresh, closeMenu);
  assert.equal(created.length, 1);
  assert.ok(created[0] instanceof GaugesStub);
  assert.equal(created[0].shell.options.style.id, "gauges");
  assert.equal(created[0].shell.options.onRefresh, onRefresh);
  assert.equal(created[0].shell.options.openPreferences, openPreferences);
  assert.equal(created[0].shell.options.closeMenu, closeMenu);

  panel.render(view, 100);
  assert.equal(created[0].rendered.length, 1);
  assert.equal(created[0].rendered[0].lastRefreshAt, 100);
  assert.equal(created[0].shell.lastRefreshAt, 100);
  assert.equal(created[0].shell.locale, "en", "the view locale reaches the shell timestamp");
  assert.equal(created[0].rendered[0].view, view, "the canonical view snapshot is forwarded");
  panel.setRunning(true);
  assert.equal(created[0].shell.running, true);
  assert.equal(created[0].running, true, "the section receives the running state too");

  style = "cards";
  fireStyleChange();
  assert.equal(created.length, 2);
  assert.ok(created[1] instanceof CardsStub);
  assert.equal(created[0].shell.destroyed, true);
  assert.equal(created[1].shell.options.style.id, "cards");
  assert.equal(created[1].rendered.length, 1);
  assert.equal(created[1].rendered[0].lastRefreshAt, 100);
  assert.equal(created[1].shell.lastRefreshAt, 100);
  assert.equal(created[1].shell.running, true);

  style = "compact";
  fireStyleChange();
  assert.equal(created.length, 3);
  assert.ok(created[2] instanceof CompactStub);
  assert.equal(created[1].shell.destroyed, true);
  assert.equal(created[2].shell.options.style.id, "compact");

  style = "not-a-style";
  fireStyleChange();
  assert.equal(created.length, 4);
  assert.ok(created[3] instanceof GaugesStub, "unknown style falls back to DEFAULT_PANEL_STYLE");
  assert.equal(created[3].shell.options.style.id, "gauges");

  panel.destroy();
  assert.equal(created[2].shell.destroyed, true);
  assert.equal(listeners.size, 0);
});
