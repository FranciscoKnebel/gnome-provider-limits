export const PROVIDER_NAMES = ["codex", "claude", "opencode"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export const PROVIDER_LABELS: Record<string, string> = {
  codex: "Codex",
  claude: "Claude",
  opencode: "OpenCode",
};

export const DEFAULT_REFRESH_SHORT_INTERVAL_SECONDS = 10;
export const DEFAULT_REFRESH_LONG_INTERVAL_SECONDS = 120;
export const DEFAULT_REFRESH_STABLE_READS_THRESHOLD = 3;

export const DEFAULT_PROVIDERS_ORDER: string[] = ["codex", "claude", "opencode"];

export const SQLITE_CACHE_TTL_SECONDS = 5;
export const COOKIE_CACHE_TTL_SECONDS = 300;

export const HTTP_TIMEOUT_SECONDS = 30;
export const SUBPROCESS_TIMEOUT_SECONDS = 10;

export const SCHEMA_ID = "org.gnome.shell.extensions.gnome-provider-limits";
export const GETTEXT_DOMAIN = "gnome-provider-limits";
