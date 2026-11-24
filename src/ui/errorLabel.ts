import St from "gi://St";

/** A wrapping, expanded error label shared by every panel style. */
export function createErrorLabel(text: string, styleClass: string): St.Label {
  const label = new St.Label({
    text,
    style_class: styleClass,
    x_expand: true,
  });
  label.clutter_text.line_wrap = true;
  return label;
}
