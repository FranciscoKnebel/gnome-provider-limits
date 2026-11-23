import Clutter from "gi://Clutter";
import type Gio from "gi://Gio";
import St from "gi://St";
import type * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import type { ProviderName } from "../constants.js";
import { formatAbsoluteTimestamp } from "../formatters.js";
import { gettext as _ } from "../helpers/gettext.js";
import { providerDisplayName } from "../helpers/provider-settings.js";
import type { FieldDef, ReaderResult } from "../readers/base.js";
import { ReaderStatus } from "../readers/base.js";
import { disposeCairoContext, drawRadialGauge, isCairoContext } from "./cairoDrawing.js";
import { partitionProviderPanel, providerDetailStructureKey } from "./cockpitModel.js";
import type { BentoTileItem, PartitionedProviderPanel, RadialGaugeItem } from "./cockpitModel.js";
import type { GaugeGeometry } from "./gaugeTypes.js";
import type { PanelShell } from "./panelShell.js";
import { applyToneClass } from "./tone.js";

const RADIAL_GAUGE_SIZE = 80;

interface GaugeCardWidgets {
  geometry: GaugeGeometry;
  drawingArea: St.DrawingArea;
  valueLabel: St.Label;
  titleLabel: St.Label;
  resetLabel: St.Label | null;
  errorLabel: St.Label | null;
  card: St.BoxLayout;
}

interface BentoTileWidgets {
  valueLabel: St.Label;
  errorLabel: St.Label | null;
  tile: St.BoxLayout;
}

interface DetailViewWidgets {
  calloutBadge: St.Label | null;
  calloutText: St.Label | null;
  gauges: GaugeCardWidgets[];
  bentoTiles: BentoTileWidgets[];
  lastUpdatedLabel: St.Label | null;
}

interface CalloutPlan {
  kind: "warning" | "error";
  badge: string;
  text: string;
}

export interface DetailHost {
  readonly settings: Gio.Settings;
  readonly fieldDefs: Readonly<Record<ProviderName, readonly FieldDef[]>>;
  readonly shell: PanelShell;
  readonly translate: (message: string) => string;
}

/** Radial gauges, bento tiles and callouts for the gauges panel detail view. */
export class DetailRenderer {
  private readonly _host: DetailHost;
  private _widgets: DetailViewWidgets | null = null;
  private _structureKey: string | null = null;

  constructor(host: DetailHost) {
    this._host = host;
  }

  reset(): void {
    this._structureKey = null;
    this._widgets = null;
  }

  render(provider: ProviderName, result: ReaderResult, locale: string): void {
    const displayName = providerDisplayName(this._host.settings, provider);
    const fieldsDefs = this._host.fieldDefs[provider];
    const isError =
      result.status === ReaderStatus.ERROR || result.status === ReaderStatus.UNAVAILABLE;

    let callout: CalloutPlan | null = null;
    if (isError) {
      callout = {
        kind: "error",
        badge: _("Error"),
        text: result.lastError ?? _("Error"),
      };
    } else if (result.status === ReaderStatus.PARTIAL && result.lastError) {
      callout = {
        kind: "warning",
        badge: result.pathsTried?.includes("last-known-good") ? _("Cached") : _("Partial"),
        text: result.lastError,
      };
    }

    const partition: PartitionedProviderPanel = isError
      ? { gauges: [], gaugeRows: [], bentoTiles: [], bentoRows: [] }
      : partitionProviderPanel(
          fieldsDefs,
          result,
          this._host.settings.get_strv(`${provider}-panel-fields`),
          locale,
          this._host.translate,
        );

    const lastUpdatedText =
      !isError && Number.isFinite(result.lastUpdated)
        ? formatAbsoluteTimestamp(result.lastUpdated, locale)
        : null;

    const nextKey = providerDetailStructureKey({
      provider,
      displayName,
      status: result.status,
      locale,
      hasCallout: callout !== null,
      hasTimestamp: lastUpdatedText !== null,
      partition,
    });

    if (nextKey !== this._structureKey) {
      this._rebuild(callout, isError, partition, lastUpdatedText);
      this._structureKey = nextKey;
      return;
    }

    this._update(callout, partition, lastUpdatedText);
  }

  private _addRow(styleClass: string | null): PopupMenu.PopupBaseMenuItem {
    const row = this._host.shell.addStaticRow();
    if (styleClass) row.add_style_class_name(styleClass);
    return row;
  }

