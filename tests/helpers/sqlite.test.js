import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { assert, assertDeepEqual, assertEqual, assertNotNull } from "./assert.js";

const CREATE_DB_SCRIPT = `
import sqlite3, sys
db, count = sys.argv[1], int(sys.argv[2])
conn = sqlite3.connect(db)
conn.execute("CREATE TABLE test (id INTEGER, value TEXT)")
for i in range(count):
    conn.execute("INSERT INTO test VALUES (?, ?)", (i + 1, "value-%d" % (i + 1)))
conn.commit()
conn.close()
`;

const WAL_CLEAN_SCRIPT = `
import sqlite3, sys
db = sys.argv[1]
conn = sqlite3.connect(db)
conn.execute("PRAGMA journal_mode=WAL")
conn.execute("CREATE TABLE test (id INTEGER, value TEXT)")
conn.execute("INSERT INTO test VALUES (1, 'main')")
conn.commit()
conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
conn.close()
`;

const WAL_HOT_SCRIPT = `
import os, sqlite3, sys
db = sys.argv[1]
conn = sqlite3.connect(db)
conn.execute("PRAGMA journal_mode=WAL")
conn.execute("CREATE TABLE test (id INTEGER, value TEXT)")
conn.execute("INSERT INTO test VALUES (1, 'main')")
conn.commit()
conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
conn.execute("INSERT INTO test VALUES (2, 'in-wal')")
conn.commit()
os._exit(0)
`;

const HOT_JOURNAL_SCRIPT = `
import os, sqlite3, sys
db = sys.argv[1]
conn = sqlite3.connect(db)
conn.execute("PRAGMA journal_mode=DELETE")
conn.execute("CREATE TABLE test (id INTEGER, value TEXT)")
conn.execute("INSERT INTO test VALUES (1, 'main')")
conn.commit()
conn.execute("PRAGMA cache_size = 1")
conn.execute("BEGIN IMMEDIATE")
for i in range(2, 502):
    conn.execute("INSERT INTO test VALUES (?, ?)", (i, "pending-%d" % i))
os._exit(0)
`;

const WRITE_TEXT_SCRIPT = `
import sys
with open(sys.argv[1], "w") as handle:
    handle.write("not a sqlite database")
`;

function tempDbPath(tag) {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
  return `${GLib.get_tmp_dir()}/provider-limits-${tag}-${unique}.db`;
}

function fileExists(path) {
  return GLib.file_test(path, GLib.FileTest.EXISTS);
}

function sidecarPaths(dbPath) {
  return [`${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`];
}

function removeFiles(paths) {
  for (const path of paths) {
    try {
      Gio.File.new_for_path(path).delete(null);
    } catch {
      // ignore cleanup errors
    }
  }
}

async function runPython(script, args) {
  const { runSubprocess } = await import("../../dist/helpers/subprocess.js");
  return runSubprocess(["python3", "-c", script, ...args], { timeoutSeconds: 10 });
}

