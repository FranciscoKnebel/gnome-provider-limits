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
