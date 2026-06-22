import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { SUBPROCESS_TIMEOUT_SECONDS } from "../constants.js";

Gio._promisify(Gio.Subprocess.prototype, "wait_check_async", "wait_check_finish");

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

  const subprocess = Gio.Subprocess.new(
    args as string[],
    Gio.SubprocessFlags.STDIN_PIPE |
      Gio.SubprocessFlags.STDOUT_PIPE |
      Gio.SubprocessFlags.STDERR_PIPE,
  );

  // Set up timeout
  const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, timeout, () => {
    subprocess.force_exit();
    return GLib.SOURCE_REMOVE;
  });

  try {
    // Write stdin if provided
    if (options?.input) {
      const stdinPipe = subprocess.get_stdin_pipe();
      const data = new TextEncoder().encode(options.input);
      // TODO: write to stdin pipe asynchronously
      void stdinPipe;
      void data;
    }

    await subprocess.wait_check_async(null);

    const stdoutText = await readPipe(subprocess.get_stdout_pipe());
    const stderrText = await readPipe(subprocess.get_stderr_pipe());

    const exitCode = subprocess.get_exit_status();

    if (exitCode !== 0) {
      throw new SubprocessError(`Subprocess exited with code ${exitCode}`, stderrText, exitCode);
    }

    return { stdout: stdoutText, stderr: stderrText, exitCode };
  } catch (error) {
    if (error instanceof SubprocessError) throw error;
    throw new SubprocessTimeoutError(`Subprocess timed out after ${timeout}s: ${error}`);
  } finally {
    GLib.Source.remove(timeoutId);
  }
}

async function readPipe(stream: Gio.InputStream | null): Promise<string> {
  if (!stream) return "";

  // TODO: implement async read via Gio.DataInputStream
  // For now, placeholder
  void stream;
  return "";
}
