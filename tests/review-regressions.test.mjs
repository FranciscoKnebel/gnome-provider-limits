import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";

import ts from "typescript";

function load(path, expression, globals = {}) {
  const compiled = ts
    .transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    })
    .outputText.replace(/^import[\s\S]*?;\n/gm, "")
    .replace(/export default /g, "")
    .replace(/export /g, "");
  return vm.runInNewContext(`${compiled}\n;${expression}`, {
    console,
    Error,
    TextEncoder,
    TextDecoder,
    Date,
    Map,
    Set,
    Promise,
    ...globals,
  });
}

function timers() {
  let next = 1;
  const sources = new Map();
  return {
    sources,
    timeout_add: (_p, _ms, fn) => {
      const id = next++;
      sources.set(id, fn);
      return id;
    },
    timeout_add_seconds: (_p, _s, fn) => {
      const id = next++;
      sources.set(id, fn);
      return id;
    },
    idle_add: (_p, fn) => {
      const id = next++;
      sources.set(id, fn);
      return id;
    },
    Source: {
      remove(id) {
        assert.ok(sources.delete(id), `removing expired timer ${id}`);
      },
    },
    fire(id) {
      const fn = sources.get(id);
      assert.ok(fn);
      sources.delete(id);
      fn();
    },
    SOURCE_REMOVE: false,
  };
}

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

test("reordering preserves unknown fields and uses identities in both directions", () => {
  const reorder = load("src/helpers/reorder.ts", "reorderValue");
  for (const values of [
    ["obsolete", "A", "B", "C"],
    ["A", "obsolete", "B", "C"],
  ]) {
    const result = Array.from(reorder(values, "C", "B"));
    assert.deepEqual(
      result.filter((v) => v !== "obsolete"),
      ["A", "C", "B"],
    );
    assert.ok(result.includes("obsolete"));
  }
  assert.deepEqual(Array.from(reorder(["A", "x", "B", "C"], "A", "C")), ["x", "B", "C", "A"]);
  assert.equal(reorder(["A", "B"], "A", "A"), null);
  assert.equal(reorder(["A", "B"], "missing", "B"), null);
});

