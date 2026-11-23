import type { ProviderViewContext, ViewPhase } from "./viewContext.js";

export type Translate = (text: string) => string;

export interface TitlePresentation {
  readonly kind: "title";
  readonly title: string;
  readonly subtitle: string;
}

export interface SpinnerPresentation {
  readonly kind: "spinner";
  readonly placeholder: string;
  readonly accessibleText: string;
}

export type EmptyPresentation = TitlePresentation | SpinnerPresentation;

/** The only contract a plan builder needs from the copy layer. */
export type PhaseMessages = (phase: ViewPhase, t: Translate) => EmptyPresentation;

const NO_PRESENTATION: EmptyPresentation = { kind: "title", title: "", subtitle: "" };

function withTitle(title: string, subtitle = ""): TitlePresentation {
  return { kind: "title", title, subtitle };
}

function withPlaceholder(accessibleText: string, placeholder = "…"): SpinnerPresentation {
  return { kind: "spinner", placeholder, accessibleText };
}

/** Canonical no-providers copy, shared by every surface that shows an empty state. */
export function noProvidersPresentation(t: Translate): TitlePresentation {
  return withTitle(
    t("No providers enabled"),
    t("Enable a provider in Settings to monitor usage limits."),
  );
}

type TitleFactory = (t: Translate) => string;

function cardsCopy(title: TitleFactory): PhaseMessages {
  return (phase, t) => {
    if (phase === "ready") return NO_PRESENTATION;
    if (phase === "empty") return noProvidersPresentation(t);
    return withTitle(title(t));
  };
}

/** Default card copy while a refresh is not in progress. */
export const cardsMessages: PhaseMessages = cardsCopy((t) => t("Waiting for provider data…"));

/** Cards-only loading copy, selected by the cards section while a refresh is in progress. */
export const cardsRunningMessages: PhaseMessages = cardsCopy((t) => t("Loading provider limits…"));

export const matrixMessages: PhaseMessages = (phase, t) => {
  if (phase === "ready") return NO_PRESENTATION;
  return withTitle(
    phase === "empty"
      ? t("No providers enabled. Open Settings to enable a provider.")
      : t("Reading provider limits…"),
  );
};

/** Panel gauges copy: the shell renders the title and subtitle as an empty-state row. */
export const cockpitMessages: PhaseMessages = (phase, t) => {
  if (phase === "ready") return NO_PRESENTATION;
  if (phase === "empty") return noProvidersPresentation(t);
  return withTitle(t("Reading provider limits…"), t("Waiting for initial refresh to complete."));
};

/** Status gauges copy: only the spinner placeholder is rendered on this surface. */
export const statusGaugesMessages: PhaseMessages = (phase, t) =>
  phase === "loading" ? withPlaceholder(t("Refreshing…")) : NO_PRESENTATION;

export const pillsMessages: PhaseMessages = (phase, t) =>
  phase === "loading" ? withPlaceholder(t("Loading provider limits…")) : NO_PRESENTATION;

export const statusCompactMessages: PhaseMessages = (phase, t) =>
  phase === "loading" ? withPlaceholder(t("Reading provider limits…")) : NO_PRESENTATION;

export type PhaseResult =
  | {
      readonly kind: "placeholder";
      readonly phase: ViewPhase;
      readonly message: EmptyPresentation;
    }
  | { readonly kind: "ready" };

function hasNothingToShow(message: EmptyPresentation): boolean {
  return message.kind === "title" && message.title === "" && message.subtitle === "";
}

/** The one phase-to-placeholder decision shared by every surface. */
export function phaseResult(view: ProviderViewContext, messages: PhaseMessages): PhaseResult {
  const message = messages(view.phase, view.t);
  if (view.phase === "ready" || hasNothingToShow(message)) return { kind: "ready" };
  return { kind: "placeholder", phase: view.phase, message };
}
