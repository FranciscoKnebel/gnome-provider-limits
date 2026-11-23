import type { ProviderViewContext, ViewPhase } from "./viewContext.js";

export type ViewSurface = "cards" | "matrix" | "pills" | "gauges" | "compact";

export interface EmptyPresentation {
  readonly title: string;
  readonly subtitle: string;
  readonly placeholder: string;
  readonly accessibleText: string;
  readonly showPlaceholder: boolean;
}

export interface ViewMessagesOptions {
  readonly phase: ViewPhase;
  readonly surface: ViewSurface;
  readonly running: boolean;
  readonly t: (s: string) => string;
}

export type PhaseResult =
  | {
      readonly kind: "placeholder";
      readonly phase: ViewPhase;
      readonly message: EmptyPresentation;
    }
  | { readonly kind: "ready" };

const NONE: EmptyPresentation = {
  title: "",
  subtitle: "",
  placeholder: "",
  accessibleText: "",
  showPlaceholder: false,
};

function withTitle(title: string, subtitle = ""): EmptyPresentation {
  return { ...NONE, title, subtitle };
}

function withPlaceholder(placeholder: string, accessibleText: string): EmptyPresentation {
  return { ...NONE, placeholder, accessibleText, showPlaceholder: true };
}

/**
 * The one mapping from a view phase to the words and placeholder every surface
 * renders. Plan builders consume this instead of owning their own message switches.
 */
export function viewMessages(options: ViewMessagesOptions): EmptyPresentation {
  const { phase, surface, running, t: tr } = options;

  if (phase === "ready") return NONE;

  switch (surface) {
    case "cards":
      if (phase === "empty") {
        return withTitle(
          tr("No providers enabled"),
          tr("Enable a provider in Settings to monitor usage limits."),
        );
      }
      return withTitle(running ? tr("Loading provider limits…") : tr("Waiting for provider data…"));

    case "matrix":
      return withTitle(
        phase === "empty"
          ? tr("No providers enabled. Open Settings to enable a provider.")
          : tr("Reading provider limits…"),
      );

    case "pills":
      return phase === "loading" ? withPlaceholder("…", tr("Loading provider limits…")) : NONE;

    case "gauges":
      if (phase === "empty") {
        return withTitle(
          tr("No providers enabled"),
          tr("Enable a provider in Settings to monitor usage limits."),
        );
      }
      return {
        title: tr("Reading provider limits…"),
        subtitle: tr("Waiting for initial refresh to complete."),
        placeholder: "…",
        accessibleText: tr("Refreshing…"),
        showPlaceholder: true,
      };

    case "compact":
      return phase === "loading" ? withPlaceholder("…", tr("Reading provider limits…")) : NONE;
  }

  return NONE;
}

function hasNothingToShow(message: EmptyPresentation): boolean {
  return (
    message.title === "" &&
    message.subtitle === "" &&
    message.placeholder === "" &&
    message.accessibleText === "" &&
    !message.showPlaceholder
  );
}

/** The one phase-to-placeholder decision shared by every plan builder. */
export function phaseResult(
  view: ProviderViewContext,
  surface: ViewSurface,
  running: boolean,
): PhaseResult {
  const message = viewMessages({
    phase: view.phase,
    surface,
    running,
    t: view.t,
  });
  if (view.phase === "ready" || hasNothingToShow(message)) return { kind: "ready" };
  return { kind: "placeholder", phase: view.phase, message };
}
