import type Gio from "gi://Gio";

import { runSubprocess } from "./subprocess.js";

const CURSOR_KEYRING_SERVICE = "cursor-credentials";
const CURSOR_KEYRING_ACCOUNT = "cursor-user";
const KEYRING_TIMEOUT_SECONDS = 5;

export async function readCursorKeyringCredential(
  cancellable?: Gio.Cancellable,
): Promise<string | null> {
  try {
    const { stdout } = await runSubprocess(
      [
        "secret-tool",
        "lookup",
        "service",
        CURSOR_KEYRING_SERVICE,
        "account",
        CURSOR_KEYRING_ACCOUNT,
      ],
      { cancellable, timeoutSeconds: KEYRING_TIMEOUT_SECONDS },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
