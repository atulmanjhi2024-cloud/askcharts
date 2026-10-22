// TradingView's chart type menu: favourite types as icon buttons on the toolbar, and a menu of every
// type in its groups, each with an icon and a star. Also the types the chart library doesn't draw
// itself (Volume candles, HLC area, High-low, and the base of Session volume profile), drawn here
// as a custom series.
import { esc } from "./api.js";

const LW = window.LightweightCharts;

export const TYPE_GROUPS = [
  [["bars", "Bars"], ["candles", "Candles"], ["hollow", "Hollow candles"], ["volcandles", "Volume candles"]],
  [["line", "Line"], ["linemarkers", "Line with markers"], ["step", "Step line"]],
  [["area", "Area"], ["hlcarea", "HLC area"], ["baseline", "Baseline"]],
  [["columns", "Columns"], ["highlow", "High-low"]],
  [["footprint", "Volume footprint"], ["tpo", "Time price opportunity"], ["svp", "Session volume profile"]],
  [["heikin", "Heikin Ashi"], ["renko", "Renko"], ["linebreak", "Line break"], ["kagi", "Kagi"], ["pnf", "Point & figure"], ["range", "Range"]],
];
// Shown, as on TradingView, but greyed: what they need isn't in the free feeds here.
export const UNAVAILABLE = {
  footprint: "Volume footprint needs every trade with its buy or sell side, which the free feeds here don't keep for past bars.",
  tpo: "Time price opportunity isn't built here yet.",
};
// The types drawn by StyleSeries below.
export const CUSTOM_TYPES = ["volcandles", "hlcarea", "highlow", "svp"];

const s = (b) => `<svg viewBox="0 0 28 28">${b}</svg>`;
export const TYPE_ICONS = {
  bars: s('<path d="M9 5v18M6 9h3M9 18h3M19 4v17M16 7h3M19 15h3"/>'),
  candles: s('<path d="M9 4.5v4M9 19.5v4M19 4.5v5M19 18.5v4"/><rect x="6.5" y="8.5" width="5" height="11" rx="1"/><rect x="16.5" y="9.5" width="5" height="9" rx="1" class="f"/>'),
  hollow: s('<path d="M9 4.5v4M9 19.5v4M19 4.5v5M19 18.5v4"/><rect x="6.5" y="8.5" width="5" height="11" rx="1"/><rect x="16.5" y="9.5" width="5" height="9" rx="1"/>'),
  volcandles: s('<path d="M8 5v4M8 19v4M19 4.5v5M19 18.5v4"/><rect x="6.5" y="9" width="3" height="10" rx="0.8"/><rect x="14.5" y="9.5" width="9" height="9" rx="1"/>'),
  line: s('<path d="M4 20.5l6-7.5 5 4 9-11"/>'),
  linemarkers: s('<path d="M4 20.5l6-7.5 5 4 9-11"/><circle cx="10" cy="13" r="1.8" class="f"/><circle cx="15" cy="17" r="1.8" class="f"/><circle cx="24" cy="6" r="1.8" class="f"/>'),
  step: s('<path d="M4 21h5v-7h6v4h5V7h4"/>'),
  area: s('<path d="M4 20l6-7 5 4 9-11"/><path d="M4 23v-3l6-7 5 4 9-11v17z" class="a"/>'),
  hlcarea: s('<path d="M4 15l6-6 5 3 9-7M4 23l6-5 5 3 9-8"/><path d="M4 15l6-6 5 3 9-7v8l-9 8-5-3-6 5z" class="a"/>'),
  baseline: s('<path d="M3 15.5h22" stroke-dasharray="2 2"/><path d="M4 20l6-9 5 8 4-12 5 6"/>'),
  columns: s('<path d="M6 23v-7M11 23v-11M16 23v-5M21 23V7"/>'),
  highlow: s('<rect x="6" y="6" width="5" height="12" rx="1"/><rect x="17" y="10" width="5" height="12" rx="1"/>'),
  footprint: s('<rect x="7.5" y="5" width="13" height="18" rx="1"/><path d="M14 5v18M7.5 10h13M7.5 14h13M7.5 18h13"/>'),
  tpo: s('<path d="M5 7h3M5 11h3M10 11h3M5 15h3M10 15h3M15 15h3M5 19h3M10 19h3M5 23h3"/>'),
  svp: s('<path d="M5 4v20M5 7h8M5 11h14M5 15h18M5 19h11M5 23h6"/>'),
  heikin: s('<path d="M9 4v5M9 19v4M19 5v4M19 17v6"/><rect x="6.5" y="9" width="5" height="10" rx="1"/><rect x="16.5" y="9" width="5" height="8" rx="1" class="f"/>'),
  renko: s('<rect x="4" y="17" width="6" height="6"/><rect x="10" y="11" width="6" height="6"/><rect x="16" y="5" width="6" height="6" class="f"/>'),
  linebreak: s('<rect x="4" y="15" width="5" height="8"/><rect x="11" y="9" width="5" height="9"/><rect x="18" y="4" width="5" height="9" class="f"/>'),
  kagi: s('<path d="M5 22V11h6v6h6V6h6v11"/>'),
  pnf: s('<path d="M5 6l4 4M9 6l-4 4M5 12l4 4M9 12l-4 4"/><circle cx="16" cy="11" r="2.2"/><circle cx="16" cy="17" r="2.2"/><path d="M20 4l4 4M24 4l-4 4"/>'),
  range: s('<path d="M7 23v-6M7 18h-2M7 20h2M13 18v-7M13 12h-2M13 15h2M19 12V5M19 6h-2M19 9h2"/>'),
};
export const TYPE_LABEL = Object.fromEntries(TYPE_GROUPS.flat());
const STAR = '<svg viewBox="0 0 18 18"><path d="M9 2.6l1.9 4 4.3.5-3.2 2.9.9 4.3L9 12.2l-3.9 2.1.9-4.3-3.2-2.9 4.3-.5z"/></svg>';
const CHEVRON = '<svg viewBox="0 0 18 18"><path d="M5 7.5l4 4 4-4"/></svg>';

