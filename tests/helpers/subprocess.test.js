import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { assert, assertEqual } from "./assert.js";

const { SubprocessError, SubprocessTimeoutError, runSubprocess } =
  await import("../../dist/helpers/subprocess.js");

export async function run() {
  const results = [];

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
    const err = new SubprocessTimeoutError("timed out", "partial out", "partial err");
    assert(err instanceof Error, "should be Error");
    assertEqual(err.name, "SubprocessTimeoutError", "name should be SubprocessTimeoutError");
    assertEqual(err.message, "timed out", "should have message");
    assertEqual(err.stdout, "partial out", "should keep partial stdout");
    assertEqual(err.stderr, "partial err", "should keep partial stderr");
    results.push({ name: "SubprocessTimeoutError constructor", passed: true });
  } catch (e) {
    results.push({ name: "SubprocessTimeoutError constructor", passed: false, error: String(e) });
  }

  // Test 3: runSubprocess is exported
  try {
    assert(typeof runSubprocess === "function", "runSubprocess should be a function");
    results.push({ name: "runSubprocess is exported", passed: true });
  } catch (e) {
    results.push({ name: "runSubprocess is exported", passed: false, error: String(e) });
  }

  // Test 4: env options are passed to the child
  try {
    const result = await runSubprocess(["sh", "-c", "printf '%s' \"$PROBE_VAR\""], {
      env: { PROBE_VAR: "env-ok" },
      timeoutSeconds: 5,
    });
    assertEqual(result.stdout, "env-ok", "child should see the provided env");
    assertEqual(result.exitCode, 0, "should exit cleanly");
    results.push({ name: "runSubprocess passes env to the child", passed: true });
  } catch (e) {
    results.push({
      name: "runSubprocess passes env to the child",
      passed: false,
      error: String(e),
    });
  }

  // Test 5: immediate spawn failures are wrapped in SubprocessError
  try {
    await runSubprocess(["/nonexistent-provider-limits-binary-xyz"], { timeoutSeconds: 5 });
    results.push({
      name: "runSubprocess wraps spawn failures",
      passed: false,
      error: "should have thrown",
    });
  } catch (e) {
    assert(e instanceof SubprocessError, `should be SubprocessError, got ${e.name}`);
    assertEqual(e.exitCode, -1, "spawn failure should use exit code -1");
    results.push({ name: "runSubprocess wraps spawn failures", passed: true });
  }

  // Test 6: non-zero exit reports stderr and exit code
  try {
    await runSubprocess(["sh", "-c", "echo boom >&2; exit 3"], { timeoutSeconds: 5 });
    results.push({
      name: "runSubprocess reports non-zero exit",
      passed: false,
      error: "should throw",
    });
  } catch (e) {
    assert(e instanceof SubprocessError, `should be SubprocessError, got ${e.name}`);
    assertEqual(e.exitCode, 3, "should carry exit code 3");
    assertEqual(e.stderr.trim(), "boom", "should carry stderr");
    results.push({ name: "runSubprocess reports non-zero exit", passed: true });
  }

  // Test 7: a cancelled cancellable aborts the call promptly
  try {
    const cancellable = new Gio.Cancellable();
    const promise = runSubprocess(["sh", "-c", "sleep 10"], {
      timeoutSeconds: 30,
      cancellable,
    });
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
      cancellable.cancel();
      return GLib.SOURCE_REMOVE;
    });

    const startedAt = Date.now();
    let aborted = false;
    try {
      await promise;
    } catch {
      aborted = true;
    }

    assert(aborted, "cancelled run should reject");
    assert(Date.now() - startedAt < 5000, "cancellation should not wait for the timeout");
    results.push({ name: "runSubprocess aborts on cancellable", passed: true });
  } catch (e) {
    results.push({ name: "runSubprocess aborts on cancellable", passed: false, error: String(e) });
  }

  // Test 8: timeout is classified and keeps partial stdout
  try {
    let timedOut = false;
    try {
      await runSubprocess(["sh", "-c", "printf partial; sleep 10"], { timeoutSeconds: 1 });
    } catch (e) {
      timedOut = true;
      assert(
        e instanceof SubprocessTimeoutError,
        `should be SubprocessTimeoutError, got ${e.name}`,
      );
      assertEqual(e.stdout, "partial", "should keep partial stdout");
    }
    assert(timedOut, "slow process should time out");
    results.push({ name: "runSubprocess timeout keeps partial stdout", passed: true });
  } catch (e) {
    results.push({
      name: "runSubprocess timeout keeps partial stdout",
      passed: false,
      error: String(e),
    });
  }

  return results;
}
