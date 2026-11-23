// Compatibility shim: health types and PRESENTATION now live in providerHealth.ts.
export type {
  ProviderState,
  ProviderTone,
  ProviderAttention,
  ProviderHealth,
  Presentation,
} from "./providerHealth.js";
export { PRESENTATION } from "./providerHealth.js";
