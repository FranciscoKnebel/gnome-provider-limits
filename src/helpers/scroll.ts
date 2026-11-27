import type Clutter from "gi://Clutter";
import type St from "gi://St";

type LegacyScrollView = St.ScrollView & {
  add_actor(actor: Clutter.Actor): void;
};

function isLegacyScrollView(scroll: St.ScrollView): scroll is LegacyScrollView {
  return "add_actor" in scroll;
}

/** Attach an actor to a ScrollView on both modern and GNOME 45 shells. */
export function setScrollViewChild(scroll: St.ScrollView, actor: St.Widget & St.Scrollable): void {
  if (typeof scroll.set_child === "function") {
    scroll.set_child(actor);
    return;
  }
  if (isLegacyScrollView(scroll)) scroll.add_actor(actor);
}
