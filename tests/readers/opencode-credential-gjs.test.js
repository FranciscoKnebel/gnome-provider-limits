import GLib from "gi://GLib";

import { assert, assertEqual } from "../helpers/assert.js";
import { MockSettings } from "../mocks/mock-settings.js";

const { OpenCodeReader } = await import("../../dist/readers/opencode.js");
const { clearSqliteCache } = await import("../../dist/helpers/sqlite.js");
const { runSubprocess } = await import("../../dist/helpers/subprocess.js");
const { TokenError } = await import("../../dist/helpers/http.js");

export async function run() {
  const name =
    "OpenCode Reader detects v1 and v2 credentials, prefers v2, and falls back on rejection";
  const dir = GLib.dir_make_tmp("provider-limits-credential-XXXXXX");
  const db = `${dir}/opencode.db`;
  const authFile = `${dir}/auth.json`;
  const reader = new OpenCodeReader(new MockSettings(), "opencode");
  reader._dataDir = () => dir;
  GLib.unsetenv("OPENCODE_API_KEY");
  try {
    await runSql(
      db,
      "CREATE TABLE credential (id TEXT, integration_id TEXT, label TEXT, value TEXT, connector_id TEXT, method_id TEXT, active INTEGER, time_created INTEGER, time_updated INTEGER)",
    );
    await runSql(
      db,
      "INSERT INTO credential VALUES ('cred_old','opencode','Default','{\"type\":\"oauth\",\"access\":\"st-inactive-token\"}',NULL,'device',0,100,100)",
    );
    await runSql(
      db,
      "INSERT INTO credential VALUES ('cred_new','opencode','Default','{\"type\":\"oauth\",\"access\":\"st-active-token\"}',NULL,'device',1,200,200)",
    );
    GLib.file_set_contents(
      authFile,
      JSON.stringify({ "opencode-go": { type: "api", key: "sk-legacy-token" } }),
    );

    const credentials = await reader._availableCredentials(null);
    assertEqual(credentials.map((c) => c.source).join(","), "v2-database,v1-auth-file");
    assertEqual(credentials[0].token, "st-active-token");
    assertEqual(credentials[1].token, "sk-legacy-token");

    const attempted = [];
    reader._getHttp = () => ({
      getJson: async (_url, options) => {
        const authorization = options.headers.Authorization;
        attempted.push(authorization);
        if (authorization === "Bearer st-active-token") throw new TokenError("HTTP 401", 401);
        return {
          usage: { rolling: { status: "ok", percent: 12, resetsAt: "2026-11-24T05:49:21.000Z" } },
        };
      },
      destroy: () => {},
    });
    const usage = await reader._readUsage(null);
    assert(usage !== null, "a rejected v2 token must fall back to the v1 credential");
    assertEqual(usage.rolling.percent, 12);
    assertEqual(attempted.join(","), "Bearer st-active-token,Bearer sk-legacy-token");

    await runSql(db, "DELETE FROM credential");
    clearSqliteCache();
    const v1Only = await reader._availableCredentials(null);
    assertEqual(v1Only.map((c) => c.source).join(","), "v1-auth-file");
    return [{ name, passed: true }];
  } catch (error) {
    return [{ name, passed: false, error: String(error) }];
  } finally {
    reader.destroy();
    GLib.unlink(db);
    if (GLib.file_test(authFile, GLib.FileTest.EXISTS)) GLib.unlink(authFile);
    GLib.rmdir(dir);
  }
}

async function runSql(db, sql) {
  await runSubprocess([
    "python3",
    "-c",
    "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute(sys.argv[2]); c.commit(); c.close()",
    db,
    sql,
  ]);
}
