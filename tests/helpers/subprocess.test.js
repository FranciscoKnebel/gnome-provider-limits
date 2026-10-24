import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { assert, assertEqual } from "./assert.js";

const { SubprocessError, SubprocessTimeoutError, runSubprocess } =
  await import("../../dist/helpers/subprocess.js");

async function assertNotRunning(pid) {
  const path = `/proc/${pid}/stat`;
  for (let attempt = 0; attempt < 25; attempt++) {
    if (!GLib.file_test(path, GLib.FileTest.EXISTS)) return;
    const stat = new TextDecoder().decode(GLib.file_get_contents(path)[1]);
    if (stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z")) return;
    await new Promise((resolve) =>
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
      }),
    );
  }
  assert(false, `process ${pid} must not remain running after signal delivery`);
}

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

  // Test 5: an exec failure reports the wrapper's actual exit code
  try {
    let failure = null;
    try {
      await runSubprocess(["/nonexistent-provider-limits-binary-xyz"], { timeoutSeconds: 5 });
    } catch (error) {
      failure = error;
    }
    assert(failure instanceof SubprocessError, "exec failure should be SubprocessError");
    assertEqual(failure.exitCode, 127, "exec failure should retain the wrapper exit code");
    assertEqual(failure.message, "Subprocess exited with code 127");
    assert(failure.stderr.trim().length > 0, "exec diagnostics should be preserved");
    results.push({ name: "runSubprocess preserves wrapper exec failure status", passed: true });
  } catch (error) {
    results.push({
      name: "runSubprocess preserves wrapper exec failure status",
      passed: false,
      error: String(error),
    });
  }

  const originalLauncherSpawn = Gio.SubprocessLauncher.prototype.spawnv;
  try {
    Gio.SubprocessLauncher.prototype.spawnv = () => {
      throw new Error("Injected launcher failure");
    };
    let failure = null;
    try {
      await runSubprocess(["sh", "-c", "exit 0"]);
    } catch (error) {
      failure = error;
    }
    assert(failure instanceof SubprocessError, "launcher failure should be SubprocessError");
    assertEqual(failure.exitCode, -1, "only a launcher failure should use exit code -1");
    results.push({ name: "runSubprocess wraps spawn failures", passed: true });
  } catch (error) {
    results.push({
      name: "runSubprocess wraps spawn failures",
      passed: false,
      error: String(error),
    });
  } finally {
    Gio.SubprocessLauncher.prototype.spawnv = originalLauncherSpawn;
  }

  for (const exitCode of [3, 127]) {
    const name = `runSubprocess preserves exit ${exitCode} when stderr resembles launch diagnostics`;
    try {
      let failure = null;
      try {
        await runSubprocess([
          "sh",
          "-c",
          `printf 'provider-limits-spawn: command diagnostic' >&2; exit ${exitCode}`,
        ]);
      } catch (error) {
        failure = error;
      }
      assert(failure instanceof SubprocessError, "command failure should be SubprocessError");
      assertEqual(failure.exitCode, exitCode, "stderr must not change the command exit code");
      assertEqual(failure.message, `Subprocess exited with code ${exitCode}`);
      assertEqual(failure.stderr, "provider-limits-spawn: command diagnostic");
      results.push({ name, passed: true });
    } catch (error) {
      results.push({ name, passed: false, error: String(error) });
    }
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
    const startedAt = Date.now();
    let timedOut = false;
    try {
      await runSubprocess(["sh", "-c", "printf partial; sleep 4; printf after"], {
        timeoutSeconds: 1,
      });
    } catch (e) {
      timedOut = true;
      assert(
        e instanceof SubprocessTimeoutError,
        `should be SubprocessTimeoutError, got ${e.name}`,
      );
      assertEqual(e.stdout, "partial", "should keep partial stdout");
    }
    assert(timedOut, "slow process should time out");
    assert(Date.now() - startedAt < 3000, "descendant pipes must not extend the deadline");
    results.push({ name: "runSubprocess timeout keeps partial stdout", passed: true });
  } catch (e) {
    results.push({
      name: "runSubprocess timeout keeps partial stdout",
      passed: false,
      error: String(e),
    });
  }

  const descendantScript = `import os, signal, subprocess, sys, time
signal.signal(signal.SIGTERM, signal.SIG_IGN)
child = subprocess.Popen([sys.executable, '-c', 'import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(10)'])
print(str(os.getpid()) + ' ' + str(child.pid), flush=True)
print('partial error', file=sys.stderr, flush=True)
time.sleep(10)
`;
  for (const cancel of [false, true]) {
    const name = `runSubprocess kills TERM-resistant descendants on ${cancel ? "cancellation" : "timeout"}`;
    const originalSpawn = Gio.SubprocessLauncher.prototype.spawnv;
    try {
      let processId = null;
      let childIds = [];
      Gio.SubprocessLauncher.prototype.spawnv = function (args) {
        const process = originalSpawn.call(this, args);
        processId = process.get_identifier();
        return process;
      };
      const cancellable = new Gio.Cancellable();
      if (cancel)
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
          if (processId) {
            const path = `/proc/${processId}/task/${processId}/children`;
            childIds = new TextDecoder()
              .decode(GLib.file_get_contents(path)[1])
              .trim()
              .split(/\s+/);
          }
          cancellable.cancel();
          return GLib.SOURCE_REMOVE;
        });
      const startedAt = Date.now();
      let failure = null;
      try {
        await runSubprocess(["python3", "-c", descendantScript], {
          timeoutSeconds: cancel ? 30 : 1,
          cancellable,
        });
      } catch (error) {
        failure = error;
      }
      assert(failure !== null, "operation must reject");
      assert(Date.now() - startedAt < 3000, "cleanup must finish within deadline plus grace");
      if (!cancel) {
        assert(failure instanceof SubprocessTimeoutError, "timeout classification");
        assertEqual(failure.stderr.trim(), "partial error");
        const pids = failure.stdout.trim().split(" ");
        assertEqual(pids.length, 2, "captures both process IDs");
        await Promise.all(pids.map(assertNotRunning));
      } else {
        assertEqual(childIds.length, 1, "captures the spawned descendant before cancellation");
        await assertNotRunning(processId);
        await Promise.all(childIds.map(assertNotRunning));
      }
      results.push({ name, passed: true });
    } catch (error) {
      results.push({ name, passed: false, error: String(error) });
    } finally {
      Gio.SubprocessLauncher.prototype.spawnv = originalSpawn;
    }
  }

  try {
    const result = await runSubprocess(
      ["python3", "-c", "import os,sys; print(os.getcwd()); print(sys.stdin.read(), end='')"],
      {
        input: "Unicode: café 日本語\n".repeat(4096),
        cwd: "/",
        timeoutSeconds: 5,
      },
    );
    assertEqual(result.stdout, "/\n" + "Unicode: café 日本語\n".repeat(4096));
    results.push({
      name: "runSubprocess preserves cwd, piped input and UTF-8 across chunks",
      passed: true,
    });
  } catch (error) {
    results.push({
      name: "runSubprocess preserves cwd, piped input and UTF-8 across chunks",
      passed: false,
      error: String(error),
    });
  }

  try {
    const cancellable = new Gio.Cancellable();
    cancellable.cancel();
    let rejected = false;
    try {
      await runSubprocess(["sh", "-c", "exit 0"], { cancellable });
    } catch {
      rejected = true;
    }
    assert(rejected, "already-cancelled calls must reject before spawning");
    results.push({ name: "runSubprocess rejects pre-cancelled calls", passed: true });
  } catch (error) {
    results.push({
      name: "runSubprocess rejects pre-cancelled calls",
      passed: false,
      error: String(error),
    });
  }

  let escapedPid = null;
  try {
    const script = `import subprocess, sys, time
child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(4)'], start_new_session=True)
print(child.pid, flush=True)
time.sleep(4)
`;
    const startedAt = Date.now();
    let failure = null;
    try {
      await runSubprocess(["python3", "-c", script], { timeoutSeconds: 1 });
    } catch (error) {
      failure = error;
    }
    assert(failure instanceof SubprocessTimeoutError, "timeout must retain its classification");
    escapedPid = failure.stdout.trim();
    assert(/^\d+$/.test(escapedPid), "partial output survives cancellation of pipe reads");
    assert(
      Date.now() - startedAt < 3000,
      "even pipes held outside the owned group cannot block completion",
    );
    results.push({
      name: "runSubprocess bounds pipe reads independently of process-group EOF",
      passed: true,
    });
  } catch (error) {
    results.push({
      name: "runSubprocess bounds pipe reads independently of process-group EOF",
      passed: false,
      error: String(error),
    });
  } finally {
    if (escapedPid && /^\d+$/.test(escapedPid)) {
      GLib.spawn_sync(
        null,
        [
          "python3",
          "-c",
          "import os,signal,sys; os.kill(int(sys.argv[1]), signal.SIGKILL)",
          escapedPid,
        ],
        null,
        GLib.SpawnFlags.SEARCH_PATH,
        null,
      );
    }
  }

  return results;
}