  private _rebuild(
    callout: CalloutPlan | null,
    isError: boolean,
    partition: PartitionedProviderPanel,
    lastUpdatedText: string | null,
  ): void {
    this._host.shell.clearBody();

    let calloutBadge: St.Label | null = null;
    let calloutText: St.Label | null = null;

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

      calloutBadge = new St.Label({
        text: callout.badge,
        style_class:
          callout.kind === "error" ? "pl-badge pl-badge-error" : "pl-badge pl-badge-cached",
        x_align: Clutter.ActorAlign.START,
      });

      calloutText = new St.Label({
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

    const gauges: GaugeCardWidgets[] = [];
    const bentoTiles: BentoTileWidgets[] = [];

    if (!isError) {
      for (const gaugeRow of partition.gaugeRows) {
        const row = this._addRow("pl-gauge-row-item");
        const rowBox = new St.BoxLayout({ style_class: "pl-gauge-row", x_expand: true });

        for (const gauge of gaugeRow) {
          const cardWidgets = this._buildGaugeCard(gauge);
          rowBox.add_child(cardWidgets.card);
          gauges.push(cardWidgets);
        }

        row.add_child(rowBox);
        this._host.shell.addBodyItem(row);
      }

      for (const bentoRow of partition.bentoRows) {
        const row = this._addRow("pl-bento-row-item");
        const rowBox = new St.BoxLayout({ style_class: "pl-bento-row", x_expand: true });

        for (const tile of bentoRow) {
          const tileWidgets = this._buildBentoTile(tile);
          rowBox.add_child(tileWidgets.tile);
          bentoTiles.push(tileWidgets);
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

    let lastUpdatedLabel: St.Label | null = null;
    if (lastUpdatedText !== null) {
      const row = this._host.shell.addStaticRow();
      const text = _("Last updated: %s").replace("%s", lastUpdatedText);
      lastUpdatedLabel = new St.Label({
        text,
        style_class: "provider-limits-dim pl-provider-updated",
        x_expand: true,
        x_align: Clutter.ActorAlign.END,
      });
      lastUpdatedLabel.accessible_name = text;
      row.add_child(lastUpdatedLabel);
      this._host.shell.addBodyItem(row);
    }

    this._widgets = { calloutBadge, calloutText, gauges, bentoTiles, lastUpdatedLabel };
  }

  private _buildGaugeCard(gauge: RadialGaugeItem): GaugeCardWidgets {
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

    let resetLabel: St.Label | null = null;
    if (gauge.hasResetSlot && gauge.resetText !== null) {
      resetLabel = new St.Label({
        text: gauge.resetText,
        style_class: "provider-limits-dim pl-gauge-reset",
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
      });
      card.add_child(resetLabel);
    }

    let errorLabel: St.Label | null = null;
    if (gauge.errorText) {
      errorLabel = new St.Label({
        text: gauge.errorText,
        style_class: "provider-limits-error pl-gauge-error",
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
      });
      errorLabel.clutter_text.line_wrap = true;
      card.add_child(errorLabel);
    }

    const widgets: GaugeCardWidgets = {
      geometry: gauge.geometry,
      drawingArea,
      valueLabel,
      titleLabel,
      resetLabel,
      errorLabel,
      card,
    };

    drawingArea.connect("repaint", (area: St.DrawingArea) => {
      const rawCr: unknown = area.get_context();
      try {
        if (isCairoContext(rawCr)) {
          const [w, h] = area.get_surface_size();
          drawRadialGauge(rawCr, w, h, widgets.geometry);
        }
      } finally {
        disposeCairoContext(rawCr);
      }
    });
    drawingArea.queue_repaint();

    return widgets;
  }

  private _buildBentoTile(tileData: BentoTileItem): BentoTileWidgets {
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

    let errorLabel: St.Label | null = null;
    if (tileData.errorText) {
      errorLabel = new St.Label({
        text: tileData.errorText,
        style_class: "provider-limits-error pl-bento-error",
        x_align: Clutter.ActorAlign.START,
        x_expand: true,
      });
      errorLabel.clutter_text.line_wrap = true;
      tile.add_child(errorLabel);
    }

    return { valueLabel, errorLabel, tile };
  }

  private _update(
    callout: CalloutPlan | null,
    partition: PartitionedProviderPanel,
    lastUpdatedText: string | null,
  ): void {
    const widgets = this._widgets;
    if (!widgets) return;

    if (callout !== null && widgets.calloutBadge && widgets.calloutText) {
      widgets.calloutBadge.text = callout.badge;
      widgets.calloutText.text = callout.text;
      widgets.calloutText.accessible_name = `${callout.badge}: ${callout.text}`;
    }

    partition.gauges.forEach((gauge, idx) => {
      const cardWidgets = widgets.gauges[idx];
      if (!cardWidgets) return;
      cardWidgets.geometry = gauge.geometry;
      cardWidgets.drawingArea.queue_repaint();
      cardWidgets.valueLabel.text = gauge.geometry.centerText;
      applyToneClass(cardWidgets.valueLabel, gauge.geometry.fieldTone);
      cardWidgets.titleLabel.text = gauge.translatedLabel;
      cardWidgets.card.accessible_name = gauge.accessibleText;
      if (cardWidgets.resetLabel && gauge.resetText !== null) {
        cardWidgets.resetLabel.text = gauge.resetText;
      }
      if (cardWidgets.errorLabel && gauge.errorText) {
        cardWidgets.errorLabel.text = gauge.errorText;
      }
    });

    partition.bentoTiles.forEach((tileData, idx) => {
      const tileWidgets = widgets.bentoTiles[idx];
      if (!tileWidgets) return;
      tileWidgets.valueLabel.text = tileData.valueText;
      tileWidgets.tile.accessible_name = tileData.accessibleText;
      if (tileWidgets.errorLabel && tileData.errorText) {
        tileWidgets.errorLabel.text = tileData.errorText;
      }
    });

    if (widgets.lastUpdatedLabel && lastUpdatedText !== null) {
      const text = _("Last updated: %s").replace("%s", lastUpdatedText);
      widgets.lastUpdatedLabel.text = text;
      widgets.lastUpdatedLabel.accessible_name = text;
    }
  }
}
