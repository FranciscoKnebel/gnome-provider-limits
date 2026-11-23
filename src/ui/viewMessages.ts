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

function cardsCopy(loadingTitle: string): PhaseMessages {
  return (phase, t) => {
    if (phase === "ready") return EMPTY_PRESENTATION;
    if (phase === "empty") {
      return withTitle(
        t,
        "No providers enabled",
        "Enable a provider in Settings to monitor usage limits.",
      );
    }
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

export const cockpitMessages: PhaseMessages = (phase, t) => {
  if (phase === "ready") return EMPTY_PRESENTATION;
  if (phase === "empty") {
    return withTitle(
      t,
      "No providers enabled",
      "Enable a provider in Settings to monitor usage limits.",
    );
  }
  return {
    title: t("Reading provider limits…"),
    subtitle: t("Waiting for initial refresh to complete."),
    placeholder: "…",
    accessibleText: t("Refreshing…"),
    showPlaceholder: true,
  };
};

export const pillsMessages: PhaseMessages = (phase, t) =>
  phase === "loading" ? withPlaceholder(t, "Loading provider limits…") : EMPTY_PRESENTATION;

export const statusGaugesMessages: PhaseMessages = (phase, t) => {
  if (phase === "ready") return EMPTY_PRESENTATION;
  if (phase === "empty") {
    return withTitle(
      t,
      "No providers enabled",
      "Enable a provider in Settings to monitor usage limits.",
    );
  }
  return {
    title: t("Reading provider limits…"),
    subtitle: t("Waiting for initial refresh to complete."),
    placeholder: "…",
    accessibleText: t("Refreshing…"),
    showPlaceholder: true,
  };
};

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
