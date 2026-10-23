# Grok subscription credits fixture

`grok-subscription-credits.json` is a contract-derived example, not an
authenticated account capture. Its fields and values come from the public
`billing_config_deserializes_credits_config_shape` test in the official
[Grok Build billing source](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/extensions/billing.rs).
The unused historical-period array is omitted. No user credentials or identity
data are present.

Live SuperGrok account compatibility still requires manual verification. Replace
or supplement this example with a sanitized capture when one becomes available.