test("preferences close disconnects bindings/pages and cancels pending rebuild; reopening is safe", async () => {
  const glib = timers();
  const K = load("src/prefs.ts", "ProviderLimitsPreferences", {
    ExtensionPreferences: class {},
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
  prefs._buildWindow = () => {
    prefs._pages.push({ cleanup: () => cleanups++ });
    if (prefs._languageChangedId) settings.disconnect(prefs._languageChangedId);
    prefs._languageChangedId = settings.connect("enabled", () => {});
  };
  for (let round = 0; round < 2; round++) {
    const signals = new Map();
    const window = { connect: (name, fn) => signals.set(name, fn), remove() {} };
    await prefs.fillPreferencesWindow(window);
    prefs._scheduleWindowRebuild(window, settings);
    signals.get("close-request")();
    signals.get("destroy")();
    assert.equal(subscriptions.size, 0);
    assert.equal(glib.sources.size, 0);
    assert.equal(prefs._pages.length, 0);
  }
  assert.equal(cleanups, 2);
});

test("both promise lint rules reject controlled negative fixtures", () => {
  const path = `src/__promise_lint_probe_${process.pid}.ts`;
  try {
    writeFileSync(
      path,
      "Promise.resolve(1);\nconst use = (_f: () => void): void => {};\nuse(async () => { await Promise.resolve(); });\n",
    );
    const result = spawnSync("node_modules/.bin/oxlint", ["--type-aware", path], {
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /no-floating-promises/);
    assert.match(result.stdout + result.stderr, /no-misused-promises/);
  } finally {
    unlinkSync(path);
  }
});

test("SQLite syscall boundary reads complete WAL without touching files; incomplete/recovery fails safely", () => {
  const script = readFileSync("src/helpers/sqlite.ts", "utf8")
    .split("String.raw`")[1]
    .split("`;")[0];
  const dir = mkdtempSync(join(tmpdir(), "provider-limits-sqlite-"));
  try {
    const helper = join(dir, "read.py");
    writeFileSync(helper, script);
    const result = spawnSync(
      "python3",
      [
        "-c",
        `
import hashlib, json, os, pathlib, sqlite3, subprocess, sys
root, helper = pathlib.Path(sys.argv[1]), sys.argv[2]
def snapshot(db):
    return {str(p): (p.stat().st_mtime_ns, hashlib.sha256(p.read_bytes()).hexdigest())
            for p in root.glob(db.name+'*')}
def run(db, query='select * from t'):
    before = snapshot(db)
    r = subprocess.run([sys.executable,helper,str(db),query], capture_output=True, text=True)
    assert snapshot(db) == before, (db.name, r.stderr)
    return r
for state in ['plain','complete','closed-wal','wal-only','shm-only','journal']:
    db=root/state
    if state == 'journal':
        creator = "import os,sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('create table t(v)'); c.commit(); c.execute('pragma cache_size=1'); c.execute('begin immediate'); c.executemany('insert into t values(?)', [(str(i)*100,) for i in range(1000)]); os._exit(0)"
        subprocess.check_call([sys.executable,'-c',creator,str(db)])
    else:
        c=sqlite3.connect(db)
        if state != 'plain': c.execute('pragma journal_mode=wal')
        c.execute('create table t(v)'); c.execute('insert into t values(1)'); c.commit()
        if state == 'wal-only': os.unlink(str(db)+'-shm')
        if state == 'shm-only': os.unlink(str(db)+'-wal')
        if state == 'closed-wal': c.close()
    r=run(db)
    if state in ('plain','complete','closed-wal'): assert r.returncode == 0, r.stderr
    if state == 'closed-wal': assert json.loads(r.stdout) == [{'v': 1}], r.stdout
    if state in ('wal-only','shm-only','journal'): assert r.returncode != 0, (state,r.stdout)
    assert run(db, 'create table forbidden(v)').returncode != 0
    if state not in ('journal','closed-wal'): c.close()
# Sidecar cleanup at different points during open/read must never be undone.
for i, delay in enumerate([0, 0.005, 0.02, 0.04, 0.08]):
    db = root / ('race-' + str(i))
    c = sqlite3.connect(db); c.execute('pragma journal_mode=wal')
    c.execute('create table t(v)'); c.execute('insert into t values(1)'); c.commit()
    before = snapshot(db)
    cleanup = subprocess.Popen([sys.executable, '-c',
        'import os,sys,time; time.sleep(float(sys.argv[2])); os.unlink(sys.argv[1])',
        str(db)+'-shm', str(delay)])
    subprocess.run([sys.executable, helper, str(db), 'select * from t'], capture_output=True)
    assert cleanup.wait() == 0
    assert not pathlib.Path(str(db)+'-shm').exists(), 'reader recreated shared memory'
    after = snapshot(db)
    for path, state in after.items(): assert before[path] == state, path
    c.close()
# A missing path may race with the caller's existence check; it must not be created.
r=run(root/'missing'); assert r.returncode != 0
`,
        dir,
        helper,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

class Cancellable {
  handlers = new Map();
  cancelled = false;
  next = 1;
  connect(fn) {
    const id = this.next++;
    this.handlers.set(id, fn);
    if (this.cancelled) fn();
    return id;
  }
  disconnect(id) {
    this.handlers.delete(id);
  }
  is_cancelled() {
    return this.cancelled;
  }
  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    for (const fn of this.handlers.values()) fn();
  }
}
const gio = { Cancellable, _promisify() {}, File: { prototype: {} } };
function httpHarness() {
  const glib = timers();
  glib.get_monotonic_time = () => 0;
  const errors = load(
    "src/helpers/http.ts",
    "({ HttpClient, HttpError, TokenError, RateLimitError, NetworkError })",
    {
      Gio: gio,
      GLib: glib,
      Soup: { Session: class {}, Message: { new: () => ({}) } },
      RETRY_MAX_ATTEMPTS: 3,
      RETRY_DEADLINE_MS: 15000,
      nextRetry: load("src/helpers/retry.ts", "nextRetry", {
        Math: { ...Math, floor: Math.floor, min: Math.min, random: () => 0 },
      }),
    },
  );
  return { glib, ...errors };
}

test("HTTP destroy is terminal during active IO and backoff, and cancels overlapping reads", async () => {
  for (const phase of ["IO", "backoff"]) {
    const { glib, HttpClient, NetworkError } = httpHarness();
    const client = new HttpClient({ abort() {} });
    let sends = 0;
    client._sendAndParse = (_m, cancellable) => {
      sends++;
      if (phase === "backoff") return Promise.reject(new NetworkError("offline"));
      return new Promise((_resolve, reject) =>
        cancellable.connect(() => reject(new NetworkError("cancelled"))),
      );
    };
    const first = client.getJson("https://example.invalid");
    const second = client.getJson("https://example.invalid");
    // Attach rejection observers before cancellation.
    const settled = Promise.allSettled([first, second]);
    await new Promise((resolve) => setImmediate(resolve));
    client.destroy();
    const outcomes = await settled;
    assert.ok(outcomes.every((r) => r.status === "rejected"));
    assert.equal(sends, 2);
    assert.equal(glib.sources.size, 0);
    assert.equal(client._lifetime.handlers.size, 0);
    await assert.rejects(client.getJson("https://example.invalid"));
    assert.equal(sends, 2);
    client.destroy();
  }
});

test("HTTP refuses an expired initial budget, long Retry-After, and late backoff wake-up", async () => {
  for (const mode of ["initial", "retry-after", "late-wake"]) {
    const { HttpClient, RateLimitError } = httpHarness();
    const client = new HttpClient({ abort() {} });
    let sends = 0;
    let clock = 0;
    client._monotonicMs = () => clock;
    client._sendAndParse = async () => {
      sends++;
      throw new RateLimitError("limited", null, mode === "retry-after" ? 60 : 0.05);
    };
    client._delay = async () => {
      clock = 100;
    };
    await assert.rejects(
      client.getJson("https://example.invalid", { deadlineMs: mode === "initial" ? 0 : 100 }),
    );
    assert.equal(sends, mode === "initial" ? 0 : 1);
    client.destroy();
  }
});

test("HTTP error construction through actual Codex Reader logging excludes provider prose and payload", async () => {
  const { HttpClient, HttpError, TokenError } = httpHarness();
  const output = [];
  const logs = load("src/helpers/log.ts", "({logWarn})", {
    console: { warn: (...args) => output.push(args) },
    Error,
  });
  const K = load("src/readers/codex.ts", "CodexReader", {
    CODEX_FIELDS: [],
    Gio: gio,
    BaseReader: class {},
    HttpError,
    TokenError,
    ...logs,
  });
  const reader = new K();
  const client = new HttpClient({ abort() {} });
  reader._http = {
    getJson: async () => {
      throw client._errorForStatus(403, {
        message: "No account for reviewer@example.invalid",
        error: { accountId: "private-account-123" },
      });
    },
  };
  assert.equal(await reader._fetchUsage("synthetic-not-a-real-token", null), null);
  const captured = JSON.stringify(output);
  assert.match(captured, /TokenError/);
  assert.match(captured, /403/);
  assert.doesNotMatch(captured, /reviewer|private-account|synthetic|No account/);
  client.destroy();
});

for (const phase of ["auth", "billing", "settings"])
  test(`Grok destruction during ${phase} prevents further requests`, async () => {
    let release;
    const waiting = new Promise((resolve) => {
      release = resolve;
    });
    let requests = 0;
    let clients = 0;
    let destroyed = 0;
    const K = load("src/readers/grok.ts", "GrokReader", {
      GROK_FIELDS: [],
      Gio: {
        ...gio,
        File: {
          prototype: {},
          new_for_path: () => ({
            load_contents_async: async () => {
              if (phase === "auth") await waiting;
              return [new TextEncoder().encode("synthetic")];
            },
          }),
        },
      },
      GLib: { getenv: () => null, get_home_dir: () => "/synthetic" },
      BaseReader: class {
        destroy() {}
        _lastGoodOrError() {
          return {};
        }
      },
      HttpClient: class {
        constructor() {
          clients++;
        }
        destroy() {
          destroyed++;
        }
        async getJson(url) {
          requests++;
          if (
            (phase === "billing" && url.includes("billing")) ||
            (phase === "settings" && url.includes("settings"))
          )
            await waiting;
          return {};
        }
      },
      parseGrokAuth: () => ({ token: "synthetic" }),
      normalizeGrokUsagePayload: () => ({ usedPercent: 1 }),
      logWarn() {},
      _: (s) => s,
      TokenError: class {},
    });
    const reader = new K();
    reader.settings = { get_string: () => "" };
    const pending = reader.read();
    const settled = Promise.allSettled([pending]);
    await new Promise((resolve) => setImmediate(resolve));
    const before = requests;
    reader.destroy();
    release();
    await settled;
    assert.equal(requests, before);
    assert.equal(reader._http, null);
    assert.equal(clients, phase === "auth" ? 0 : 1);
    assert.equal(destroyed, clients);
    await assert.rejects(reader.read());
  });

for (const phase of ["auth", "exchange", "usage", "plan"])
  test(`Cursor destruction during ${phase} prevents further requests`, async () => {
    let release;
    const waiting = new Promise((resolve) => {
      release = resolve;
    });
    let requests = 0;
    let clients = 0;
    let destroyed = 0;
    const K = load("src/readers/cursor.ts", "CursorReader", {
      CURSOR_FIELDS: [],
      Gio: {
        ...gio,
        File: {
          prototype: {},
          new_for_path: () => ({
            load_contents_async: async () => {
              if (phase === "auth") await waiting;
              return [new TextEncoder().encode("synthetic")];
            },
          }),
        },
      },
      GLib: { getenv: () => null, get_home_dir: () => "/synthetic" },
      BaseReader: class {
        destroy() {}
        _lastGoodOrError() {
          return {};
        }
      },
      HttpClient: class {
        constructor() {
          clients++;
        }
        destroy() {
          destroyed++;
        }
        async postJson(url) {
          requests++;
          if (
            (phase === "exchange" && url.includes("exchange_user_api_key")) ||
            (phase === "usage" && url.includes("GetCurrentPeriodUsage")) ||
            (phase === "plan" && url.includes("GetPlanInfo"))
          )
            await waiting;
          return { accessToken: "synthetic-token" };
        }
      },
      CURSOR_BACKEND_URL: "https://api2.cursor.sh",
      expandHomePath: (p) => p,
      resolveCursorAuthPaths: () => ["/synthetic/auth.json"],
      parseCursorAuth: () => ({ accessToken: null, apiKey: "synthetic-key" }),
      parseCursorEnvAuth: () => null,
      parseCursorExchangeResponse: () => "synthetic-token",
      normalizeCursorUsagePayload: () => ({ usedPercentCredits: 10 }),
      parseCursorPlanInfo: () => ({ planName: "Pro", resetAt: null }),
      FieldStatus: { OK: "ok", UNAVAILABLE: "unavailable" },
      logWarn() {},
      _: (s) => s,
      TokenError: class {},
    });
    const reader = new K();
    reader.settings = { get_string: () => "/synthetic/auth.json" };
    const pending = reader.read();
    const settled = Promise.allSettled([pending]);
    await new Promise((resolve) => setImmediate(resolve));
    const before = requests;
    reader.destroy();
    release();
    await settled;
    assert.equal(requests, before);
    assert.equal(reader._http, null);
    assert.equal(clients, phase === "auth" ? 0 : 1);
    assert.equal(destroyed, clients);
    await assert.rejects(reader.read());
  });

for (const phase of ["auth", "refresh", "quota", "tier"])
  test(`GoogleReader.destroy stops mid-flight ${phase} reads before later requests`, async () => {
    let release;
    const waiting = new Promise((resolve) => {
      release = resolve;
    });
    let requests = 0;
    let clients = 0;
    let destroyed = 0;
    const K = load("src/readers/google.ts", "GoogleReader", {
      GOOGLE_FIELDS: [],
      Gio: {
        _promisify() {},
        Cancellable: class {
          cancelled = false;
          cancel() {
            this.cancelled = true;
          }
          is_cancelled() {
            return this.cancelled;
          }
        },
        File: {
          new_for_path: () => ({
            load_contents_async: async () => {
              if (phase === "auth") await waiting;
              return [
                new TextEncoder().encode(
                  JSON.stringify({
                    refresh_token: "synthetic-refresh",
                    client_id: "synthetic-client",
                    client_secret: "synthetic-secret",
                  }),
                ),
              ];
            },
          }),
        },
      },
      GLib: {
        getenv: () => null,
        get_home_dir: () => "/home/tester",
        build_filenamev: (parts) => parts.join("/"),
      },
      BaseReader: class {
        destroy() {}
        _lastGoodOrError() {
          return {};
        }
        _errorResult() {
          return {};
        }
      },
      HttpClient: class {
        constructor() {
          clients++;
        }
        destroy() {
          destroyed++;
        }
        async postForm() {
          requests++;
          if (phase === "refresh") await waiting;
          return { access_token: "synthetic-access" };
        }
        async postJson(url) {
          requests++;
          if (
            (phase === "quota" && url.includes("retrieveUserQuotaSummary")) ||
            (phase === "tier" && url.includes("loadCodeAssist"))
          )
            await waiting;
          return {};
        }
      },
      GOOGLE_OAUTH_TOKEN_URL: "https://oauth2.googleapis.com/token",
      expandHomePath: (p) => p,
      resolveGoogleAuthPaths: () => ["/synthetic/oauth_creds.json"],
      parseGoogleAuth: () => ({
        accessToken: null,
        refreshToken: "synthetic-refresh",
        clientId: "synthetic-client",
        clientSecret: "synthetic-secret",
        projectId: "synthetic-proj",
      }),
      parseGoogleTokenResponse: () => "synthetic-access",
      resolveGoogleQuotaEndpoints: () => ["https://cloudcode-pa.googleapis.com"],
      normalizeGoogleQuotaSummary: () => ({
        session: { usedPercent: 15, resetAt: 1776000000 },
        weekly: null,
        thirdPartySession: null,
        thirdPartyWeekly: null,
        limitReached: false,
      }),
      normalizeGoogleAvailableModels: () => null,
      hasActiveGoogleUsage: () => true,
      mergeGoogleUsage: (_a, b) => b,
      parseGoogleTierName: () => "Google AI Ultra",
      FieldStatus: { OK: "ok", UNAVAILABLE: "unavailable" },
      logWarn() {},
      _: (s) => s,
      TokenError: class {},
    });
    const reader = new K();
    reader.settings = { get_string: () => "/synthetic/oauth_creds.json" };
    const pending = reader.read();
    const settled = Promise.allSettled([pending]);
    await new Promise((resolve) => setImmediate(resolve));
    const before = requests;
    reader.destroy();
    release();
    await settled;
    assert.equal(requests, before);
    assert.equal(reader._http, null);
    assert.equal(clients, phase === "auth" ? 0 : 1);
    assert.equal(destroyed, clients);
    await assert.rejects(reader.read());
  });

test("Language override, system selection, self-heal and disable preserve shared gettext state", () => {
  const env = { LANGUAGE: "de:en" };
  let domain = "gnome-shell";
  const parseCatalog = load("src/helpers/catalog.ts", "parseCatalog");
  const translations = load("src/helpers/gettext.ts", "({configureTranslations, gettext})", {
    GLib: {
      get_language_names: () => ["de", "en"],
      file_get_contents: (path) => [true, readFileSync(path)],
      build_filenamev: (parts) => parts.join("/"),
    },
    GETTEXT_DOMAIN: "gnome-provider-limits",
    parseCatalog,
  });
  const unrelated = () => `${env.LANGUAGE}:${domain}`;
  const before = unrelated();
  translations.configureTranslations("dist", "pt_BR");
  assert.equal(translations.gettext("Settings"), "Configurações");
  assert.equal(unrelated(), before);
  translations.configureTranslations("dist", "");
  assert.equal(translations.gettext("Settings"), "Einstellungen");
  assert.equal(unrelated(), before);
  const K = load("src/extension.ts", "ProviderLimitsExtension", {
    GObject: { registerClass: (k) => k },
    PanelMenu: { Button: class {} },
    Extension: class {},
    GLib: {
      build_filenamev: (parts) => parts.join("/"),
      file_test: () => false,
      FileTest: { EXISTS: 1 },
    },
    GETTEXT_DOMAIN: "gnome-provider-limits",
    log() {},
  });
  const extension = new K();
  let selected = "missing";
  extension.getSettings = () => ({
    get_string: () => selected,
    set_string: (_key, value) => {
      selected = value;
    },
  });
  extension._selfHealLanguage();
  extension.disable();
  assert.equal(selected, "");
  assert.equal(unrelated(), before);
});

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
    }
    destroy() {
      this.destroyed = true;
    }
  }
  const created = [];
  class SectionStub {
    constructor(settings, readers, shell) {
      this.settings = settings;
      this.readers = readers;
      this.shell = shell;
      this.rendered = [];
      this.running = null;
      this.destroyed = false;
      created.push(this);
    }
    render(results, lastRefreshAt) {
      this.rendered.push([results, lastRefreshAt]);
    }
    setRunning(running) {
      this.running = running;
    }
    destroy() {
      this.destroyed = true;
      this.shell.destroy();
    }
  }
  class GaugesStub extends SectionStub {}
  class CardsStub extends SectionStub {}
  class CompactStub extends SectionStub {}

  const { isPanelStyle } = load("src/ui/styles.ts", "({ isPanelStyle })");
  const K = load("src/ui/panel.ts", "PanelWidget", {
    PopupMenu: { PopupMenuSection: Section },
    GaugesPanelSection: GaugesStub,
    CardsPanelSection: CardsStub,
    CompactPanelSection: CompactStub,
    PanelShell: ShellStub,
    isPanelStyle,
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
  const fireStyleChange = () => {
    for (const { name, fn } of listeners.values()) {
      if (name === "changed::panel-style") fn();
    }
  };
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
  assert.deepEqual(created[0].rendered, [[results, 100]]);
  panel.setRunning(true);
  assert.equal(created[0].running, true);

  style = "cards";
  fireStyleChange();
  assert.equal(created.length, 2);
  assert.ok(created[1] instanceof CardsStub);
  assert.equal(created[0].destroyed, true);
  assert.equal(created[0].shell.destroyed, true);
  assert.equal(created[1].shell.options.footerVariant, "cards");
  assert.deepEqual(created[1].rendered, [[results, 100]]);
  assert.equal(created[1].running, true);

  style = "compact";
  fireStyleChange();
  assert.equal(created.length, 3);
  assert.ok(created[2] instanceof CompactStub);
  assert.equal(created[1].destroyed, true);
  assert.equal(created[2].shell.options.footerVariant, "compact");

  panel.destroy();
  assert.equal(created[2].destroyed, true);
  assert.equal(listeners.size, 0);
});

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
  const PanelShell = load("src/ui/panelShell.ts", "PanelShell", {
    Clutter: {
      ActorAlign: { CENTER: 0, START: 1, END: 2 },
      KEY_Return: 1,
      KEY_KP_Enter: 2,
      KEY_space: 3,
      EVENT_STOP: 1,
      EVENT_PROPAGATE: 0,
    },
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
      toolbar: footer.toolbar,
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
    assert.equal(shell.footer.toolbar, persistent.toolbar, `${style}: toolbar persists`);
    assert.equal(shell.footer.refreshControl, persistent.refresh, `${style}: refresh persists`);
    assert.equal(shell.footer.spinner, persistent.spinner, `${style}: spinner persists`);
    assert.equal(
      shell.footer.lastRefreshLabel,
      persistent.timestamp,
      `${style}: timestamp persists`,
    );
    assert.equal(shell.footer.settingsControl, persistent.settings, `${style}: settings persists`);
    assert.equal(shell.footer.spinner.playing, true, `${style}: spinner plays while running`);
    assert.equal(
      shell.footer.lastRefreshLabel.text,
      "123:en",
      `${style}: timestamp updated in place`,
    );

    footer.refreshControl.fire("clicked");
    assert.equal(refreshes, 1, `${style}: refresh stays disabled while running`);
    shell.setRunning(false);
    footer.refreshControl.fire("clicked");
    assert.equal(refreshes, 2, `${style}: refresh re-enabled after running`);

    shell.destroy();
  }
});

test("late destruction of an old preferences window cannot tear down a reopened window", async () => {
  const K = load("src/prefs.ts", "ProviderLimitsPreferences", {
    ExtensionPreferences: class {},
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
  prefs._buildWindow = () => prefs._pages.push({ cleanup: () => cleaned++ });
  const firstSignals = new Map(),
    secondSignals = new Map();
  const window = (signals) => ({ connect: (name, fn) => signals.set(name, fn), remove() {} });
  await prefs.fillPreferencesWindow(window(firstSignals));
  firstSignals.get("close-request")();
  await prefs.fillPreferencesWindow(window(secondSignals));
  firstSignals.get("destroy")();
  assert.equal(prefs._pages.length, 1);
  assert.equal(active.size, 1);
  secondSignals.get("close-request")();
  assert.equal(cleaned, 2);
  assert.equal(active.size, 0);
});
