import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { SUBPROCESS_KILL_GRACE_MS, SUBPROCESS_TIMEOUT_SECONDS } from "../constants.js";

Gio._promisify(Gio.Subprocess.prototype, "wait_check_async", "wait_check_finish");
Gio._promisify(Gio.Subprocess.prototype, "communicate_utf8_async", "communicate_utf8_finish");

const SIGTERM = 15;

export class SubprocessError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly exitCode: number,
  ) {
    super(message);
    this.name = "SubprocessError";
  }
}

export class SubprocessTimeoutError extends Error {
  constructor(
    message: string,
    public readonly stdout: string = "",
    public readonly stderr: string = "",
  ) {
    super(message);
    this.name = "SubprocessTimeoutError";
  }
}

export interface SubprocessOptions {
  input?: string;
  timeoutSeconds?: number;
  cwd?: string;
  env?: Record<string, string>;
  cancellable?: Gio.Cancellable;
}

export interface SubprocessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runSubprocess(
  args: readonly string[],
  options?: SubprocessOptions,
): Promise<SubprocessResult> {
  const timeout = options?.timeoutSeconds ?? SUBPROCESS_TIMEOUT_SECONDS;

  const launcher = Gio.SubprocessLauncher.new(
    Gio.SubprocessFlags.STDIN_PIPE |
      Gio.SubprocessFlags.STDOUT_PIPE |
      Gio.SubprocessFlags.STDERR_PIPE,
  );
  if (options?.cwd) launcher.set_cwd(options.cwd);
  if (options?.env) {
    for (const [key, value] of Object.entries(options.env)) {
      launcher.setenv(key, value, true);
    }
  }

  let subprocess: Gio.Subprocess;
  try {
    subprocess = launcher.spawnv(args as string[]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new SubprocessError(`Failed to spawn ${args[0] ?? "subprocess"}: ${detail}`, "", -1);
  }

  let timedOut = false;
  let timeoutActive = true;
  let killSourceId: number | null = null;
  const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, timeout, () => {
    timedOut = true;
    timeoutActive = false;
    if (subprocess.get_identifier() !== null) {
      subprocess.send_signal(SIGTERM);
      killSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SUBPROCESS_KILL_GRACE_MS, () => {
        killSourceId = null;
        subprocess.force_exit();
        return GLib.SOURCE_REMOVE;
      });
    }
    return GLib.SOURCE_REMOVE;
  });

  try {
    const [stdoutText, stderrText] = await subprocess.communicate_utf8_async(
      options?.input ?? null,
      options?.cancellable ?? null,
    );

    if (timedOut) {
      throw new SubprocessTimeoutError(
        `Subprocess timed out after ${timeout}s`,
        stdoutText,
        stderrText,
      );
    }

    const exitCode = subprocess.get_if_exited() ? subprocess.get_exit_status() : -1;
    if (exitCode !== 0) {
      throw new SubprocessError(`Subprocess exited with code ${exitCode}`, stderrText, exitCode);
    }

    return { stdout: stdoutText, stderr: stderrText, exitCode };
  } catch (error) {
    if (timedOut && !(error instanceof SubprocessTimeoutError)) {
      // communicate_utf8_async owns the pipes and discards buffered output when it
      // rejects, so partial stdout/stderr cannot be recovered on this path.
      throw new SubprocessTimeoutError(`Subprocess timed out after ${timeout}s`);
    }
    throw error;
  } finally {
    if (timeoutActive) GLib.Source.remove(timeoutId);
    if (killSourceId !== null) GLib.Source.remove(killSourceId);
    if (options?.cancellable?.is_cancelled()) subprocess.force_exit();
  }
}
