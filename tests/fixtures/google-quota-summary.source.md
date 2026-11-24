# Google quota summary fixture provenance

`google-quota-summary.json` is a sanitized payload matching Google Cloud Code's
`v1internal:retrieveUserQuotaSummary` JSON response structure used by Gemini CLI
and Antigravity (`groups[].buckets[]` with `bucketId`, `window`, `remainingFraction`,
`resetTime`, and optional `description`).

The contract and live behavior (`Google AI Ultra` tier, `gemini-5h`, `gemini-weekly`,
`3p-5h`, and `3p-weekly` buckets, plus `v1internal:fetchAvailableModels` and
`v1internal:loadCodeAssist`) were verified live against an authenticated Antigravity
subscription account during development. No live account identifiers, project IDs,
tokens, or raw account timestamps are stored in this repository.

`google-quota-summary-weekly-only.json` is a sanitized payload captured from an
`Antigravity Starter Quota` account. It contains only `gemini-weekly` and
`3p-weekly` buckets, with no 5-hour buckets. Reset timestamps were replaced with
synthetic values that preserve the relative window offsets. The fixture verifies
that the parser records the 5-hour windows as unreported. The reader maps unreported
5-hour windows to not applicable only when the plan is known not to expose them, as
with Antigravity Starter Quota; under other or unknown plans they stay unavailable.
Explicitly disabled buckets are not applicable, while malformed buckets and
unreported windows on supported plans remain unavailable.
