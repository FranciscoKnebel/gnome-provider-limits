import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { SUBPROCESS_TIMEOUT_SECONDS } from "../constants.js";

Gio._promisify(Gio.Subprocess.prototype, "wait_check_async", "wait_check_finish");
Gio._promisify(Gio.Subprocess.prototype, "communicate_utf8_async", "communicate_utf8_finish");

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
  constructor(message: string) {
    super(message);
    this.name = "SubprocessTimeoutError";
  }
}

export interface SubprocessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runSubprocess(
  args: readonly string[],
  options?: {
    input?: string;
    timeoutSeconds?: number;
    cwd?: string;
  },
): Promise<SubprocessResult> {
  const timeout = options?.timeoutSeconds ?? SUBPROCESS_TIMEOUT_SECONDS;

  const launcher = Gio.SubprocessLauncher.new(
    Gio.SubprocessFlags.STDIN_PIPE |
      Gio.SubprocessFlags.STDOUT_PIPE |
      Gio.SubprocessFlags.STDERR_PIPE,
  );
  if (options?.cwd) launcher.set_cwd(options.cwd);

  const subprocess = launcher.spawnv(args as string[]);

  let timedOut = false;
  let timeoutActive = true;
  const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, timeout, () => {
    timedOut = true;
    timeoutActive = false;
    subprocess.force_exit();
    return GLib.SOURCE_REMOVE;
  });

  try {
    const [stdoutText, stderrText] = await subprocess.communicate_utf8_async(
      options?.input ?? null,
      null,
    );

    const exitCode = subprocess.get_exit_status();

    if (exitCode !== 0) {
      throw new SubprocessError(`Subprocess exited with code ${exitCode}`, stderrText, exitCode);
    }

    return { stdout: stdoutText, stderr: stderrText, exitCode };
  } catch (error) {
    if (timedOut) throw new SubprocessTimeoutError(`Subprocess timed out after ${timeout}s`);
    if (error instanceof SubprocessError) throw error;
    throw error;
  } finally {
    if (timeoutActive) GLib.Source.remove(timeoutId);
  }
}
