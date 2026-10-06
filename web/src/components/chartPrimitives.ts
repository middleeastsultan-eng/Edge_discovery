// A custom pane primitive (lightweight-charts' plugin API) that paints a translucent
// vertical band across the FULL height of a pane at a given set of bar times --
// independent of any one series' price scale, since a structure-divergence event isn't
// "at a price," it's "at a time." Attached directly to a pane via pane.attachPrimitive(),
// not a series, so it draws correctly regardless of which series (or how many) share
// that pane.
import type { IChartApi, IPanePrimitive, UTCTimestamp } from "lightweight-charts";

export class DivergenceBandPrimitive implements IPanePrimitive<UTCTimestamp> {
  private _chart: IChartApi;
  private _getTimes: () => number[];
  private _getColor: () => string;
  private _getBarSpacing: () => number;

  constructor(chart: IChartApi, getTimes: () => number[], getColor: () => string, getBarSpacing: () => number) {
    this._chart = chart;
    this._getTimes = getTimes;
    this._getColor = getColor;
    this._getBarSpacing = getBarSpacing;
  }

  updateAllViews(): void {}

  paneViews() {
    const chart = this._chart;
    const getTimes = this._getTimes;
    const getColor = this._getColor;
    const getBarSpacing = this._getBarSpacing;
    return [
      {
        renderer: () => ({
          draw: () => {},
          drawBackground: (target: import("fancy-canvas").CanvasRenderingTarget2D) => {
            target.useMediaCoordinateSpace(({ context, mediaSize }) => {
              const timeScale = chart.timeScale();
              const color = getColor();
              const halfWidth = Math.max(getBarSpacing(), 2) / 2;
              for (const t of getTimes()) {
                const x = timeScale.timeToCoordinate(t as UTCTimestamp);
                if (x === null) continue;
                context.fillStyle = color;
                context.fillRect(x - halfWidth, 0, halfWidth * 2, mediaSize.height);
              }
            });
          },
        }),
      },
    ];
  }
}
