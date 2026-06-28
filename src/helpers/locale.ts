export function resolveLocale(
  settingsLang: string,
  envLcMessages: string | null,
  envLang: string | null,
): string {
  const raw =
    settingsLang?.trim() || envLcMessages?.split(".")[0] || envLang?.split(".")[0] || "en";
  return raw.replace(/_/g, "-");
}
