import { test } from "node:test";

import { assert, load, timers } from "../helpers/node-harness.mjs";

test("preferences close disconnects bindings/pages and cancels pending rebuild; reopening is safe", async () => {
  const glib = timers();
  const K = load("src/prefs.ts", "ProviderLimitsPreferences", {
    ExtensionPreferences: class {},
    Gio: { _promisify() {}, File: { prototype: {} } },
    GLib: glib,
    isDisposablePage: (p) => typeof p.cleanup === "function",
  });
  const prefs = new K();
  const subscriptions = new Map();
  let next = 0;
  const settings = {
    connect: (_name, fn) => {
      subscriptions.set(++next, fn);
      return next;
    },
    disconnect: (id) => {
      assert.ok(subscriptions.delete(id));
    },
  };
  prefs.getSettings = () => settings;
  let cleanups = 0;
  let state;
  prefs._buildWindow = (_window, _settings, windowState) => {
    state = windowState;
    state.pages.push({ cleanup: () => cleanups++ });
  };
  for (let round = 0; round < 2; round++) {
    const signals = new Map();
    const window = { connect: (name, fn) => signals.set(name, fn), remove() {} };
    await prefs.fillPreferencesWindow(window);
    prefs._scheduleWindowRebuild(window, settings, state);
    signals.get("close-request")();
    signals.get("destroy")();
    assert.equal(subscriptions.size, 0);
    assert.equal(glib.sources.size, 0);
    assert.equal(state.pages.length, 0);
  }
  assert.equal(cleanups, 2);
});

test("late destruction of an old preferences window cannot tear down a reopened window", async () => {
  const K = load("src/prefs.ts", "ProviderLimitsPreferences", {
    ExtensionPreferences: class {},
    Gio: { _promisify() {}, File: { prototype: {} } },
    GLib: timers(),
    isDisposablePage: () => true,
  });
  const prefs = new K();
  let id = 0;
  let cleaned = 0;
  const active = new Set();
  const settings = {
    connect: () => {
      active.add(++id);
      return id;
    },
    disconnect: (key) => active.delete(key),
  };
  prefs.getSettings = () => settings;
  const states = [];
  prefs._buildWindow = (_window, _settings, state) => {
    states.push(state);
    state.pages.push({ cleanup: () => cleaned++ });
  };
  const firstSignals = new Map(),
    secondSignals = new Map();
  const window = (signals) => ({ connect: (name, fn) => signals.set(name, fn), remove() {} });
  await prefs.fillPreferencesWindow(window(firstSignals));
  firstSignals.get("close-request")();
  await prefs.fillPreferencesWindow(window(secondSignals));
  firstSignals.get("destroy")();
  assert.equal(states[0].pages.length, 0);
  assert.equal(states[1].pages.length, 1);
  assert.equal(active.size, 1);
  secondSignals.get("close-request")();
  assert.equal(cleaned, 2);
  assert.equal(active.size, 0);
});
