// The empty part of an indicator's pane before its data starts (XRPL On chain: the bars before the
// collector's first ledger), with a short note on why, centred in that part. It moves with the chart;
// where the empty part is too narrow for the first line, it says nothing.
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export class EmptyNote {
  // first: the bar index where the data starts; lines: the note, most important first
  constructor(pane, first, lines) {
    this.pane = pane;
    this.first = first;
    this.lines = lines;
    this._view = {
      zOrder: () => "top",
      renderer: () => ({
        draw: (target) => target.useMediaCoordinateSpace(({ context, mediaSize }) => this.draw(context, mediaSize)),
      }),
    };
  }
  attached() {}
  detached() {}
  updateAllViews() {}
  paneViews() {
    return [this._view];
  }

  draw(ctx, size) {
    const ts = this.pane.chart.timeScale(),
      x = ts.logicalToCoordinate(this.first);
    if (x == null) return;
    // up to half a bar before the first one with data, or the whole pane when that's off to the right
    const right = Math.min(size.width, x - ts.options().barSpacing / 2),
      room = right - 24;
    if (room < 120) return;
    const fonts = [`13px ${FONT}`, `12px ${FONT}`];
    const shown = [];
    for (const [k, text] of this.lines.entries()) {
      ctx.font = fonts[Math.min(k, fonts.length - 1)];
      if (ctx.measureText(text).width > room) break;
      shown.push(k);
    }
    if (!shown.length) return;
    const muted = getComputedStyle(document.documentElement).getPropertyValue("--muted").trim() || "#787b86";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const gap = 18,
      top = size.height / 2 - ((shown.length - 1) * gap) / 2;
    for (const k of shown) {
      ctx.font = fonts[Math.min(k, fonts.length - 1)];
      ctx.fillStyle = muted;
      ctx.globalAlpha = k ? 0.75 : 1;
      ctx.fillText(this.lines[k], right / 2, top + k * gap);
    }
    ctx.globalAlpha = 1;
  }
}