export async function run() {
  const results = [];
  const { querySqlite, clearSqliteCache } = await import("../../dist/helpers/sqlite.js");
  const exportChecks = [
    [
      "querySqlite is exported",
      () => assert(typeof querySqlite === "function", "querySqlite should be a function"),
    ],
    [
      "clearSqliteCache is exported",
      () => assert(typeof clearSqliteCache === "function", "clearSqliteCache should be a function"),
    ],
  ];
  for (const [name, check] of exportChecks) {
    try {
      check();
      results.push({ name, passed: true });
    } catch (e) {
      results.push({ name, passed: false, error: String(e) });
    }
  }

  // Test: integration with a real sqlite database via python3
  try {
    const tmpDb = tempDbPath("query");
    await runPython(CREATE_DB_SCRIPT, [tmpDb, "2"]);

    clearSqliteCache();
    const rows = await querySqlite(tmpDb, "SELECT * FROM test ORDER BY id");
    assertNotNull(rows, "should return rows");
    assertEqual(rows.length, 2, "should have 2 rows");
    assertEqual(rows[0].id, 1, "first row id should be 1");
    assertEqual(rows[0].value, "value-1", "first row value should be value-1");
    assertEqual(rows[1].id, 2, "second row id should be 2");
    assertEqual(rows[1].value, "value-2", "second row value should be value-2");

    removeFiles([tmpDb, ...sidecarPaths(tmpDb)]);
    results.push({ name: "querySqlite with real database", passed: true });
  } catch (e) {
    results.push({ name: "querySqlite with real database", passed: false, error: String(e) });
  }

  // Test: querySqlite caches results
  try {
    const tmpDb = tempDbPath("cache");
    await runPython(CREATE_DB_SCRIPT, [tmpDb, "1"]);

    clearSqliteCache();
    const firstResult = await querySqlite(tmpDb, "SELECT * FROM test");
    assertEqual(firstResult.length, 1, "first call should return 1 row");

    clearSqliteCache();

    const secondResult = await querySqlite(tmpDb, "SELECT * FROM test");
    assertEqual(secondResult.length, 1, "second call should return 1 row");

    removeFiles([tmpDb, ...sidecarPaths(tmpDb)]);
    results.push({ name: "querySqlite caching works", passed: true });
  } catch (e) {
    results.push({ name: "querySqlite caching works", passed: false, error: String(e) });
  }

  // Test: a missing database file is not created
  try {
    const tmpDb = tempDbPath("missing");
    assert(!fileExists(tmpDb), "precondition: database file must not exist");

    const rows = await querySqlite(tmpDb, "SELECT * FROM test");
    assertDeepEqual(rows, [], "missing database should return no rows");
    assert(!fileExists(tmpDb), "querySqlite must not create the database file");
    for (const path of sidecarPaths(tmpDb)) {
      assert(!fileExists(path), `querySqlite must not create ${path}`);
    }

    results.push({ name: "missing database is not created", passed: true });
  } catch (e) {
    results.push({ name: "missing database is not created", passed: false, error: String(e) });
  }

  // Test: writes are rejected on the read-only connection
  try {
    const tmpDb = tempDbPath("readonly");
    await runPython(CREATE_DB_SCRIPT, [tmpDb, "1"]);

    clearSqliteCache();
    await querySqlite(tmpDb, "INSERT INTO test (id, value) VALUES (2, 'write')");

    clearSqliteCache();
    const rows = await querySqlite(tmpDb, "SELECT id FROM test ORDER BY id");
    assertEqual(rows.length, 1, "the INSERT must not be applied");
    assertEqual(rows[0].id, 1, "only the pre-existing row should remain");

    removeFiles([tmpDb, ...sidecarPaths(tmpDb)]);
    results.push({ name: "writes fail on a read-only connection", passed: true });
  } catch (e) {
    results.push({
      name: "writes fail on a read-only connection",
      passed: false,
      error: String(e),
    });
  }

  // Test: concurrent identical queries share one in-flight result
  try {
    const tmpDb = tempDbPath("single-flight");
    await runPython(CREATE_DB_SCRIPT, [tmpDb, "2"]);

    clearSqliteCache();
    const query = "SELECT * FROM test ORDER BY id";
    const [first, second] = await Promise.all([
      querySqlite(tmpDb, query),
      querySqlite(tmpDb, query),
    ]);
    assert(first === second, "concurrent identical queries should share one result object");
    assertEqual(first.length, 2, "shared result should contain the rows");

    removeFiles([tmpDb, ...sidecarPaths(tmpDb)]);
    results.push({ name: "concurrent identical queries are single-flight", passed: true });
  } catch (e) {
    results.push({
      name: "concurrent identical queries are single-flight",
      passed: false,
      error: String(e),
    });
  }

  // Test: a checkpointed WAL database is read without creating -wal/-shm
  try {
    const tmpDb = tempDbPath("wal-clean");
    await runPython(WAL_CLEAN_SCRIPT, [tmpDb]);
    assert(!fileExists(`${tmpDb}-wal`), "precondition: -wal must not exist");
    assert(!fileExists(`${tmpDb}-shm`), "precondition: -shm must not exist");

    clearSqliteCache();
    const rows = await querySqlite(tmpDb, "SELECT * FROM test");
    assertEqual(rows.length, 1, "should read the main file");
    assertEqual(rows[0].value, "main", "should read the checkpointed value");
    assert(!fileExists(`${tmpDb}-wal`), "reading must not create -wal");
    assert(!fileExists(`${tmpDb}-shm`), "reading must not create -shm");

    removeFiles([tmpDb, ...sidecarPaths(tmpDb)]);
    results.push({ name: "clean WAL database creates no sidecars", passed: true });
  } catch (e) {
    results.push({
      name: "clean WAL database creates no sidecars",
      passed: false,
      error: String(e),
    });
  }

  // Test: WAL fallback reads the main file when mode=ro cannot open the WAL
  try {
    const tmpDb = tempDbPath("wal-fallback");
    await runPython(WAL_HOT_SCRIPT, [tmpDb]);
    assert(fileExists(`${tmpDb}-wal`), "precondition: hot -wal must exist");

    const walPath = `${tmpDb}-wal`;
    removeFiles([walPath]);
    await runPython("import os, sys\nos.mkdir(sys.argv[1])\n", [walPath]);

    clearSqliteCache();
    const rows = await querySqlite(tmpDb, "SELECT * FROM test ORDER BY id");
    assertEqual(rows.length, 1, "fallback should read the main file after mode=ro fails");
    assertEqual(rows[0].value, "main", "fallback should read the checkpointed value");
    assert(fileExists(walPath), "fallback must not remove the -wal entry");

    removeFiles([tmpDb, ...sidecarPaths(tmpDb)]);
    results.push({ name: "WAL fallback reads the main file", passed: true });
  } catch (e) {
    results.push({ name: "WAL fallback reads the main file", passed: false, error: String(e) });
  }

  // Test: a pending rollback journal blocks the immutable fallback
  try {
    const tmpDb = tempDbPath("hot-journal");
    await runPython(HOT_JOURNAL_SCRIPT, [tmpDb]);
    assert(fileExists(`${tmpDb}-journal`), "precondition: hot -journal must exist");

    const probe = await runPython(
      [
        "import sqlite3, sys",
        "uri = 'file:' + sys.argv[1] + '?immutable=1'",
        "conn = sqlite3.connect(uri, uri=True)",
        "print(conn.execute('SELECT COUNT(*) FROM test').fetchone()[0])",
      ].join("\n"),
      [tmpDb],
    );
    assertEqual(probe.stdout.trim(), "1", "precondition: immutable would read the committed row");

    clearSqliteCache();
    const rows = await querySqlite(tmpDb, "SELECT * FROM test");
    assertDeepEqual(rows, [], "must not read the main file while the journal is pending");
    assert(fileExists(`${tmpDb}-journal`), "must not remove the journal");

    removeFiles([tmpDb, ...sidecarPaths(tmpDb)]);
    results.push({ name: "hot journal blocks the immutable fallback", passed: true });
  } catch (e) {
    results.push({
      name: "hot journal blocks the immutable fallback",
      passed: false,
      error: String(e),
    });
  }

  // Test: an unreadable database degrades to an empty result
  try {
    const tmpDb = tempDbPath("invalid");
    await runPython(WRITE_TEXT_SCRIPT, [tmpDb]);

    clearSqliteCache();
    const rows = await querySqlite(tmpDb, "SELECT 1");
    assertDeepEqual(rows, [], "invalid database should return no rows");
    for (const path of sidecarPaths(tmpDb)) {
      assert(!fileExists(path), `invalid database must not create ${path}`);
    }

    removeFiles([tmpDb]);
    results.push({ name: "invalid database returns no rows", passed: true });
  } catch (e) {
    results.push({ name: "invalid database returns no rows", passed: false, error: String(e) });
  }

  return results;
}
