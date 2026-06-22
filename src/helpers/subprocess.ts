import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { SUBPROCESS_TIMEOUT_SECONDS } from "../constants.js";

Gio._promisify(Gio.Subprocess.prototype, "wait_check_async", "wait_check_finish");
Gio._promisify(Gio.InputStream.prototype, "read_bytes_async", "read_bytes_finish");
Gio._promisify(Gio.OutputStream.prototype, "write_bytes_async", "write_bytes_finish");
Gio._promisify(Gio.OutputStream.prototype, "close_async", "close_finish");

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
    // Write stdin if provided, then close the pipe so the child sees EOF.
    if (options?.input) {
      const stdinPipe = subprocess.get_stdin_pipe();
      if (stdinPipe) {
        const data = new TextEncoder().encode(options.input);
        await stdinPipe.write_bytes_async(new GLib.Bytes(data), GLib.PRIORITY_DEFAULT, null);
        try {
          await stdinPipe.close_async(GLib.PRIORITY_DEFAULT, null);
        } catch {
          // Closing stdin after write is best-effort; ignore failures.
        }
      }
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

  const chunks: Uint8Array[] = [];
  const decoder = new TextDecoder();

  // Read until EOF. read_bytes_async resolves with an empty Bytes on EOF.
  while (true) {
    const bytes = await stream.read_bytes_async(4096, GLib.PRIORITY_DEFAULT, null);
    const data = bytes instanceof Uint8Array ? bytes : bytes.toArray();
    if (data.length === 0) break;
    chunks.push(data);
  }

  try {
    await stream.close_async(GLib.PRIORITY_DEFAULT, null);
  } catch {
    // Closing after read is best-effort; ignore failures.
  }

  if (chunks.length === 0) return "";

  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return decoder.decode(merged);
}
