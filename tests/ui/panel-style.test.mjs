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
    setLastRefreshAt(lastRefreshAt) {
      this.lastRefreshAt = lastRefreshAt;
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
    constructor(settings, readers, fieldDefs, shell) {
      this.settings = settings;
      this.readers = readers;
      this.fieldDefs = fieldDefs;
      this.shell = shell;
      this.rendered = [];
      this.running = null;
      this.destroyed = false;
      created.push(this);
    }
    render(context) {
      this.rendered.push(context);
    }
    setRunning(running) {
      this.running = running;
      this.shell.setRunning(running);
    }
    destroy() {
      this.destroyed = true;
      this.shell.destroy();
    }
  }
  class GaugesStub extends SectionStub {}
  class CardsStub extends SectionStub {}
  class CompactStub extends SectionStub {}

  const { resolvePanelStyle } = load("src/ui/styles.ts", "({ resolvePanelStyle })");
  const view = { marker: "provider-view-settings" };
  const K = load("src/ui/panel.ts", "PanelWidget", {
    PopupMenu: { PopupMenuSection: Section },
    GaugesPanelSection: GaugesStub,
    CardsPanelSection: CardsStub,
    CompactPanelSection: CompactStub,
    PanelShell: ShellStub,
    resolvePanelStyle,
    viewContextFor: () => view,
    resolveLocale: () => "en",
    GLib: { getenv: () => null },
    PROVIDER_FIELDS: {},
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
  const fireStyleChange = () => panel.render(results, 100);
  const openPreferences = () => {};
  const onRefresh = () => {};
  const closeMenu = () => {};
  const panel = new K(settings, new Map(), openPreferences, onRefresh, closeMenu);
  assert.equal(created.length, 1);
  assert.ok(created[0] instanceof GaugesStub);
  assert.equal(created[0].shell.options.footerVariant, "gauges");
  assert.equal(created[0].shell.options.onRefresh, onRefresh);
  assert.equal(created[0].shell.options.openPreferences, openPreferences);
  assert.equal(created[0].shell.options.closeMenu, closeMenu);

  const results = new Map([["codex", {}]]);
  panel.render(results, 100);
  assert.equal(created[0].rendered.length, 1);
  assert.equal(created[0].rendered[0].lastRefreshAt, 100);
  assert.equal(created[0].shell.lastRefreshAt, 100);
  assert.equal(created[0].rendered[0].view, view, "the canonical view snapshot is forwarded");
  panel.setRunning(true);
  assert.equal(created[0].running, true);

  style = "cards";
  fireStyleChange();
  assert.equal(created.length, 2);
  assert.ok(created[1] instanceof CardsStub);
  assert.equal(created[0].destroyed, true);
  assert.equal(created[0].shell.destroyed, true);
  assert.equal(created[1].shell.options.footerVariant, "cards");
  assert.equal(created[1].rendered.length, 1);
  assert.equal(created[1].rendered[0].lastRefreshAt, 100);
  assert.equal(created[1].shell.lastRefreshAt, 100);
  assert.equal(created[1].running, true);

  style = "compact";
  fireStyleChange();
  assert.equal(created.length, 3);
  assert.ok(created[2] instanceof CompactStub);
  assert.equal(created[1].destroyed, true);
  assert.equal(created[2].shell.options.footerVariant, "compact");

  style = "not-a-style";
  fireStyleChange();
  assert.equal(created.length, 4);
  assert.ok(created[3] instanceof GaugesStub, "unknown style falls back to DEFAULT_PANEL_STYLE");
  assert.equal(created[3].shell.options.footerVariant, "gauges");

  panel.destroy();
  assert.equal(created[2].destroyed, true);
  assert.equal(listeners.size, 0);
});
