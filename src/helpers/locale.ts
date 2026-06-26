export function resolveLocale(
  settingsLang: string,
  envLcMessages: string | null,
  envLang: string | null,
): string {
  if (settingsLang && settingsLang.trim()) return settingsLang.trim();
  const env = envLcMessages ?? envLang ?? "en";
  return env.split(".")[0];
}
