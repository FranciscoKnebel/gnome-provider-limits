import type St from "gi://St";

import { clearChildren } from "../helpers/children.js";
import type { ProviderViewContext, ViewPhase } from "./viewContext.js";

export interface PlaceholderPlan {
  readonly kind: "placeholder";
  readonly phase: ViewPhase;
  readonly placeholder: string | null;
  readonly placeholderAccessibleText: string;
  readonly showPlaceholder: boolean;
}

export type ZonePlan<TSegment> =
  | PlaceholderPlan
  | { readonly kind: "segments"; readonly segments: readonly TSegment[] };

/** Shared render skeleton: clear, derive one plan, then render that plan. */
export abstract class StatusBarRenderer<TPlan> {
  protected readonly parent: St.BoxLayout;

  constructor(parent: St.BoxLayout) {
    this.parent = parent;
  }

  render(context: ProviderViewContext): void {
    this.dispose();
    this.renderPlan(this.plan(context));
  }

  dispose(): void {
    clearChildren(this.parent, (child) => child.destroy());
  }

  protected abstract plan(context: ProviderViewContext): TPlan;

  protected abstract renderPlan(plan: TPlan): void;
}
