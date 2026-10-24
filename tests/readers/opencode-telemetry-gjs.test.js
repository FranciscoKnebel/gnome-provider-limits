import GLib from "gi://GLib";

import { assert, assertEqual } from "../helpers/assert.js";
import { MockSettings } from "../mocks/mock-settings.js";

const { OpenCodeReader } = await import("../../dist/readers/opencode.js");
const { runSubprocess } = await import("../../dist/helpers/subprocess.js");

export async function run() {
  const name = "OpenCode Reader executes telemetry SQL against the supported message schema";
  const dir = GLib.dir_make_tmp("provider-limits-telemetry-XXXXXX");
  const db = `${dir}/opencode.db`;
  const fixture = GLib.filename_from_uri(
    GLib.Uri.resolve_relative(
      import.meta.url,
      "../fixtures/opencode-telemetry.sql",
      GLib.UriFlags.NONE,
    ),
  )[0];
  const reader = new OpenCodeReader(new MockSettings(), "opencode");
  reader._dataDir = () => dir;
  try {
    await runSubprocess([
      "python3",
      "-c",
      "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.executescript(open(sys.argv[2]).read()); c.close()",
      db,
      fixture,
    ]);
    const telemetry = await reader._readDiskTelemetry();
    assert(telemetry !== null, "telemetry must be available");
    assertEqual(telemetry.sessionsCount, 3);
    assertEqual(telemetry.totalCost, 3.75);
    await runSubprocess([
      "python3",
      "-c",
      "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('DROP TABLE message'); c.close()",
      db,
    ]);
    const { clearSqliteCache } = await import("../../dist/helpers/sqlite.js");
    clearSqliteCache();
    const partial = await reader._readDiskTelemetry();
    assertEqual(partial.sessionsCount, 3);
    assertEqual(partial.totalCost, null);
    const result = reader._parseResult(null, partial, ["disk"]);
    assertEqual(result.fields.find((field) => field.name === "total_cost").status, "unavailable");
    return [{ name, passed: true }];
  } catch (error) {
    return [{ name, passed: false, error: String(error) }];
  } finally {
    reader.destroy();
    GLib.unlink(db);
    GLib.rmdir(dir);
  }
}
