# Security and data flow

Provider Limits reuses logins already persisted by supported Providers. It sends
credentials only to the corresponding first-party usage endpoints on
`chatgpt.com`, `api.anthropic.com`, `opencode.ai` and `cli-chat-proxy.grok.com`.
There is no separate extension account or third-party credential collection.
Credentials are read for each Refresh and are not persisted by the extension.
GSettings stores preferences, never authentication material.

Provider response prose, error payloads and derived stacks are excluded from
logging. Diagnostics contain a source-controlled operation label, an allowlisted
error type, and numeric HTTP status or subprocess exit code when available.

Local SQLite reads run in a separate Python subprocess. Before opening any
Provider file, the subprocess installs a Linux seccomp filter that denies
writable file opens and filesystem mutation. SQLite uses `mode=ro`, normal
locking and in-memory temporary storage. The extension never substitutes
`immutable=1` for an unreadable live database. Missing WAL sidecars, required
journal recovery, or an unavailable sandbox produce unavailable telemetry;
they do not authorize filesystem writes or stale main-file reads.

The sandbox currently supports x86_64 and aarch64 Linux. Other architectures or
kernels that cannot install the filter fail closed for SQLite reads. This does
not disable first-party API reads. HTTP destruction cancels active requests and
backoff; a destroyed Reader cannot initiate subsequent requests.
