// TradingView's shaded band between an oscillator's upper and lower levels (RSI's 70 to 30, in
// purple), across the whole pane and behind the lines. RSI also fades green above 70 and red below
// 30: the area between the RSI line and 50, coloured only where it's beyond the band.
const GREEN = "76, 175, 80",
  RED = "242, 54, 69";

export class BandFill {
  constructor(pane, band, values) {
    this.pane = pane;
    this.band = band;
    this.values = values;
    this._view = {
      zOrder: () => "bottom",
      renderer: () => ({
        draw: (target) => target.useMediaCoordinateSpace(({ context, mediaSize }) => this.draw(context, mediaSize)),
      }),
    };
  }
  attached({ series }) {
    this.series = series;
  }
  detached() {
    this.series = null;
  }
  updateAllViews() {}
  paneViews() {
    return [this._view];
  }

  draw(ctx, size) {
    const s = this.series;
    if (!s) return;
    const { hi, lo, color, gradient } = this.band;
    const yh = s.priceToCoordinate(hi),
      yl = s.priceToCoordinate(lo);
    if (yh == null || yl == null) return;
    ctx.fillStyle = color;
    ctx.fillRect(0, Math.min(yh, yl), size.width, Math.abs(yl - yh));
    if (gradient) this.gradient(ctx, yh, yl);
  }

  gradient(ctx, yh, yl) {
    const s = this.series,
      v = this.values,
      ts = this.pane.chart.timeScale(),
      r = ts.getVisibleLogicalRange();
    const ym = s.priceToCoordinate((this.band.hi + this.band.lo) / 2),
      yTop = s.priceToCoordinate(100),
      yBot = s.priceToCoordinate(0);
    if (!r || !v?.length || ym == null || yTop == null || yBot == null || yBot === yTop) return;
    const at = (y) => Math.max(0, Math.min(1, (y - yTop) / (yBot - yTop)));
    const g = ctx.createLinearGradient(0, yTop, 0, yBot);
    g.addColorStop(0, `rgba(${GREEN}, 1)`);
    g.addColorStop(at(yh), `rgba(${GREEN}, 0)`);
    g.addColorStop(at(yl), `rgba(${RED}, 0)`);
    g.addColorStop(1, `rgba(${RED}, 1)`);
    const a = Math.max(0, Math.floor(r.from) - 1),
      b = Math.min(v.length - 1, Math.ceil(r.to) + 1);
    ctx.beginPath();
    let open = false,
      x0 = 0,
      x1 = 0;
    const end = () => {
      if (!open) return;
      ctx.lineTo(x1, ym);
      ctx.lineTo(x0, ym);
      ctx.closePath();
      open = false;
    };
    // the warm-up bars (no value yet) are gaps
    for (let i = a; i <= b; i++) {
      const x = ts.logicalToCoordinate(i),
        y = Number.isFinite(v[i]) ? s.priceToCoordinate(v[i]) : null;
      if (x == null || y == null) {
        end();
        continue;
      }
      if (!open) {
        ctx.moveTo(x, ym);
        ctx.lineTo(x, y);
        x0 = x;
        open = true;
      } else ctx.lineTo(x, y);
      x1 = x;
    }
    end();
    ctx.fillStyle = g;
    ctx.fill();
  }
}
