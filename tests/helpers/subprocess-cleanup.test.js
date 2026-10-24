import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { assert, assertEqual } from "./assert.js";

const { runSubprocess, SubprocessTimeoutError } = await import("../../dist/helpers/subprocess.js");

async function assertReaped(process) {
  for (let attempt = 0; attempt < 25; attempt++) {
    if (process.get_identifier() === null) return;
    await new Promise((resolve) =>
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
      }),
    );
  }
  assertEqual(
    process.get_identifier(),
    null,
    "terminated processes must be reaped after signal delivery",
  );
}

export async function run() {
  const results = [];
  for (const mode of ["spawn failure", "nonzero exit", "stalled signal"]) {
    for (const cancel of [false, true]) {
      const name = `runSubprocess bounds ${cancel ? "cancellation" : "timeout"} with ${mode}`;
      const originalNew = Gio.Subprocess.new;
      const originalSync = GLib.spawn_sync;
      const originalSpawn = Gio.SubprocessLauncher.prototype.spawnv;
      const helpers = [];
      let process = null;
      let processGroup = null;
      let synchronousCalls = 0;
      let signalAttempts = 0;
      let heartbeatAt = Date.now();
      let longestGap = 0;
      let cancelSource = null;
      const heartbeat = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
        const now = Date.now();
        longestGap = Math.max(longestGap, now - heartbeatAt);
        heartbeatAt = now;
        return GLib.SOURCE_CONTINUE;
      });
      try {
        GLib.spawn_sync = () => {
          synchronousCalls++;
          throw new Error("Synchronous signaling is forbidden");
        };
        Gio.SubprocessLauncher.prototype.spawnv = function (args) {
          process = originalSpawn.call(this, args);
          processGroup = process.get_identifier();
          return process;
        };
        Gio.Subprocess.new = (args, flags) => {
          signalAttempts++;
          if (mode === "spawn failure") throw new Error("Injected signal spawn failure");
          const script =
            mode === "nonzero exit" ? "import sys; sys.exit(1)" : "import time; time.sleep(5)";
          const helper = originalNew.call(Gio.Subprocess, ["python3", "-c", script], flags);
          helpers.push(helper);
          return helper;
        };
        const cancellable = new Gio.Cancellable();
        if (cancel)
          cancelSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            cancelSource = null;
            cancellable.cancel();
            return GLib.SOURCE_REMOVE;
          });
        const startedAt = Date.now();
        let failure = null;
        try {
          await runSubprocess(
            [
              "python3",
              "-c",
              "import signal,subprocess,sys,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(5)']); print('partial', flush=True); time.sleep(2.5)",
            ],
            {
              timeoutSeconds: cancel ? 30 : 0.25,
              cancellable,
            },
          );
        } catch (error) {
          failure = error;
        }
        assertEqual(
          synchronousCalls,
          0,
          "cleanup must not synchronously wait for a signaling process",
        );
        assertEqual(signalAttempts, 2, "TERM failure must not prevent the KILL attempt");
        assert(failure !== null, "cleanup must reject");
        assert(longestGap < 200, "signal execution must not block the main loop");
        if (!cancel) {
          assert(
            failure instanceof SubprocessTimeoutError,
            "signal failure must not replace timeout classification",
          );
          assertEqual(
            failure.stdout.trim(),
            "partial",
            "partial output survives failed signal delivery",
          );
        } else {
          assert(
            failure.matches(Gio.io_error_quark(), Gio.IOErrorEnum.CANCELLED),
            "cancellation must retain its classification",
          );
        }
        await Promise.all([process, ...helpers].map(assertReaped));
        assert(Date.now() - startedAt < 2000, "signal failure must not extend the cleanup budget");
        results.push({ name, passed: true });
      } catch (error) {
        results.push({ name, passed: false, error: String(error) });
      } finally {
        Gio.Subprocess.new = originalNew;
        GLib.spawn_sync = originalSync;
        Gio.SubprocessLauncher.prototype.spawnv = originalSpawn;
        GLib.Source.remove(heartbeat);
        if (cancelSource !== null) GLib.Source.remove(cancelSource);
        process?.force_exit();
        for (const helper of helpers) helper.force_exit();
        if (processGroup) {
          const cleanup = originalNew.call(
            Gio.Subprocess,
            [
              "python3",
              "-c",
              `import os,signal,sys
try:
    os.killpg(int(sys.argv[1]), signal.SIGKILL)
except ProcessLookupError:
    pass
`,
              processGroup,
            ],
            Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE,
          );
          await cleanup.wait_async(null);
        }
      }
    }
  }
  return results;
}
