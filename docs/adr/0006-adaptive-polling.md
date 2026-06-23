# Adaptive polling with configurable intervals

Each reader updates its state by polling, with an interval that adapts to data
activity. Each provider has its own adaptation state (independent of the
others).

- **Short interval (default 10s):** used when data is changing (provider in
  active use).
- **Long interval (default 120s):** used after N consecutive reads with no
  change (default N=3). Degrades to "lightweight" when idle.
- **Returns to short** on the first detected change.
- Manual refresh by clicking the extension forces an immediate read ignoring
  the adaptive window.

The defaults (short=10s, long=120s, N=3) are globally configurable in the
extension preferences. The provider CLI binary path is also configurable per
provider (confirmed in ADR-0003).

The in-memory cache compares the last read with the new one before
re-rendering the UI. If nothing changed, the widget isn't re-rendered (saves
clutter repaint).

Rationale: data only changes while the provider's CLI is in use; when no CLI
is active (common case), the interval degrades to 120s and cost becomes
negligible. When the user is in an intense session, the interval stays at 10s
The result is responsive without being aggressive. Adaptive polling is simpler than file
monitoring (which suffers from SQLite/WAL and atomic-rename of
`~/.claude.json`) and meets the "lightweight" requirement without sacrificing
utility.
