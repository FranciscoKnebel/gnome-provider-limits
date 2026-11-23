import type { StyleSpec } from "./styles.js";
import type { ProviderViewContext, ViewPhase } from "./viewContext.js";

/** Panel surfaces own their own empty-state copy. */
export type PanelSurface = "cards" | "matrix" | "cockpit";

/** Status bar surfaces own their own placeholder copy and accessible names. */
export type StatusBarSurface = "pills" | "gauges" | "compact";

export type ViewSurface = PanelSurface | StatusBarSurface;

export interface EmptyPresentation {
  readonly title: string;
  readonly subtitle: string;
  readonly placeholder: string;
  readonly accessibleText: string;
  readonly showPlaceholder: boolean;
}

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

/** The one phase-to-placeholder decision shared by every plan builder. */
export function phaseResult(
  view: ProviderViewContext,
  spec: StyleSpec<string>,
  running: boolean,
): PhaseResult {
  const message = spec.messages(view.phase, running, view.t);
  if (view.phase === "ready" || hasNothingToShow(message)) return { kind: "ready" };
  return { kind: "placeholder", phase: view.phase, message };
}
