# Security: tokens, logs, cache, keyring, permissions

Policy: "read from disk every refresh, never cache credentials, never log
credentials, never persist credentials ourselves, destroy everything in
`disable()`".

## Tokens in memory: don't cache

Read from disk every refresh. Adaptive refresh (ADR-0006) already spaces reads
(10s-120s); reading a few-line JSON from disk is <1ms. Caching token in memory
creates a window where a revoked token (`codex logout`) is still used. That is bad
behavior. Without cache, `codex logout` reflects on the next refresh. The read
token is used in that HTTP call and discarded (local variable in `read()`).

## Logs: never credentials

Never log tokens, cookies, or any field value that may contain PII
(`oauthAccount` email, `accountId`). Log only: errors with normalized message
(e.g. "Codex OAuth API: 401" without the token), `pathsTried`,
`ReaderStatus`. If verbose debug is needed, gate by a GSettings key
`debug-logging` (bool, default false) that enables detailed logs, but even
then, tokens/cookies never appear. `redactForLog(obj)` function in
`helpers/log.ts` strips sensitive keys (`token`, `access_token`,
`refresh_token`, `cookie`, `Authorization`, `sessionKey`, `accountId`,
`email`) before logging.

## Cookie cache (OpenCode v1.x): in-memory only, short TTL

Cookies read from the browser are parsed, kept in a reader variable, reused
between refreshes until a short TTL (default 5 min) expires. Don't persist in
GSettings (transient), don't write to file. Revoked cookies (`opencode.ai`
logout) stop being used within minutes. If the user closes the GNOME session
(shell restart), in-memory cookies vanish and are re-read from the browser on
the next refresh.

## GNOME keyring: don't use

The extension only reads tokens already persisted by the provider on disk;
never asks the user for credentials, never stores its own credentials. Keyring
would be necessary if we were storing tokens/cookies ourselves, but ADR-0011
is explicit: we reuse what the provider already persisted. No keyring = fewer
dependencies, fewer prompts to the user, smaller security surface.

## File permissions: v1 creates no files

The extension creates no state/cache files (tokens not cached, cookies
in-memory only, reader data is transient). If in the future we need persistent
cache (e.g. rate_limits cache between shell sessions), create in
`~/.local/share/gnome-provider-limits/` with permissions `0700` (dir) and
`0600` (files) via `Gio.File.make_directory_with_parents` + implicit `chmod`
by adjusted `umask`. For now, v1 only reads from provider disk and persists
config in GSettings (managed by dconf, already isolated).

## Destruction in disable()

`Extension.disable()` calls `reader.destroy()` on each reader. Each reader
clears its local variables (tokens read in the last call, in-memory cookies).
The panel and status bar are destroyed by GNOME Shell. GSettings persists
(user config), but contains no credentials, only preferences.

Rationale: reading from disk every refresh is cheap and ensures credential
revocation (`codex logout`, `claude` re-auth, `opencode.ai` logout) reflects
on the next refresh. Never caching/persisting credentials minimizes exposure
surface. Logs without credentials avoid leakage via `journalctl` or
`~/.xsession-errors`. No keyring = fewer dependencies and prompts. v1 creates
no files beyond GSettings, so nothing to leak via permissions.
