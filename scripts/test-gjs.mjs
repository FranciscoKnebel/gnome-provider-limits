#!/usr/bin/env node
import { spawnSync } from "child_process";
import { exit } from "process";

const GJS_PROBE = spawnSync("gjs", ["--version"], { encoding: "utf-8" });

if (GJS_PROBE.error || GJS_PROBE.status !== 0) {
  console.warn("skipping GJS suite: gjs not found");
  exit(0);
}

const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

const build = spawnSync(NPM, ["run", "build"], { stdio: "inherit" });
if (build.status !== 0) exit(build.status ?? 1);

const tests = spawnSync("gjs", ["-m", "tests/run-gjs-tests.mjs"], { stdio: "inherit" });
exit(tests.status ?? 1);
