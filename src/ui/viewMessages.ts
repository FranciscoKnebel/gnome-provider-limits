import type { ProviderViewContext, ViewPhase } from "./viewContext.js";

export type Translate = (text: string) => string;

export interface EmptyPresentation {
  readonly title: string;
  readonly subtitle: string;
  readonly placeholder: string;
  readonly accessibleText: string;
  readonly showPlaceholder: boolean;
}

/** The only contract a plan builder needs from the copy layer. */
export type PhaseMessages = (phase: ViewPhase, t: Translate) => EmptyPresentation;

const EMPTY_PRESENTATION: EmptyPresentation = {
  title: "",
  subtitle: "",
  placeholder: "",
  accessibleText: "",
  showPlaceholder: false,
};

function withTitle(t: Translate, title: string, subtitle = ""): EmptyPresentation {
  return { ...EMPTY_PRESENTATION, title: t(title), subtitle: subtitle ? t(subtitle) : "" };
}

function withPlaceholder(
  t: Translate,
  accessibleText: string,
  placeholder = "…",
): EmptyPresentation {
  return {
    ...EMPTY_PRESENTATION,
    placeholder,
    accessibleText: t(accessibleText),
    showPlaceholder: true,
  };
}

/** Canonical no-providers copy, shared by every surface that shows an empty state. */
export function noProvidersPresentation(t: Translate): EmptyPresentation {
  return withTitle(
    t,
    "No providers enabled",
    "Enable a provider in Settings to monitor usage limits.",
  );
}

function cardsCopy(loadingTitle: string): PhaseMessages {
  return (phase, t) => {
    if (phase === "ready") return EMPTY_PRESENTATION;
    if (phase === "empty") return noProvidersPresentation(t);
    return withTitle(t, loadingTitle);
  };
}

/** Default card copy while a refresh is not in progress. */
export const cardsMessages: PhaseMessages = cardsCopy("Waiting for provider data…");

/** Cards-only loading copy, selected by the cards section while a refresh is in progress. */
export const cardsRunningMessages: PhaseMessages = cardsCopy("Loading provider limits…");

export const matrixMessages: PhaseMessages = (phase, t) => {
  if (phase === "ready") return EMPTY_PRESENTATION;
  return withTitle(
    t,
    phase === "empty"
      ? "No providers enabled. Open Settings to enable a provider."
      : "Reading provider limits…",
  );
};

/** One canonical placeholder contract for gauges-style panel and status surfaces. */
const gaugesPlaceholderMessages: PhaseMessages = (phase, t) => {
  if (phase === "ready") return EMPTY_PRESENTATION;
  if (phase === "empty") return noProvidersPresentation(t);
  return {
    title: t("Reading provider limits…"),
    subtitle: t("Waiting for initial refresh to complete."),
    placeholder: "…",
    accessibleText: t("Refreshing…"),
    showPlaceholder: true,
  };
};

export const cockpitMessages: PhaseMessages = gaugesPlaceholderMessages;

export const pillsMessages: PhaseMessages = (phase, t) =>
  phase === "loading" ? withPlaceholder(t, "Loading provider limits…") : EMPTY_PRESENTATION;

export const statusGaugesMessages: PhaseMessages = gaugesPlaceholderMessages;

export const statusCompactMessages: PhaseMessages = (phase, t) =>
  phase === "loading" ? withPlaceholder(t, "Reading provider limits…") : EMPTY_PRESENTATION;

export type PhaseResult =
  | {
      readonly kind: "placeholder";
      readonly phase: ViewPhase;
      readonly message: EmptyPresentation;
    }
  | { readonly kind: "ready" };

function hasNothingToShow(message: EmptyPresentation): boolean {
  return (
    message.title === "" &&
    message.subtitle === "" &&
    message.placeholder === "" &&
    message.accessibleText === "" &&
    !message.showPlaceholder
  );
}

/** The one phase-to-placeholder decision shared by every surface. */
export function phaseResult(view: ProviderViewContext, messages: PhaseMessages): PhaseResult {
  const message = messages(view.phase, view.t);
  if (view.phase === "ready" || hasNothingToShow(message)) return { kind: "ready" };
  return { kind: "placeholder", phase: view.phase, message };
}
