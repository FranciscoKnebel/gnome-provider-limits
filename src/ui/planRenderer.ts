/** Minimal contract for a plan that drives incremental rendering. */
export interface RenderPlan {
  readonly key: string;
}

/**
 * Shared incremental-render lifecycle: derive a plan, rebuild when its key
 * changes, update widgets in place otherwise, and clear everything on dispose.
 */
export abstract class PlanRenderer<TPlan extends RenderPlan = RenderPlan, TContext = void> {
  private _structureKey: string | null = null;

  protected abstract plan(context: TContext): TPlan;

  protected abstract build(plan: TPlan): void;

  protected abstract update(plan: TPlan): void;

  /** Remove everything built by this renderer, leaving it ready to rebuild. */
  protected abstract clear(): void;

  /** Release renderer-owned widget references when the structure is replaced. */
  protected onDispose(): void {}

  render(context: TContext): void {
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
    this.clear();
    this._structureKey = null;
    this.onDispose();
  }
}
