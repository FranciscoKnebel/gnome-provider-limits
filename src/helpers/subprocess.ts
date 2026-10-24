import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { SUBPROCESS_KILL_GRACE_MS, SUBPROCESS_TIMEOUT_SECONDS } from "../constants.js";

Gio._promisify(Gio.Subprocess.prototype, "wait_async", "wait_finish");
Gio._promisify(Gio.InputStream.prototype, "read_bytes_async", "read_bytes_finish");
Gio._promisify(Gio.OutputStream.prototype, "write_all_async", "write_all_finish");
Gio._promisify(Gio.OutputStream.prototype, "close_async", "close_finish");

// Python is already required by the SQLite Helper. exec preserves the PID as
// the process-group ID, without running unsafe post-fork GJS callbacks.
const GROUP_EXEC = `import os, sys
os.setsid()
try:
    os.execvp(sys.argv[1], sys.argv[1:])
except OSError as exc:
    print("provider-limits-spawn: " + str(exc), file=sys.stderr)
    sys.exit(127)
`;

async function signalGroup(pid: string, signal: "TERM" | "KILL"): Promise<void> {
  const cancellable = new Gio.Cancellable();
  let subprocess: Gio.Subprocess | null = null;
  let deadline: number | null = GLib.timeout_add(
    GLib.PRIORITY_DEFAULT,
    SUBPROCESS_KILL_GRACE_MS,
    () => {
      deadline = null;
      subprocess?.force_exit();
      cancellable.cancel();
      return GLib.SOURCE_REMOVE;
    },
  );
  try {
    subprocess = Gio.Subprocess.new(
      [
        "python3",
        "-c",
        `import os, signal, sys
try:
    os.killpg(int(sys.argv[1]), getattr(signal, 'SIG' + sys.argv[2]))
except ProcessLookupError:
    pass
`,
        pid,
        signal,
      ],
      Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE,
    );
    await subprocess.wait_async(cancellable);
  } catch {
    // Group signaling is best effort; local cleanup must not depend on it.
  } finally {
    if (deadline !== null) GLib.Source.remove(deadline);
    subprocess?.force_exit();
  }
}

async function terminateSubprocess(
  subprocess: Gio.Subprocess,
  pid: string | null,
  ioCancellable: Gio.Cancellable,
): Promise<void> {
  const grace = new Promise<void>((resolve) => {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, SUBPROCESS_KILL_GRACE_MS, () => {
      subprocess.force_exit();
      ioCancellable.cancel();
      resolve();
      return GLib.SOURCE_REMOVE;
    });
  });
  const term = pid ? signalGroup(pid, "TERM") : Promise.resolve();
  await grace;
  if (pid) await signalGroup(pid, "KILL");
  await term;
}

async function readPipe(
  stream: Gio.InputStream,
  chunks: Uint8Array[],
  cancellable: Gio.Cancellable,
): Promise<void> {
  while (true) {
    const bytes = await stream.read_bytes_async(8192, GLib.PRIORITY_DEFAULT, cancellable);
    const data = bytes.get_data();
    if (!data?.length) return;
    chunks.push(data);
  }
}

function decodeChunks(chunks: readonly Uint8Array[]): string {
  const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}

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
  // Timeout and cancellation terminate the owned process group. Pipe reads are
  // cancelled after one kill grace period. Bounded signaling can take one more.
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

type TerminationReason = "timeout" | "cancelled";

export async function runSubprocess(
  args: readonly string[],
  options?: SubprocessOptions,
): Promise<SubprocessResult> {
  const timeout = options?.timeoutSeconds ?? SUBPROCESS_TIMEOUT_SECONDS;
  options?.cancellable?.set_error_if_cancelled();
  if (!args.length) throw new SubprocessError("No subprocess command provided", "", -1);

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
    subprocess = launcher.spawnv(["python3", "-c", GROUP_EXEC, ...args]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new SubprocessError(`Failed to spawn ${args[0] ?? "subprocess"}: ${detail}`, "", -1);
  }

  const ioCancellable = new Gio.Cancellable();
  const pid = subprocess.get_identifier();
  const stdin = subprocess.get_stdin_pipe();
  const stdout = subprocess.get_stdout_pipe();
  const stderr = subprocess.get_stderr_pipe();
  if (!stdin || !stdout || !stderr) {
    subprocess.force_exit();
    throw new SubprocessError("Failed to open subprocess pipes", "", -1);
  }
  const stdoutChunks: Uint8Array[] = [];
  const stderrChunks: Uint8Array[] = [];
  let termination: Promise<TerminationReason> | null = null;
  let timeoutId: number | null = null;
  const terminate = (reason: TerminationReason): void => {
    if (termination) return;
    if (timeoutId !== null) {
      GLib.Source.remove(timeoutId);
      timeoutId = null;
    }
    termination = terminateSubprocess(subprocess, pid, ioCancellable).then(() => reason);
  };
  timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeout * 1000, () => {
    timeoutId = null;
    terminate("timeout");
    return GLib.SOURCE_REMOVE;
  });
  const cancelId = options?.cancellable?.connect(() => terminate("cancelled"));

  try {
    const writeInput = async (): Promise<void> => {
      try {
        if (options?.input) {
          await stdin.write_all_async(
            new TextEncoder().encode(options.input),
            GLib.PRIORITY_DEFAULT,
            ioCancellable,
          );
        }
      } finally {
        await stdin.close_async(GLib.PRIORITY_DEFAULT, null);
      }
    };
    const outcomes = await Promise.allSettled([
      readPipe(stdout, stdoutChunks, ioCancellable),
      readPipe(stderr, stderrChunks, ioCancellable),
      writeInput(),
      subprocess.wait_async(ioCancellable),
    ]);
    const terminationReason = await termination;
    const stdoutText = decodeChunks(stdoutChunks);
    const stderrText = decodeChunks(stderrChunks);

    if (terminationReason === "timeout") {
      throw new SubprocessTimeoutError(
        `Subprocess timed out after ${timeout}s`,
        stdoutText,
        stderrText,
      );
    }
    if (terminationReason === "cancelled") {
      throw GLib.Error.new_literal(
        Gio.io_error_quark(),
        Gio.IOErrorEnum.CANCELLED,
        "Subprocess cancelled",
      );
    }
    const failure = outcomes.find((outcome) => outcome.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;

    const exitCode = subprocess.get_if_exited() ? subprocess.get_exit_status() : -1;
    if (exitCode !== 0) {
      const spawnFailed = exitCode === 127 && stderrText.startsWith("provider-limits-spawn: ");
      throw new SubprocessError(
        `Subprocess exited with code ${exitCode}`,
        stderrText,
        spawnFailed ? -1 : exitCode,
      );
    }

    return { stdout: stdoutText, stderr: stderrText, exitCode };
  } finally {
    if (timeoutId !== null) GLib.Source.remove(timeoutId);
    if (cancelId !== undefined) options?.cancellable?.disconnect(cancelId);
    ioCancellable.cancel();
    stdout.close(null);
    stderr.close(null);
  }
}
