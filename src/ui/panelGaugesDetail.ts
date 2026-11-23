import Clutter from "gi://Clutter";
import St from "gi://St";
import type * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import { gettext as _ } from "../helpers/gettext.js";
import { connectRepaint, drawRadialGauge } from "./cairoDrawing.js";
import { chunkGauges, chunkPairs, computeGaugeGeometry } from "./cockpitModel.js";
import type { DisplayCallout, ProviderDisplayModel } from "./displayModel.js";
import { createErrorLabel } from "./errorLabel.js";
import type { FieldView } from "./fieldViews.js";
import type { RadialGaugeGeometry } from "./gaugeTypes.js";
import type { PanelShell } from "./panelShell.js";
import { resetSlotText } from "./resetModel.js";
import { applyToneClass } from "./tone.js";

const RADIAL_GAUGE_SIZE = 80;

export interface DetailHost {
  readonly shell: PanelShell;
  readonly t: (message: string) => string;
}

interface DetailRenderContext {
  readonly model: ProviderDisplayModel;
  readonly locale: string;
}

/** A FieldView plus only the geometry and reset text a radial gauge needs. */
interface GaugeRenderItem {
  readonly view: FieldView;
  readonly geometry: RadialGaugeGeometry;
  readonly resetText: string | null;
}

interface DetailRenderPlan {
  readonly callout: DisplayCallout | null;
  readonly isError: boolean;
  readonly gaugeRows: readonly (readonly GaugeRenderItem[])[];
  readonly gaugeCount: number;
  readonly bentoRows: readonly (readonly FieldView[])[];
  readonly bentoCount: number;
  readonly lastUpdatedText: string | null;
}

/** Rebuilds radial gauges, bento tiles and callouts from the canonical model facts. */
export class DetailRenderer {
  private readonly _host: DetailHost;

  constructor(host: DetailHost) {
    this._host = host;
  }

  render(context: DetailRenderContext): void {
    this._build(this._derivePlan(context));
  }

  private _derivePlan(context: DetailRenderContext): DetailRenderPlan {
    const { model, locale } = context;
    const facts = model.facts;
    const isError = facts.isHardError;

    const gauges: GaugeRenderItem[] = isError
      ? []
      : facts.views.progress.map((view) => {
          const pairing = model.resets.get(view.name);
          const resetText = pairing ? resetSlotText(pairing, "panel", locale, this._host.t) : null;
          return { view, geometry: computeGaugeGeometry(view), resetText };
        });
    const bentoViews = isError ? [] : facts.views.keyValue;

    return {
      callout: facts.callout,
      isError,
      gaugeRows: chunkGauges(gauges),
      gaugeCount: gauges.length,
      bentoRows: chunkPairs(bentoViews),
      bentoCount: bentoViews.length,
      lastUpdatedText: facts.lastUpdatedText,
    };
  }

  private _addRow(styleClass: string | null): PopupMenu.PopupBaseMenuItem {
    const row = this._host.shell.addStaticRow();
    if (styleClass) row.add_style_class_name(styleClass);
    return row;
  }

  private _build(plan: DetailRenderPlan): void {
    const { callout, isError, gaugeRows, gaugeCount, bentoRows, bentoCount, lastUpdatedText } =
      plan;

    if (callout !== null) {
      const row = this._addRow(null);
      const box = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        style_class:
          callout.kind === "error"
            ? "pl-callout pl-callout-error"
            : "pl-callout pl-callout-warning",
      });

      const calloutBadge = new St.Label({
        text: callout.badge,
        style_class:
          callout.kind === "error" ? "pl-badge pl-badge-error" : "pl-badge pl-badge-cached",
        x_align: Clutter.ActorAlign.START,
      });

      const calloutText = new St.Label({
        text: callout.text,
        style_class: callout.kind === "error" ? "provider-limits-error" : "provider-limits-dim",
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
      });
      calloutText.clutter_text.line_wrap = true;
      calloutText.accessible_name = `${callout.badge}: ${callout.text}`;

