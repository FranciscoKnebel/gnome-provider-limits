import { test } from "node:test";

import { assert, load } from "../helpers/node-harness.mjs";

test("PanelShell footer actors persist and focus scrolling is wired for every panel style", () => {
  class Actor {
    constructor(props = {}) {
      Object.assign(this, props);
      this.children = [];
      this.styleClasses = new Set();
      this.handlers = new Map();
      this.visible = props.visible ?? true;
      this.reactive = props.reactive ?? false;
      this.text = props.text ?? "";
      this.accessible_name = props.accessible_name ?? "";
    }
    add_child(child) {
      this.children.push(child);
      child.parent = this;
    }
    remove_child(child) {
      this.children = this.children.filter((value) => value !== child);
    }
    add_style_class_name(cls) {
      this.styleClasses.add(cls);
    }
    remove_style_class_name(cls) {
      this.styleClasses.delete(cls);
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
      this.focused = true;
    }
    queue_repaint() {
      this.repaints = (this.repaints ?? 0) + 1;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  class SpinnerStub extends Actor {
    constructor(size, params) {
      super({ ...params, size });
      this.playing = false;
    }
    play() {
      this.playing = true;
    }
    stop() {
      this.playing = false;
    }
  }
  class ScrollViewStub extends Actor {
    set_policy(horizontal, vertical) {
      this.policy = [horizontal, vertical];
    }
    set_child(child) {
      this.add_child(child);
    }
  }
  class MenuSectionStub extends Actor {
    constructor() {
      super();
      this.box = new Actor();
      this.actor = new Actor();
      this.items = [];
    }
    addMenuItem(item, position) {
      if (position === undefined) this.items.push(item);
      else this.items.splice(position, 0, item);
      this.box.add_child(item.actor ?? item);
    }
    removeAll() {
      this.items = [];
      this.box.children = [];
    }
  }

  const focusCalls = [];
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
  const { bindActivation } = load("src/helpers/keyboard.ts", "({ bindActivation })", { Clutter });
  const { PanelShell } = load("src/ui/panelShell.ts", "({ PanelShell })", {
    Clutter,
    _: (message) => message,
    bindActivation,
    GLib: { getenv: () => null },
    St: {
      BoxLayout: Actor,
      Label: Actor,
      Icon: Actor,
      Button: Actor,
      Widget: Actor,
      ScrollView: ScrollViewStub,
      PolicyType: { NEVER: 0, AUTOMATIC: 1 },
      ThemeContext: { get_for_stage: () => ({ scale_factor: 1 }) },
    },
    Spinner: SpinnerStub,
    Main: {
      layoutManager: {
        findMonitorForActor: () => null,
        getWorkAreaForMonitor: () => ({ height: 800 }),
      },
    },
    PopupMenu: { PopupBaseMenuItem: Actor, PopupMenuSection: MenuSectionStub },
    ensureActorVisibleInScrollView: (scroll, row) => focusCalls.push([scroll, row]),
    setScrollViewChild: (scroll, actor) => scroll.set_child(actor),
    formatTimestampTemplate: (_pattern, at, locale) => (at === null ? "" : `${at}:${locale}`),
    resolveLocale: (setting, messages, lang) => setting || messages || lang || "en",
  });

  for (const style of ["gauges", "cards", "compact"]) {
    focusCalls.length = 0;
    let refreshes = 0;
    let closes = 0;
    let preferences = 0;
    const shell = new PanelShell({
      settings: { get_string: () => "en" },
      onRefresh: () => refreshes++,
      openPreferences: () => preferences++,
      closeMenu: () => closes++,
      translate: (message) => message,
      footerVariant: style,
    });

    const footer = shell.footer;
    assert.equal(footer.running, false, `${style}: footer owns its initial running state`);

    if (style === "compact") {
      assert.equal(shell.items[0], footer.row, `${style}: toolbar stays above the scroll area`);
    } else {
      assert.equal(
        shell.items[shell.items.length - 1],
        footer.row,
        `${style}: footer stays below the scroll area`,
      );
    }
    const persistent = {
      row: footer.row,
      refresh: footer.refreshControl,
      spinner: footer.spinner,
      timestamp: footer.lastRefreshLabel,
      settings: footer.settingsControl,
    };

    footer.refreshControl.fire("clicked");
    footer.settingsControl.fire("clicked");
    assert.equal(refreshes, 1, `${style}: refresh activation survives construction`);
    assert.equal(closes, 1, `${style}: menu closes before preferences open`);
    assert.equal(preferences, 1, `${style}: preferences opened once`);

    const firstRow = shell.addStaticRow();
    shell.addBodyItem(firstRow);
    firstRow.fire("key-focus-in");
    shell.clearBody();
    const secondRow = shell.addStaticRow();
    shell.addBodyItem(secondRow);
    secondRow.fire("key-focus-in");

    assert.equal(focusCalls.length, 2, `${style}: both static rows requested focus scrolling`);
    assert.equal(focusCalls[0][0], shell.scrollView);
    assert.equal(focusCalls[0][1], firstRow);
    assert.equal(focusCalls[1][0], shell.scrollView);
    assert.equal(focusCalls[1][1], secondRow);

    shell.setRunning(true);
    shell.setLastRefreshAt(123);
    assert.equal(shell.footer.row, persistent.row, `${style}: footer row persists`);
    assert.equal(shell.footer.refreshControl, persistent.refresh, `${style}: refresh persists`);
    assert.equal(shell.footer.spinner, persistent.spinner, `${style}: spinner persists`);
    assert.equal(
      shell.footer.lastRefreshLabel,
      persistent.timestamp,
      `${style}: timestamp persists`,
    );
    assert.equal(shell.footer.settingsControl, persistent.settings, `${style}: settings persists`);
    assert.equal(shell.footer.spinner.playing, true, `${style}: spinner plays while running`);
    assert.equal(shell.footer.running, true, `${style}: footer owns its running state`);
    assert.equal(
      shell.footer.refreshControl.styleClasses.has("pl-footer-action-disabled"),
      style === "cards",
      `${style}: disabled style comes from the footer spec`,
    );
    assert.equal(
      shell.footer.lastRefreshLabel.text,
      "123:en",
      `${style}: timestamp updated in place`,
    );

    footer.refreshControl.fire("clicked");
    assert.equal(refreshes, 1, `${style}: refresh stays disabled while running`);
    shell.setRunning(false);
    assert.equal(footer.running, false, `${style}: footer running state clears`);
    footer.refreshControl.fire("clicked");
    assert.equal(refreshes, 2, `${style}: refresh re-enabled after running`);

    shell.destroy();
  }
});
