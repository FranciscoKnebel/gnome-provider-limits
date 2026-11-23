import type St from "gi://St";

import { PlanRenderer, type RenderPlan } from "./planRenderer.js";
import type { ProviderViewContext } from "./viewContext.js";

export type StatusBarPlan = RenderPlan;

/** Status-bar specialization that owns the children of a single box layout. */
export abstract class StatusBarRenderer<
  TPlan extends StatusBarPlan = StatusBarPlan,
> extends PlanRenderer<TPlan, ProviderViewContext> {
  constructor(protected readonly parent: St.BoxLayout) {
    super();
  }

  protected clear(): void {
    let child = this.parent.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      child.destroy();
      child = next;
    }
  }
}
