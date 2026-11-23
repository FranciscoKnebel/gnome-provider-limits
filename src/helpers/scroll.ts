import type Clutter from "gi://Clutter";
import type St from "gi://St";

type LegacyScrollView = St.ScrollView & {
  add_actor(actor: Clutter.Actor): void;
};

/** Attach an actor to a ScrollView on both modern and GNOME 45 shells. */
export function setScrollViewChild(scroll: St.ScrollView, actor: Clutter.Actor): void {
  if (typeof scroll.set_child === "function") {
    scroll.set_child(actor as unknown as St.Scrollable);
    return;
  }
  (scroll as LegacyScrollView).add_actor(actor);
}
