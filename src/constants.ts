export const PROVIDER_NAMES = ["codex", "claude", "opencode", "grok", "cursor", "google"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

/** Build a complete record for every provider from the canonical name list. */
export function providerRecord<T>(make: (provider: ProviderName) => T): Record<ProviderName, T> {
  const record = {} as Record<ProviderName, T>;
  for (const provider of PROVIDER_NAMES) record[provider] = make(provider);
  return record;
}

/** How a provider's configured path is presented in preferences. */
export type ProviderPathKind = "cli" | "auth-file";

export interface ProviderMetadata {
  readonly pathKind: ProviderPathKind;
}

/** Canonical per-provider capabilities, shared by readers and preferences. */
export const PROVIDER_METADATA: Readonly<Record<ProviderName, ProviderMetadata>> = {
  codex: { pathKind: "cli" },
  claude: { pathKind: "cli" },
  opencode: { pathKind: "cli" },
  grok: { pathKind: "auth-file" },
  cursor: { pathKind: "auth-file" },
  google: { pathKind: "auth-file" },
};

export const DEFAULT_REFRESH_SHORT_INTERVAL_SECONDS = 10;
export const DEFAULT_REFRESH_LONG_INTERVAL_SECONDS = 120;
export const DEFAULT_REFRESH_STABLE_READS_THRESHOLD = 3;

export const DEFAULT_PROVIDERS_ORDER: readonly ProviderName[] = PROVIDER_NAMES;

export const SQLITE_CACHE_TTL_SECONDS = 5;

export const HTTP_TIMEOUT_SECONDS = 15;
export const SUBPROCESS_TIMEOUT_SECONDS = 10;
export const SUBPROCESS_KILL_GRACE_MS = 500;

export const SCHEMA_ID = "org.gnome.shell.extensions.gnome-provider-limits";
export const GETTEXT_DOMAIN = "gnome-provider-limits";
