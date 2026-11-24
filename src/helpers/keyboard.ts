import Clutter from "gi://Clutter";
import type St from "gi://St";

export type ActivationPointerSignal = "clicked" | "button-release-event";

export interface ActivationBinding {
  /**
   * Pointer signal that triggers activation. Defaults to "clicked", which is
   * what St.Button emits. Reactive boxes must opt in to "button-release-event".
   */
  readonly pointerSignals?: readonly ActivationPointerSignal[];
  /** Fallback for key-press-event when the key is not an activation key. */
  readonly onOtherKey?: (event: Clutter.Event) => boolean;
}

/** True for the Enter and Space keys used to activate focused actors. */
export function isActivationKey(symbol: number): boolean {
  return (
    symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter || symbol === Clutter.KEY_space
  );
}

/** Share one activation contract between buttons, toolbar actions and menu rows. */
export function bindActivation(
  actor: St.Widget,
  onActivate: () => void,
  binding: ActivationBinding = {},
): void {
  const activate = () => {
    onActivate();
    return Clutter.EVENT_STOP;
  };
  const pointerSignals = binding.pointerSignals ?? ["clicked"];
  for (const signal of pointerSignals) actor.connect(signal, activate);
  actor.connect("key-press-event", (_actor: Clutter.Actor, event: Clutter.Event) => {
    if (isActivationKey(event.get_key_symbol())) {
      onActivate();
      return Clutter.EVENT_STOP;
    }
    return binding.onOtherKey?.(event) ?? Clutter.EVENT_PROPAGATE;
  });
}