      box.add_child(calloutBadge);
      box.add_child(calloutText);
      row.add_child(box);
      this._host.shell.addBodyItem(row);
    }

    if (!isError) {
      for (const gaugeRow of gaugeRows) {
        const row = this._addRow("pl-gauge-row-item");
        const rowBox = new St.BoxLayout({ style_class: "pl-gauge-row", x_expand: true });

        for (const gauge of gaugeRow) {
          rowBox.add_child(this._buildGaugeCard(gauge));
        }

        row.add_child(rowBox);
        this._host.shell.addBodyItem(row);
      }

      for (const bentoRow of bentoRows) {
        const row = this._addRow("pl-bento-row-item");
        const rowBox = new St.BoxLayout({ style_class: "pl-bento-row", x_expand: true });

        for (const view of bentoRow) {
          rowBox.add_child(this._buildBentoTile(view));
        }

        row.add_child(rowBox);
        this._host.shell.addBodyItem(row);
      }

      if (gaugeCount === 0 && bentoCount === 0) {
        const emptyRow = this._host.shell.addStaticRow();
        const emptyLabel = new St.Label({
          text: _("No panel fields configured for this provider."),
          style_class: "provider-limits-dim pl-empty-fields",
          x_expand: true,
          x_align: Clutter.ActorAlign.CENTER,
        });
        emptyLabel.clutter_text.line_wrap = true;
        emptyRow.add_child(emptyLabel);
        this._host.shell.addBodyItem(emptyRow);
      }
    }

    if (lastUpdatedText !== null) {
      const row = this._host.shell.addStaticRow();
      const lastUpdatedLabel = new St.Label({
        text: lastUpdatedText,
        style_class: "provider-limits-dim pl-provider-updated",
        x_expand: true,
        x_align: Clutter.ActorAlign.END,
      });
      lastUpdatedLabel.accessible_name = lastUpdatedText;
      row.add_child(lastUpdatedLabel);
      this._host.shell.addBodyItem(row);
    }
  }

  private _buildGaugeCard(gauge: GaugeRenderItem): St.BoxLayout {
    const card = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      style_class: "pl-gauge-card",
    });
    const accessibleParts = [`${gauge.view.labelText}: ${gauge.geometry.centerText}`];
    if (gauge.resetText !== null) accessibleParts.push(gauge.resetText);
    card.accessible_name = accessibleParts.join(", ");

    const ringOverlay = new St.Widget({
      layout_manager: new Clutter.BinLayout(),
      x_align: Clutter.ActorAlign.CENTER,
      style_class: "pl-gauge-ring-wrap",
    });

    const drawingArea = new St.DrawingArea({
      style_class: "pl-radial-gauge",
      width: RADIAL_GAUGE_SIZE,
      height: RADIAL_GAUGE_SIZE,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });

    const valueLabel = new St.Label({
      text: gauge.geometry.centerText,
      style_class: "pl-gauge-center-value",
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
      x_expand: true,
      y_expand: true,
    });
    applyToneClass(valueLabel, gauge.geometry.fieldTone);

    ringOverlay.add_child(drawingArea);
    ringOverlay.add_child(valueLabel);

    const titleLabel = new St.Label({
      text: gauge.view.labelText,
      style_class: "pl-gauge-label",
      x_align: Clutter.ActorAlign.CENTER,
      x_expand: true,
    });
    titleLabel.clutter_text.line_wrap = true;

    card.add_child(ringOverlay);
    card.add_child(titleLabel);

    if (gauge.resetText !== null) {
      const resetLabel = new St.Label({
        text: gauge.resetText,
        style_class: "provider-limits-dim pl-gauge-reset",
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
      });
      card.add_child(resetLabel);
    }

    if (gauge.view.errorText) {
      const errorLabel = createErrorLabel(
        gauge.view.errorText,
        "provider-limits-error pl-gauge-error",
      );
      errorLabel.x_align = Clutter.ActorAlign.CENTER;
      card.add_child(errorLabel);
    }

    connectRepaint(drawingArea, drawRadialGauge, gauge.geometry);

    return card;
  }

  private _buildBentoTile(view: FieldView): St.BoxLayout {
    const tile = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      style_class: "pl-bento-tile",
    });
    tile.accessible_name = view.accessibleText;

    const caption = new St.Label({
      text: view.labelText,
      style_class: "provider-limits-dim pl-bento-label",
      x_align: Clutter.ActorAlign.START,
      x_expand: true,
    });
    caption.clutter_text.line_wrap = true;

    const valueLabel = new St.Label({
      text: view.valueText,
      style_class: "pl-bento-value",
      x_align: Clutter.ActorAlign.START,
      x_expand: true,
    });
    valueLabel.clutter_text.line_wrap = true;

    tile.add_child(caption);
    tile.add_child(valueLabel);

    if (view.errorText) {
      const errorLabel = createErrorLabel(view.errorText, "provider-limits-error pl-bento-error");
      errorLabel.x_align = Clutter.ActorAlign.START;
      tile.add_child(errorLabel);
    }

    return tile;
  }
}
