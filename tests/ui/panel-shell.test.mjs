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
  const footerGlobals = {
    Clutter,
    _: (message) => message,
    bindActivation,
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
    PopupMenu: { PopupBaseMenuItem: Actor },
    formatTimestampTemplate: (_pattern, at, locale) => (at === null ? "" : `${at}:${locale}`),
  };
  const { STYLE_CATALOG } = load("src/ui/styleCatalog.ts", "({ STYLE_CATALOG })");
  const { buildGaugesFooter, buildCardsFooter, buildHudFooter } = load(
    "src/ui/panelFooter.ts",
    "({ buildGaugesFooter, buildCardsFooter, buildHudFooter })",
    footerGlobals,
  );
  const { STYLE_REGISTRY } = load("src/ui/styles.ts", "({ STYLE_REGISTRY })", {
    STYLE_CATALOG,
    buildGaugesFooter,
    buildCardsFooter,
    buildHudFooter,
  });
  const { PanelShell } = load("src/ui/panelShell.ts", "({ PanelShell })", {
    Clutter,
    _: footerGlobals._,
    St: footerGlobals.St,
    Main: {
      layoutManager: {
        findMonitorForActor: () => null,
        getWorkAreaForMonitor: () => ({ height: 800 }),
      },
    },
    PopupMenu: { PopupBaseMenuItem: Actor, PopupMenuSection: MenuSectionStub },
    ensureActorVisibleInScrollView: (scroll, row) => focusCalls.push([scroll, row]),
    setScrollViewChild: (scroll, actor) => scroll.set_child(actor),
    formatTimestampTemplate: footerGlobals.formatTimestampTemplate,
  });

  for (const style of ["gauges", "cards", "compact"]) {
    focusCalls.length = 0;
    let refreshes = 0;
    let closes = 0;
    let preferences = 0;
    const extraControl = style === "compact" ? new Actor({ text: "expand" }) : null;
    const shell = new PanelShell({
      onRefresh: () => refreshes++,
      openPreferences: () => preferences++,
      closeMenu: () => closes++,
      style: STYLE_REGISTRY.panel[style],
      extraControls: extraControl ? [extraControl] : [],
    });

    const footer = shell.footer;
    assert.equal(footer.spinner.playing, false, `${style}: spinner idle initially`);
    assert.equal(footer.refreshControl.reactive, true, `${style}: refresh enabled initially`);

    if (style === "compact") {
      assert.equal(shell.items[0], footer.row, `${style}: toolbar stays above the scroll area`);
      assert.equal(footer.row.children.length, 2, `${style}: the shell owns the HUD toolbar`);
      const [leading, actions] = footer.row.children;
      assert.equal(
        leading.style_class,
        "provider-limits-hud-toolbar-left",
        `${style}: leading box class comes from the HUD footer builder`,
      );
      assert.deepEqual(
        leading.children.map((child) => child.text),
        ["Provider Limits", ""],
        `${style}: title leads the leading box and the timestamp is hidden initially`,
      );
      assert.equal(leading.children[1], footer.lastRefreshLabel);
      assert.equal(
        actions.style_class,
        "provider-limits-hud-actions",
        `${style}: actions box class comes from the HUD footer builder`,
      );
      assert.deepEqual(
        actions.children,
        [extraControl, footer.refreshControl, footer.settingsControl],
        `${style}: extra controls lead the action box`,
      );
      assert.equal(
        footer.lastRefreshLabel.style_class,
        "provider-limits-hud-meta provider-limits-tnum",
        `${style}: timestamp variant comes from the HUD footer builder`,
      );
    } else {
      assert.equal(
        shell.items[shell.items.length - 1],
        footer.row,
        `${style}: footer stays below the scroll area`,
      );
      assert.equal(footer.row.children.length, 1, `${style}: one toolbar lives in the footer`);
      const toolbar = footer.row.children[0];
      assert.equal(
        toolbar.style_class,
        style === "gauges" ? "pl-footer-toolbar" : "pl-panel-footer",
        `${style}: toolbar class comes from the style footer builder`,
      );
      assert.deepEqual(
        toolbar.children,
        [footer.refreshControl, footer.lastRefreshLabel, footer.settingsControl],
        `${style}: toolbar child order is preserved`,
      );
      assert.equal(
        footer.lastRefreshLabel.style_class,
        "provider-limits-dim pl-footer-timestamp",
        `${style}: timestamp class comes from the style footer builder`,
      );
    }

    const refreshClass =
      style === "gauges"
        ? "pl-footer-button pl-refresh-button"
        : style === "cards"
          ? "pl-footer-action pl-refresh-action"
          : "provider-limits-icon-button";
    assert.equal(
      footer.refreshControl.style_class,
      refreshClass,
      `${style}: refresh control class comes from the style footer builder`,
    );
    if (style === "gauges") {
      assert.equal(
        footer.refreshControl.child.style_class,
        "pl-footer-button-box",
        `${style}: refresh content box class is preserved`,
      );
      assert.equal(
        footer.refreshControl.child.children[0],
        footer.spinner,
        `${style}: spinner leads the refresh label`,
      );
    }
    if (style === "compact") {
      assert.equal(
        footer.refreshControl.child.children[1],
        footer.spinner,
        `${style}: spinner follows the compact icon`,
      );
    }
    const persistent = {
      row: footer.row,
      refresh: footer.refreshControl,
      spinner: footer.spinner,
      timestamp: footer.lastRefreshLabel,
      settings: footer.settingsControl,
    };

    const pointerSignal = style === "cards" ? "button-release-event" : "clicked";
    const otherSignal = style === "cards" ? "clicked" : "button-release-event";
    footer.refreshControl.fire(otherSignal);
    assert.equal(refreshes, 0, `${style}: only the intended pointer signal is bound`);
    footer.refreshControl.fire(pointerSignal);
    footer.settingsControl.fire(pointerSignal);
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
    shell.setLastRefreshAt(123, "en");
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
    assert.equal(shell.footer.spinner.visible, true, `${style}: spinner visible while running`);
    assert.equal(
      shell.footer.refreshControl.reactive,
      false,
      `${style}: refresh disabled while running`,
    );
    assert.equal(
      shell.footer.refreshControl.styleClasses.has("pl-footer-action-disabled"),
      style === "cards",
      `${style}: disabled style comes from the cards footer builder`,
    );
    assert.equal(
      shell.footer.lastRefreshLabel.text,
      "123:en",
      `${style}: timestamp updated in place`,
    );

    footer.refreshControl.fire(pointerSignal);
    assert.equal(refreshes, 1, `${style}: refresh stays disabled while running`);
    shell.setRunning(false);
    assert.equal(footer.spinner.playing, false, `${style}: spinner stops when running clears`);
    assert.equal(footer.spinner.visible, false, `${style}: spinner hidden when running clears`);
    footer.refreshControl.fire(pointerSignal);
    assert.equal(refreshes, 2, `${style}: refresh re-enabled after running`);

    shell.destroy();
  }
});
