import type St from "gi://St";

import type { StatusBarRenderContext } from "./statusBar.js";

export interface StatusBarPlan {
  readonly key: string;
}

/**
 * Shared status-bar lifecycle: plan once, rebuild when the structure key
 * changes, and update widgets in place otherwise.
 */
export abstract class StatusBarRenderer<TPlan extends StatusBarPlan = StatusBarPlan> {
  private _structureKey: string | null = null;

  constructor(protected readonly parent: St.BoxLayout) {}

  protected abstract plan(context: StatusBarRenderContext): TPlan;

  protected abstract build(plan: TPlan): void;

  protected abstract update(plan: TPlan): void;

  /** Release renderer-owned widget references when the structure is replaced. */
  protected onDispose(): void {}

  render(context: StatusBarRenderContext): void {
    const plan = this.plan(context);
    if (plan.key === this._structureKey) {
      this.update(plan);
      return;
    }
    this.dispose();
    this.build(plan);
    this._structureKey = plan.key;
  }

  dispose(): void {
    let child = this.parent.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      child.destroy();
      child = next;
    }
    this._structureKey = null;
    this.onDispose();
  }
}
