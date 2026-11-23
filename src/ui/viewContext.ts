import type { ProviderName } from "../constants.js";
import type { FieldDef, ReaderResult } from "../readers/base.js";

export interface ProviderViewContext {
  order: readonly ProviderName[];
  results: ReadonlyMap<ProviderName, ReaderResult>;
  locale: string;
  fieldDefs: Readonly<Record<ProviderName, readonly FieldDef[]>>;
  displayName: (provider: ProviderName) => string;
  shortDisplayName: (provider: ProviderName) => string;
  statusFields: (provider: ProviderName) => readonly string[];
  panelFields: (provider: ProviderName) => readonly string[];
  isEnabled: (provider: ProviderName) => boolean;
  hasEnabledProviders: boolean;
  activeProviders: readonly ProviderName[];
  t: (text: string) => string;
}