export class ChartTypeMenu {
  constructor(app) {
    this.app = app;
    this.box = document.querySelector("#chartTypeBox");
    this.box.onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.type) return this.pick(b.dataset.type);
      if (b.dataset.menu) this.open(b);
    };
  }
  favs() {
    return (this.app.settings.chartTypeFavs ||= ["candles"]);
  }
  pick(type) {
    const p = this.app.active;
    if (!p || UNAVAILABLE[type]) return;
    p.cfg.type = type;
    p.render(true);
    this.app.persist();
    this.render();
  }
  // Starred types as icons, the chart's own type beside them when it isn't starred, then the menu.
  render() {
    const cur = this.app.active?.cfg.type || "candles",
      favs = this.favs().filter((t) => TYPE_LABEL[t] && !UNAVAILABLE[t]);
    const list = favs.includes(cur) ? favs : [...favs, cur];
    this.box.innerHTML = `${list.map((t) => `<button data-type="${t}" class="${t === cur ? "active" : ""}" title="${esc(TYPE_LABEL[t] || t)}">${TYPE_ICONS[t] || ""}</button>`).join("")}<button data-menu="1" class="ct-more" title="Chart type">${CHEVRON}</button>`;
  }
  open(btn) {
    const tb = this.app.drawToolbar;
    const pop = tb.openPopover(btn, this.html(), "ct-menu");
    pop.classList.add("ct-menu");
    const r = this.box.getBoundingClientRect();
    pop.style.left = `${Math.max(4, r.left)}px`;
    pop.style.top = `${r.bottom + 4}px`;
    pop.style.maxHeight = `${innerHeight - r.bottom - 12}px`;
    pop.onclick = (e) => {
      const star = e.target.closest("[data-star]")?.dataset.star;
      if (star) {
        const f = this.favs();
        this.app.settings.chartTypeFavs = f.includes(star) ? f.filter((x) => x !== star) : [...f, star];
        this.app.persist();
        this.render();
        pop.innerHTML = this.html();
        return;
      }
      const it = e.target.closest(".ct-item");
      if (!it || it.classList.contains("dis")) return;
      tb.closePopover();
      this.pick(it.dataset.t);
    };
  }
  html() {
    const cur = this.app.active?.cfg.type,
      favs = this.favs();
    return TYPE_GROUPS.map((g) =>
      g
        .map(([t, label]) => {
          const off = UNAVAILABLE[t];
          return `<div class="ct-item${t === cur ? " on" : ""}${off ? " dis" : ""}" data-t="${t}"${off ? ` title="${esc(off)}"` : ""}>${TYPE_ICONS[t]}<span>${esc(label)}</span>${off ? "" : `<button class="ct-star${favs.includes(t) ? " fav" : ""}" data-star="${t}" title="${favs.includes(t) ? "Remove from favorites" : "Add to favorites"}">${STAR}</button>`}</div>`;
        })
        .join(""),
    ).join('<hr class="ct-sep">');
  }
}

