import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { assert, assertEqual } from "./assert.js";

const { runSubprocess, SubprocessTimeoutError } = await import("../../dist/helpers/subprocess.js");

export async function run() {
  const results = [];
  const cases = [
    { name: "cancellation before the deadline wins", cancelAt: 200, expected: "cancelled" },
    { name: "timeout before cancellation wins", cancelAt: 400, expected: "timeout" },
    {
      name: "resetting a cancellable during cleanup cannot change the reason",
      cancelAt: 200,
      resetAt: 250,
      expected: "cancelled",
    },
  ];
  for (const scenario of cases) {
    const sources = new Set();
    const schedule = (delay, callback) => {
      const source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
        sources.delete(source);
        callback();
        return GLib.SOURCE_REMOVE;
      });
      sources.add(source);
    };
    try {
      const cancellable = new Gio.Cancellable();
      schedule(scenario.cancelAt, () => cancellable.cancel());
      if (scenario.resetAt) schedule(scenario.resetAt, () => cancellable.reset());
      let failure = null;
      const startedAt = Date.now();
      try {
        await runSubprocess(
          [
            "python3",
            "-c",
            "import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); print('partial', flush=True); time.sleep(5)",
          ],
          {
            timeoutSeconds: 0.3,
            cancellable,
          },
        );
      } catch (error) {
        failure = error;
      }
      assert(failure !== null, "termination must reject");
      if (scenario.expected === "cancelled") {
        assert(
          !(failure instanceof SubprocessTimeoutError),
          "the later deadline must not replace cancellation",
        );
        assert(
          failure.matches(Gio.io_error_quark(), Gio.IOErrorEnum.CANCELLED),
          "the original cancellation reason must be retained",
        );
      } else {
        assert(
          failure instanceof SubprocessTimeoutError,
          "later cancellation must not replace timeout",
        );
        assertEqual(failure.stdout.trim(), "partial", "timeout keeps partial output");
      }
      assert(Date.now() - startedAt < 2000, "competing events must not restart cleanup");
      results.push({ name: scenario.name, passed: true });
    } catch (error) {
      results.push({ name: scenario.name, passed: false, error: String(error) });
    } finally {
      for (const source of sources) GLib.Source.remove(source);
    }
  }
  return results;
}
