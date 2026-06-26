/* eslint-disable no-unused-vars */
import Gio from "gi://Gio";
import System from "system";

const TEST_DIR = import.meta.url.replace(/^file:\/\//, "").replace(/\/[^/]+$/, "");

const PASSED = 0;
const FAILED = 1;

let passed = 0;
let failed = 0;

async function discoverTests() {
  const files = [];
  const testDirs = ["helpers", "ui", "readers"];

  for (const dir of testDirs) {
    const dirPath = `${TEST_DIR}/${dir}`;
    const dirFile = Gio.File.new_for_path(dirPath);
    try {
      const enumerator = dirFile.enumerate_children(
        "standard::name",
        Gio.FileQueryInfoFlags.NONE,
        null,
      );
      let info;
      while ((info = enumerator.next_file(null)) !== null) {
        const name = info.get_name();
        if (name.endsWith(".test.mjs") || name.endsWith(".test.js")) {
          files.push(`${dir}/${name}`);
        }
      }
      enumerator.close(null);
    } catch (_e) {
      // directory doesn't exist, skip
    }
  }
  return files;
}

async function runTestFile(filePath) {
  const fullPath = `file://${TEST_DIR}/${filePath}`;
  try {
    const mod = await import(fullPath);
    if (typeof mod.run !== "function") {
      log(`SKIP: ${filePath} (no run() export)`);
      return;
    }
    const results = await mod.run();
    for (const r of results) {
      if (r.passed) {
        log(`PASS: ${filePath} › ${r.name}`);
        passed++;
      } else {
        log(`FAIL: ${filePath} › ${r.name}\n  ${r.error}`);
        failed++;
      }
    }
  } catch (_e) {
    log(`FAIL: ${filePath}\n  ${String(e)}`);
    log(`${e.stack}`);
    failed++;
  }
}

function log(msg) {
  print(msg);
}

async function main() {
  const files = await discoverTests();

  if (files.length === 0) {
    log("No test files found");
    return;
  }

  log(`Found ${files.length} test file(s)`);
  log("");

  for (const file of files) {
    await runTestFile(file);
  }

  const total = passed + failed;
  log("");
  log(`Results: ${passed} passed, ${failed} failed (${total} total)`);

  System.exit(failed > 0 ? FAILED : PASSED);
}

await main();
