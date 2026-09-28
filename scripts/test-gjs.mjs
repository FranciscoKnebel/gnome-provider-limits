#!/usr/bin/env node
import { spawnSync } from "child_process";
import { exit } from "process";

const GJS_PROBE = spawnSync("gjs", ["--version"], { encoding: "utf-8" });

if (GJS_PROBE.error || GJS_PROBE.status !== 0) {
  console.warn("skipping GJS suite: gjs not found");
  exit(0);
}

const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    console.error(`failed to run ${command}: ${result.error.message}`);
    exit(1);
  }
  if (result.signal) {
    console.error(`${command} terminated by signal ${result.signal}`);
    exit(1);
  }
  if (result.status !== 0) exit(result.status ?? 1);
}

run(NPM, ["run", "build"]);
run("gjs", ["-m", "tests/run-gjs-tests.mjs"]);
