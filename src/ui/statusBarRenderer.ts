import type St from "gi://St";

import { clearChildren } from "../helpers/children.js";
import type { ProviderViewContext } from "./viewContext.js";
import type { EmptyPresentation, PhaseResult } from "./viewMessages.js";

/** The lifecycle every status bar section renderer implements. */
export interface StatusBarSectionRenderer {
  render(context: ProviderViewContext): void;
  dispose(): void;
}

/** Shared render skeleton: clear, derive the phase, then render that view. */
export abstract class StatusBarRenderer implements StatusBarSectionRenderer {
  protected readonly parent: St.BoxLayout;

  constructor(parent: St.BoxLayout) {
    this.parent = parent;
  }

  render(context: ProviderViewContext): void {
    this.dispose();
    this.renderView(context);
  }

  dispose(): void {
    clearChildren(this.parent, (child) => child.destroy());
  }

  /** Renders a placeholder when present. Acts as a guard so callers can fall through to segments. */
  protected renderPlaceholder(
    phase: PhaseResult,
    factory: (message: EmptyPresentation) => St.Widget,
  ): boolean {
    if (phase.kind !== "placeholder" || !phase.message.showPlaceholder) return false;
    this.parent.add_child(factory(phase.message));
    return true;
  }

  protected abstract renderView(context: ProviderViewContext): void;
}
