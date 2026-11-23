import { test } from "node:test";

import { assert, load, timers } from "../helpers/node-harness.mjs";

function indicator() {
  const glib = timers();
  let disposed = false;
  const calls = [];
  const K = load("src/extension.ts", "ProviderLimitsIndicator", {
    GObject: { registerClass: (k) => k },
    PanelMenu: {
      Button: class {
        destroy() {
          disposed = true;
        }
      },
    },
    Extension: class {},
    GLib: glib,
    PROVIDER_NAMES: [],
    normalizeProvidersOrder: (a) => a,
    readerResultsEqual: (a, b) => JSON.stringify(a.fields) === JSON.stringify(b.fields),
    currentRefreshInterval: () => 10,
    ReaderStatus: { ERROR: "ERROR" },
    DEFAULT_REFRESH_SHORT_INTERVAL_SECONDS: 10,
  });
  const i = new K();
  Object.assign(i, {
    _destroyed: false,
    _refreshGeneration: 0,
    _pendingRefreshes: 0,
    _readers: new Map(),
    _results: new Map(),
    _stableReads: 0,
    _refreshSourceId: null,
    _refreshStopSourceId: null,
    _renderDebounceId: null,
    _settingsChangedIds: [],
    _menuStateChangedId: 0,
    _settings: { get_strv: () => ["codex"], get_int: () => 10 },
    menu: { isOpen: true },
    _statusBar: {
      render: (r) => {
        assert.ok(!disposed);
        calls.push(["status", r]);
      },
    },
    _panel: {
      render: (r, at) => {
        assert.ok(!disposed);
        calls.push(["panel", r, at]);
      },
      setRunning: (v) => {
        assert.ok(!disposed);
        calls.push(["running", v]);
      },
    },
  });
  return { i, glib, calls };
}

test("stable Refresh updates visible timestamps/countdowns while Panel is open", async () => {
  const { i, calls } = indicator();
  let at = 100;
  i._readers.set("codex", { read: async () => ({ fields: [{ value: 42 }], lastUpdated: at }) });
  await i.refresh();
  at = 200;
  await i.refresh();
  assert.equal(i._stableReads, 1);
  assert.equal(calls.filter(([name]) => name === "panel").length, 2);
  assert.equal(calls.filter(([name]) => name === "status").length, 2);
  assert.equal(i._results.get("codex").lastUpdated, 200);
});

test("scheduled timer releases its ID before dispatch, including overlapping Refresh", async () => {
  const { i, glib } = indicator();
  i._restartRefreshTimer();
  glib.fire(i._refreshSourceId);
  assert.equal(i._refreshSourceId, null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.notEqual(i._refreshSourceId, null);
  i.destroy();
  assert.equal(glib.sources.size, 0);
});

for (const elapsed of [0, 3000])
  test(`pending completion after destroy creates no timers/UI (${elapsed}ms)`, async () => {
    const { i, glib, calls } = indicator();
    let complete;
    i._readers.set("codex", {
      read: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
      destroy() {},
    });
    const pending = i.refresh();
    i.destroy();
    const before = calls.length;
    const now = Date.now;
    Date.now = () => now() + elapsed;
    try {
      complete({ fields: [], lastUpdated: 100 });
      await pending;
    } finally {
      Date.now = now;
    }
    assert.equal(calls.length, before);
    assert.equal(glib.sources.size, 0);
    assert.equal(i._pendingRefreshes, 0);
    await i.refresh();
    assert.equal(calls.length, before);
  });
