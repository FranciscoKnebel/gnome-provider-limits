import Clutter from "gi://Clutter";
import St from "gi://St";
import type * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import { gettext as _ } from "../helpers/gettext.js";
import { connectRepaint, drawRadialGauge } from "./cairoDrawing.js";
import { partitionProviderPanel } from "./cockpitModel.js";
import type { BentoTileItem, PartitionedProviderPanel, RadialGaugeItem } from "./cockpitModel.js";
import type { DisplayCallout, ProviderDisplayModel } from "./displayModel.js";
import type { PanelShell } from "./panelShell.js";
import { applyToneClass } from "./tone.js";

const RADIAL_GAUGE_SIZE = 80;

export interface DetailHost {
  readonly shell: PanelShell;
  readonly translate: (message: string) => string;
}

interface DetailRenderContext {
  readonly model: ProviderDisplayModel;
  readonly locale: string;
}

interface DetailRenderPlan {
  readonly callout: DisplayCallout | null;
  readonly isError: boolean;
  readonly partition: PartitionedProviderPanel;
  readonly lastUpdatedText: string | null;
}

/** Rebuilds radial gauges, bento tiles and callouts from one freshly derived plan. */
export class DetailRenderer {
  private readonly _host: DetailHost;

  constructor(host: DetailHost) {
    this._host = host;
  }

  render(context: DetailRenderContext): void {
    const plan = this._derivePlan(context);
    this._build(plan);
  }

  private _derivePlan(context: DetailRenderContext): DetailRenderPlan {
    const { model, locale } = context;
    const facts = model.facts;
    const isError = facts.isHardError;

    const partition: PartitionedProviderPanel = isError
      ? { gauges: [], gaugeRows: [], bentoTiles: [], bentoRows: [] }
      : partitionProviderPanel(model, locale, this._host.translate);

    return {
      callout: facts.callout,
      isError,
      partition,
      lastUpdatedText: facts.lastUpdatedText,
    };
  }

  private _addRow(styleClass: string | null): PopupMenu.PopupBaseMenuItem {
    const row = this._host.shell.addStaticRow();
    if (styleClass) row.add_style_class_name(styleClass);
    return row;
  }

  private _build(plan: DetailRenderPlan): void {
    const { callout, isError, partition, lastUpdatedText } = plan;

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
      for (const gaugeRow of partition.gaugeRows) {
        const row = this._addRow("pl-gauge-row-item");
        const rowBox = new St.BoxLayout({ style_class: "pl-gauge-row", x_expand: true });

        for (const gauge of gaugeRow) {
          rowBox.add_child(this._buildGaugeCard(gauge));
        }

        row.add_child(rowBox);
        this._host.shell.addBodyItem(row);
      }

      for (const bentoRow of partition.bentoRows) {
        const row = this._addRow("pl-bento-row-item");
        const rowBox = new St.BoxLayout({ style_class: "pl-bento-row", x_expand: true });

        for (const tile of bentoRow) {
          rowBox.add_child(this._buildBentoTile(tile));
        }

        row.add_child(rowBox);
        this._host.shell.addBodyItem(row);
      }

      if (partition.gauges.length === 0 && partition.bentoTiles.length === 0) {
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

  private _buildGaugeCard(gauge: RadialGaugeItem): St.BoxLayout {
    const card = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      style_class: "pl-gauge-card",
    });
    card.accessible_name = gauge.accessibleText;

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
      text: gauge.translatedLabel,
      style_class: "pl-gauge-label",
      x_align: Clutter.ActorAlign.CENTER,
      x_expand: true,
    });
    titleLabel.clutter_text.line_wrap = true;

    card.add_child(ringOverlay);
    card.add_child(titleLabel);

    if (gauge.hasResetSlot && gauge.resetText !== null) {
      const resetLabel = new St.Label({
        text: gauge.resetText,
        style_class: "provider-limits-dim pl-gauge-reset",
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
      });
      card.add_child(resetLabel);
    }

    if (gauge.errorText) {
      const errorLabel = new St.Label({
        text: gauge.errorText,
        style_class: "provider-limits-error pl-gauge-error",
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
      });
      errorLabel.clutter_text.line_wrap = true;
      card.add_child(errorLabel);
    }

    connectRepaint(drawingArea, drawRadialGauge, gauge.geometry);

    return card;
  }

  private _buildBentoTile(tileData: BentoTileItem): St.BoxLayout {
    const tile = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      style_class: "pl-bento-tile",
    });
    tile.accessible_name = tileData.accessibleText;

    const caption = new St.Label({
      text: tileData.translatedLabel,
      style_class: "provider-limits-dim pl-bento-label",
      x_align: Clutter.ActorAlign.START,
      x_expand: true,
    });
    caption.clutter_text.line_wrap = true;

    const valueLabel = new St.Label({
      text: tileData.valueText,
      style_class: "pl-bento-value",
      x_align: Clutter.ActorAlign.START,
      x_expand: true,
    });
    valueLabel.clutter_text.line_wrap = true;

    tile.add_child(caption);
    tile.add_child(valueLabel);

    if (tileData.errorText) {
      const errorLabel = new St.Label({
        text: tileData.errorText,
        style_class: "provider-limits-error pl-bento-error",
        x_align: Clutter.ActorAlign.START,
        x_expand: true,
      });
      errorLabel.clutter_text.line_wrap = true;
      tile.add_child(errorLabel);
    }

    return tile;
  }
}
