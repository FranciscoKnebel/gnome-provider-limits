# OpenCode telemetry fixture provenance

`opencode-telemetry.sql` is a synthetic, contract-derived example, not a captured
account database. No live account behavior has been verified by this fixture.

It includes the minimal relevant columns from the
[OpenCode v1.2.0 session/message schema](https://github.com/anomalyco/opencode/blob/v1.2.0/packages/opencode/src/session/session.sql.ts).
Assistant-message JSON carries cost; session rows do not. User costs, missing
costs, malformed JSON, nonnumeric costs and negative costs are ignored. Each
assistant message is counted once, independently of session count.
