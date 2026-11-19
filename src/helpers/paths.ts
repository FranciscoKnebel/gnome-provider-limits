export type Env = Record<string, string | null | undefined>;

function envValue(env: Env, key: string): string | null {
  const value = env[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function resolveCodexHome(env: Env, home: string): string {
  return envValue(env, "CODEX_HOME") ?? `${home}/.codex`;
}

export function resolveClaudeConfigDir(env: Env, home: string): string {
  return envValue(env, "CLAUDE_CONFIG_DIR") ?? `${home}/.claude`;
}

export function resolveOpenCodeDataDir(env: Env, home: string): string {
  const dataHome = envValue(env, "XDG_DATA_HOME") ?? `${home}/.local/share`;
  return `${dataHome}/opencode`;
}

export function expandHomePath(path: string, home: string): string {
  if (path === "~") return home;
  return path.startsWith("~/") ? `${home}/${path.slice(2)}` : path;
}

export function resolveCursorAuthPaths(env: Env, home: string): string[] {
  const cursorHome = envValue(env, "CURSOR_HOME") ?? `${home}/.cursor`;
  const configHome = envValue(env, "XDG_CONFIG_HOME") ?? `${home}/.config`;
  const candidates = [
    `${cursorHome}/sdk/auth.json`,
    `${configHome}/cursor/auth.json`,
    `${cursorHome}/auth.json`,
  ];
  return [...new Set(candidates)];
}

export function resolveGooglePrimaryAuthPaths(env: Env, home: string): string[] {
  const configHome = envValue(env, "XDG_CONFIG_HOME") ?? `${home}/.config`;
  const geminiRoot = envValue(env, "GEMINI_CLI_HOME") ?? home;
  const geminiDir = envValue(env, "GEMINI_HOME") ?? `${geminiRoot}/.gemini`;
  const acpEnv = envValue(env, "ANTIGRAVITY_ACP_TOKEN_PATH");

  const candidates: string[] = [];
  if (acpEnv) candidates.push(expandHomePath(acpEnv, home));
  candidates.push(
    `${geminiDir}/oauth_creds.json`,
    `${geminiDir}/antigravity-acp/acp_token.json`,
    `${geminiDir}/antigravity/acp_token.json`,
    `${configHome}/antigravity/acp_token.json`,
  );
  return [...new Set(candidates)];
}

export function resolveGoogleAdcAuthPaths(env: Env, home: string): string[] {
  const configHome = envValue(env, "XDG_CONFIG_HOME") ?? `${home}/.config`;
  const gcloudDir = envValue(env, "CLOUDSDK_CONFIG") ?? `${configHome}/gcloud`;
  const googleAdcEnv = envValue(env, "GOOGLE_APPLICATION_CREDENTIALS");

  const candidates: string[] = [];
  if (googleAdcEnv) candidates.push(expandHomePath(googleAdcEnv, home));
  candidates.push(`${gcloudDir}/application_default_credentials.json`);
  return [...new Set(candidates)];
}

export function resolveGoogleAuthPaths(
  env: Env,
  home: string,
  extraAntigravityPaths: readonly string[] = [],
): string[] {
  return [
    ...new Set([
      ...resolveGooglePrimaryAuthPaths(env, home),
      ...extraAntigravityPaths,
      ...resolveGoogleAdcAuthPaths(env, home),
    ]),
  ];
}
