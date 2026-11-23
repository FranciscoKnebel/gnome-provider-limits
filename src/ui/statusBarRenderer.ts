import type St from "gi://St";

import { clearChildren } from "../helpers/children.js";
import type { ProviderViewContext } from "./viewContext.js";

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
