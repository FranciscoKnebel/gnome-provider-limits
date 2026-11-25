import type Gio from "gi://Gio";

import { runSubprocess } from "./subprocess.js";

const CURSOR_KEYRING_SERVICE = "cursor-credentials";
const CURSOR_KEYRING_ACCOUNT = "cursor-user";
const KEYRING_TIMEOUT_SECONDS = 5;
const SECRET_PREFIX = "secret = ";

export function parseSecretToolSearch(stdout: string): string | null {
  for (const line of stdout.split("\n")) {
    if (!line.startsWith(SECRET_PREFIX)) continue;
    const secret = line.slice(SECRET_PREFIX.length).replace(/\r$/, "");
    return secret || null;
  }
  return null;
}

export async function readCursorKeyringCredential(
  cancellable?: Gio.Cancellable,
): Promise<string | null> {
  try {
    const { stdout } = await runSubprocess(
      [
        "secret-tool",
        "search",
        "--all",
        "service",
        CURSOR_KEYRING_SERVICE,
        "account",
        CURSOR_KEYRING_ACCOUNT,
      ],
      { cancellable, timeoutSeconds: KEYRING_TIMEOUT_SECONDS },
    );
    return parseSecretToolSearch(stdout);
  } catch {
    return null;
  }
}
