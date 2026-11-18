# Cursor period usage fixture

`cursor-period-usage.json` is a contract-derived example, not an authenticated
account capture. Its field names, types, and ConnectRPC JSON wire encoding
(`int64` epoch milliseconds as decimal strings, USD amounts in integer cents,
and floating-point percentages) come from the `aiserver.v1.DashboardService`
`GetCurrentPeriodUsageResponse`, `PlanUsage`, and `SpendLimitUsage` protobuf
definitions published in the official `@cursor/sdk` npm package (`v1.2.0`).

No user credentials, tokens, or account identity fields are present. Live
authenticated account behavior was not captured into this repository.
