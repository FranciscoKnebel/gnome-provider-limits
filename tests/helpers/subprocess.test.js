import { assert, assertEqual } from "./assert.js";

const { SubprocessError, SubprocessTimeoutError } =
  await import("../../dist/helpers/subprocess.js");

export async function run() {
  const results = [];

  // Since runSubprocess uses Gio.Subprocess.new directly (not injectable),
  // we test the error types are constructable and the module loads correctly.
  // Integration testing of runSubprocess requires real subprocess execution.

  // Test 1: SubprocessError is constructable
  try {
    const err = new SubprocessError("command failed", "stderr output", 1);
    assert(err instanceof Error, "should be Error");
    assertEqual(err.name, "SubprocessError", "name should be SubprocessError");
    assertEqual(err.message, "command failed", "should have message");
    assertEqual(err.stderr, "stderr output", "should have stderr");
    assertEqual(err.exitCode, 1, "should have exitCode");
    results.push({ name: "SubprocessError constructor", passed: true });
  } catch (e) {
    results.push({ name: "SubprocessError constructor", passed: false, error: String(e) });
  }

  // Test 2: SubprocessTimeoutError is constructable
  try {
    const err = new SubprocessTimeoutError("timed out");
    assert(err instanceof Error, "should be Error");
    assertEqual(err.name, "SubprocessTimeoutError", "name should be SubprocessTimeoutError");
    assertEqual(err.message, "timed out", "should have message");
    results.push({ name: "SubprocessTimeoutError constructor", passed: true });
  } catch (e) {
    results.push({ name: "SubprocessTimeoutError constructor", passed: false, error: String(e) });
  }

  // Test 3: runSubprocess is exported
  try {
    const { runSubprocess } = await import("../../dist/helpers/subprocess.js");
    assert(typeof runSubprocess === "function", "runSubprocess should be a function");
    results.push({ name: "runSubprocess is exported", passed: true });
  } catch (e) {
    results.push({ name: "runSubprocess is exported", passed: false, error: String(e) });
  }

  // Test 4: readPipe is internal but exported for testing (it's not)
  // Verify the module loads without error
  try {
    await import("../../dist/helpers/subprocess.js");
    results.push({ name: "subprocess module loads", passed: true });
  } catch (e) {
    results.push({ name: "subprocess module loads", passed: false, error: String(e) });
  }

  return results;
}