// ---------- the custom-drawn types ----------
// One custom series for Volume candles (candle width follows volume), HLC area (high, low and
// close lines with the bands between them filled), High-low (a box from low to high, with the
// values when there's room) and Session volume profile (draws nothing itself; the profiles are a
// primitive on top, this only gives the chart its prices to scale to).
export class StyleSeries {
  constructor(mode, pane) {
    this.mode = mode;
    this.pane = pane;
    this.data = null;
  }
  renderer() {
    return this;
  }
  update(data, options) {
    this.data = data;
    this.options = options;
  }
  priceValueBuilder(d) {
    return [d.low, d.high, d.close];
  }
  isWhitespace(d) {
    return d.close === undefined;
  }
  defaultOptions() {
    return { ...LW.customSeriesDefaultOptions };
  }
  destroy() {}
  draw(target, toY) {
    const d = this.data;
    if (!d?.visibleRange || this.mode === "svp") return;
    target.useMediaCoordinateSpace(({ context }) => {
      if (this.mode === "volcandles") this.volCandles(context, d, toY);
      else if (this.mode === "hlcarea") this.hlcArea(context, d, toY);
      else if (this.mode === "highlow") this.highLow(context, d, toY);
    });
  }
  volCandles(ctx, d, toY) {
    const cs = this.pane.cs,
      { from, to } = d.visibleRange;
    let maxVol = 0;
    for (let i = from; i < to; i++) maxVol = Math.max(maxVol, d.bars[i]?.originalData.volume || 0);
    const full = Math.max(1, d.barSpacing * 0.9);
    for (let i = from; i < to; i++) {
      const bar = d.bars[i],
        b = bar.originalData,
        prev = d.bars[i - 1]?.originalData;
      const up = cs.prevClose && prev ? b.close >= prev.close : b.close >= b.open;
      const w = maxVol > 0 ? Math.max(1, full * Math.sqrt((b.volume || 0) / maxVol)) : Math.max(1, full * 0.6);
      const yo = toY(b.open),
        yc = toY(b.close),
        yh = toY(b.high),
        yl = toY(b.low);
      if (yo == null || yc == null || yh == null || yl == null) continue;
      const x = Math.round(bar.x) + 0.5;
      if (cs.wick) {
        ctx.strokeStyle = up ? cs.wickUp : cs.wickDown;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, yh);
        ctx.lineTo(x, yl);
        ctx.stroke();
      }
      const top = Math.min(yo, yc),
        h = Math.max(1, Math.abs(yc - yo));
      ctx.fillStyle = cs.body ? (up ? cs.bodyUp : cs.bodyDown) : cs.bg || getComputedStyle(document.documentElement).getPropertyValue("--bg");
      ctx.fillRect(bar.x - w / 2, top, w, h);
      if (cs.borders) {
        ctx.strokeStyle = up ? cs.borderUp : cs.borderDown;
        ctx.strokeRect(Math.round(bar.x - w / 2) + 0.5, Math.round(top) + 0.5, Math.max(0, Math.round(w) - 1), Math.max(0, Math.round(h) - 1));
      }
    }
  }
  hlcArea(ctx, d, toY) {
    const cs = this.pane.cs,
      a = Math.max(0, d.visibleRange.from - 1),
      z = Math.min(d.bars.length, d.visibleRange.to + 1);
    const pts = [];
    for (let i = a; i < z; i++) {
      const b = d.bars[i].originalData,
        h = toY(b.high),
        l = toY(b.low),
        c = toY(b.close);
      if (h != null && l != null && c != null) pts.push({ x: d.bars[i].x, h, l, c });
    }
    if (pts.length < 2) return;
    const band = (top, bottom, color) => {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p[top]) : ctx.moveTo(p.x, p[top])));
      for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i].x, pts[i][bottom]);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    };
    band("h", "c", cs.hlcUpFill);
    band("c", "l", cs.hlcDownFill);
    const line = (k, color, width) => {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p[k]) : ctx.moveTo(p.x, p[k])));
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = "round";
      ctx.stroke();
    };
    line("h", cs.hlcHigh, 1);
    line("l", cs.hlcLow, 1);
    line("c", cs.hlcClose, 2);
  }
  highLow(ctx, d, toY) {
    const cs = this.pane.cs,
      { from, to } = d.visibleRange,
      w = Math.max(1, d.barSpacing * 0.7),
      labels = cs.hiloLabels && d.barSpacing >= 34;
    ctx.font = "10px -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textAlign = "center";
    for (let i = from; i < to; i++) {
      const bar = d.bars[i],
        b = bar.originalData,
        yh = toY(b.high),
        yl = toY(b.low);
      if (yh == null || yl == null) continue;
      ctx.fillStyle = cs.hiloColor;
      ctx.globalAlpha = cs.hiloBorders ? 0.6 : 1;
      ctx.fillRect(bar.x - w / 2, yh, w, Math.max(1, yl - yh));
      ctx.globalAlpha = 1;
      if (cs.hiloBorders) {
        ctx.strokeStyle = cs.hiloColor;
        ctx.strokeRect(Math.round(bar.x - w / 2) + 0.5, Math.round(yh) + 0.5, Math.max(0, Math.round(w) - 1), Math.max(0, Math.round(yl - yh) - 1));
      }
      if (labels) {
        ctx.fillStyle = cs.hiloColor;
        ctx.textBaseline = "bottom";
        ctx.fillText(this.pane.formatPrice(b.high), bar.x, yh - 2);
        ctx.textBaseline = "top";
        ctx.fillText(this.pane.formatPrice(b.low), bar.x, yl + 2);
      }
    }
  }
}
