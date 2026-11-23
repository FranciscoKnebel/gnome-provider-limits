import Clutter from "gi://Clutter";
import St from "gi://St";

import type { ProviderDisplayModel } from "./displayModel.js";
import { applyStatusAttentionClass, applyToneClass, type StatusAttention } from "./tone.js";

/** The shared value labels for one provider's status fields. */
export function statusValueLabels(model: ProviderDisplayModel): St.Label[] {
  return model.statusViews.map((view) => {
    const valueLabel = new St.Label({
      text: view.valueText,
      style_class: "pl-status-value",
      y_align: Clutter.ActorAlign.CENTER,
    });
    valueLabel.accessible_name = view.accessibleText;
    applyToneClass(valueLabel, view.tone);
    return valueLabel;
  });
}

export interface StatusSegmentMetrics {
  /** Widgets placed before the provider label, such as a health dot or a gauge. */
  readonly beforeName: readonly St.Widget[];
  /** Widgets placed after the provider label, such as state tags and value labels. */
  readonly afterName: readonly St.Widget[];
}

export type StatusMetricFactory = (model: ProviderDisplayModel) => StatusSegmentMetrics;

export interface StatusSegmentStyle {
  readonly segmentClass: string;
  readonly nameClass?: string;
  readonly nameText?: string;
  readonly nameAccessible?: boolean;
  readonly accessibleName?: string;
  readonly attention?: StatusAttention;
}

/** Builds one provider segment: container, provider label and style-specific metrics. */
export function buildStatusSegment(
  model: ProviderDisplayModel,
  style: StatusSegmentStyle,
  buildMetricWidget: StatusMetricFactory,
): St.BoxLayout {
  const segment = new St.BoxLayout({
    style_class: style.segmentClass,
    y_align: Clutter.ActorAlign.CENTER,
  });
  if (style.accessibleName !== undefined) segment.accessible_name = style.accessibleName;

  const nameText = style.nameText ?? model.shortDisplayName;
  const nameLabel = new St.Label({
    text: nameText,
    style_class: style.nameClass ?? "provider-limits-provider-label",
    y_align: Clutter.ActorAlign.CENTER,
  });
  if (style.nameAccessible) nameLabel.accessible_name = nameText;

  const { beforeName, afterName } = buildMetricWidget(model);
  for (const widget of beforeName) segment.add_child(widget);
  segment.add_child(nameLabel);
  for (const widget of afterName) segment.add_child(widget);

  if (style.attention !== undefined) {
    applyStatusAttentionClass(segment, afterName[0] ?? nameLabel, style.attention);
  }
  return segment;
}
