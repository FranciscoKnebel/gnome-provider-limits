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
