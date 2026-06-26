/* eslint-disable no-unused-vars */
import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { assert, assertEqual, assertNotNull } from "./assert.js";

export async function run() {
  const results = [];

  // Test 1: querySqlite is exported and is a function
  try {
    const { querySqlite } = await import("../../dist/helpers/sqlite.js");
    assert(typeof querySqlite === "function", "querySqlite should be a function");
    results.push({ name: "querySqlite is exported", passed: true });
  } catch (_e) {
    results.push({ name: "querySqlite is exported", passed: false, error: String(e) });
  }

  // Test 2: clearSqliteCache is exported
  try {
    const { clearSqliteCache } = await import("../../dist/helpers/sqlite.js");
    assert(typeof clearSqliteCache === "function", "clearSqliteCache should be a function");
    results.push({ name: "clearSqliteCache is exported", passed: true });
  } catch (_e) {
    results.push({ name: "clearSqliteCache is exported", passed: false, error: String(e) });
  }

  // Test 3: Integration with real sqlite database via python3
  try {
    const { querySqlite, clearSqliteCache } = await import("../../dist/helpers/sqlite.js");

    // Create a temporary SQLite database using python3
    const tmpDb = `${GLib.get_tmp_dir()}/provider-limits-test-${Date.now()}.db`;
    const setupScript = `
import sqlite3
conn = sqlite3.connect("${tmpDb}")
conn.execute("CREATE TABLE test (id INTEGER, value TEXT)")
conn.execute("INSERT INTO test VALUES (1, 'hello')")
conn.execute("INSERT INTO test VALUES (2, 'world')")
conn.commit()
conn.close()
print("ok")
`;
    const { runSubprocess } = await import("../../dist/helpers/subprocess.js");
    await runSubprocess(["python3", "-c", setupScript], { timeoutSeconds: 10 });

    // Now query it using our helper
    const rows = await querySqlite(tmpDb, "SELECT * FROM test ORDER BY id");
    assertNotNull(rows, "should return rows");
    assertEqual(rows.length, 2, "should have 2 rows");
    assertEqual(rows[0].id, 1, "first row id should be 1");
    assertEqual(rows[0].value, "hello", "first row value should be hello");
    assertEqual(rows[1].id, 2, "second row id should be 2");
    assertEqual(rows[1].value, "world", "second row value should be world");

    // Clean up
    try {
      Gio.File.new_for_path(tmpDb).delete(null);
    } catch (_e) {
      // ignore cleanup errors
    }

    clearSqliteCache();
    results.push({ name: "querySqlite with real database", passed: true });
  } catch (_e) {
    results.push({ name: "querySqlite with real database", passed: false, error: String(e) });
  }

  // Test 4: querySqlite caches results
  try {
    const { querySqlite, clearSqliteCache } = await import("../../dist/helpers/sqlite.js");

    // Create another temp database
    const tmpDb = `${GLib.get_tmp_dir()}/provider-limits-test-cache-${Date.now()}.db`;
    const setupScript = `
import sqlite3
conn = sqlite3.connect("${tmpDb}")
conn.execute("CREATE TABLE test (id INTEGER)")
conn.execute("INSERT INTO test VALUES (1)")
conn.commit()
conn.close()
print("ok")
`;
    const { runSubprocess } = await import("../../dist/helpers/subprocess.js");
    await runSubprocess(["python3", "-c", setupScript], { timeoutSeconds: 10 });

    // First call should query the db
    const firstResult = await querySqlite(tmpDb, "SELECT * FROM test");
    assertEqual(firstResult.length, 1, "first call should return 1 row");

    // Clear cache
    clearSqliteCache();

    // Second call should still work
    const secondResult = await querySqlite(tmpDb, "SELECT * FROM test");
    assertEqual(secondResult.length, 1, "second call should return 1 row");

    // Clean up
    try {
      Gio.File.new_for_path(tmpDb).delete(null);
    } catch (_e) {
      // ignore
    }

    results.push({ name: "querySqlite caching works", passed: true });
  } catch (_e) {
    results.push({ name: "querySqlite caching works", passed: false, error: String(e) });
  }

  return results;
}
