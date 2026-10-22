// What TradingView draws over a chart besides candles, indicators and drawings, each one switched
// from the chart Settings dialog: buy and sell buttons, the currency label, the A and L scale
// buttons, the + on the price scale, navigation and pane buttons, the countdown to bar close,
// high/low and bid/ask lines, paper positions and orders, alert lines, economic events and news.
import { api, esc, ticker, exchange, fmtNum } from "./api.js";
import { parseTf } from "../lib/series.js";
import { LINE_STYLE, colorOf, quoteCurrency, tzOffset, fmtDate, fmtClock } from "./chartsettings.js";

const LW = window.LightweightCharts;
const CRYPTO = ["BINANCE", "COINBASE", "KRAKEN"];
const PRICE_FIELDS = ["close", "open", "high", "low", "hl2", "hlc3", "ohlc4", "hlcc4", "price"];
const BUY = "#2962ff",
  SELL = "#f23645",
  PROFIT = "#089981";
const svg = (b) => `<svg viewBox="0 0 18 18">${b}</svg>`;
const NAV = [
  ["out", "Zoom out", svg('<path d="M4 9h10"/>')],
  ["in", "Zoom in", svg('<path d="M4 9h10M9 4v10"/>')],
  ["left", "Scroll to the left", svg('<path d="M11 4L6 9l5 5"/>')],
  ["right", "Scroll to the right", svg('<path d="M7 4l5 5-5 5"/>')],
  ["reset", "Reset chart view", svg('<path d="M4.6 9.5a4.5 4.5 0 1 0 1.5-4.1M5.5 2.8v3h3"/>')],
];
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || "");
// TradingView's pane buttons, in its order; each shows only where it applies. The last field is
// the shortcut shown in the tooltip ("mod" is Cmd on a Mac, Ctrl elsewhere).
const PANE_KEYS = { collapse: "mod+Double click", max: "Double click" };
const PANE_BTNS = [
  ["up", "Move pane up", svg('<path d="M9 14.5v-11M4.5 8L9 3.5 13.5 8"/>')],
  ["down", "Move pane down", svg('<path d="M9 3.5v11M4.5 10L9 14.5l4.5-4.5"/>')],
  ["remove", "Delete pane", svg('<path d="M3.5 5h11M7.2 5V3.4h3.6V5M5 5l.8 9.6h6.4L13 5M7.5 7.5v4.5M10.5 7.5v4.5"/>')],
  ["collapse", "Collapse pane", svg('<path d="M5 3.5l4 3.5 4-3.5M5 14.5l4-3.5 4 3.5"/>'), "Expand pane", svg('<path d="M5 7.5l4-4 4 4M5 10.5l4 4 4-4"/>')],
  ["max", "Maximize pane", svg('<path d="M3.5 7V4.8c0-.7.6-1.3 1.3-1.3H7M11 3.5h2.2c.7 0 1.3.6 1.3 1.3V7M14.5 11v2.2c0 .7-.6 1.3-1.3 1.3H11M7 14.5H4.8c-.7 0-1.3-.6-1.3-1.3V11"/>'), "Restore pane", svg('<path d="M7 3.5v2.2c0 .7-.6 1.3-1.3 1.3H3.5M14.5 7h-2.2c-.7 0-1.3-.6-1.3-1.3V3.5M11 14.5v-2.2c0-.7.6-1.3 1.3-1.3h2.2M3.5 11h2.2c.7 0 1.3.6 1.3 1.3v2.2"/>')],
];
const ICON_REVERSE = svg('<path d="M6 3v12M3 6l3-3 3 3M12 15V3M9 12l3 3 3-3"/>');
const ICON_X = svg('<path d="M5 5l8 8M13 5l-8 8"/>');
const BOLT = new Path2D("M1.2-4.6L-2.6 0.8h2.4l-0.9 3.8 3.8-5.4h-2.4z");

// One request per symbol however many charts show it.
const cache = { spread: new Map(), news: new Map(), cal: new Map() };
// The latest bid and ask per symbol, shared by every chart showing it.
const quotes = new Map();
function cached(map, key, ttl, load) {
  const c = map.get(key);
  if (c && Date.now() - c.at < ttl) return c.promise;
  const promise = load().catch(() => null);
  map.set(key, { at: Date.now(), promise });
  return promise;
}
const spreadOf = (sym) => cached(cache.spread, sym, 4000, () => api.get(`/api/spread?symbol=${encodeURIComponent(sym)}`));
const newsOf = (sym, ttl = 300000) => cached(cache.news, sym, ttl, () => api.get(`/api/news?symbol=${encodeURIComponent(sym)}`).then((r) => r.items || []));
const calendar = () => cached(cache.cal, "all", 1800000, () => api.get("/api/calendar"));
const isCrypto = (sym) => CRYPTO.includes(exchange(sym));
// The price scale's currency menu: the list comes from the server once per session.
let currencyList = null;
const STAR_SVG = '<svg viewBox="0 0 18 18"><path d="M9 1.8l2.2 4.6 5 .7-3.6 3.5.9 5L9 13.2l-4.5 2.4.9-5L1.8 7.1l5-.7z"/></svg>';
// A flag for a currency (its first two letters are the country, EU for the euro), a lettered disc for a coin.
function currencyIcon(c) {
  if (c.kind === "fiat") return `<span class="cur-ic cur-flag">${[...c.code.slice(0, 2)].map((ch) => String.fromCodePoint(0x1f1a5 + ch.charCodeAt(0))).join("")}</span>`;
  let h = 0;
  for (const ch of c.code) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `<span class="cur-ic cur-coin" style="--h:${h}">${esc(c.code.replace(/^\d+/, "")[0] || c.code[0])}</span>`;
}

// Economic releases that move this market: its quote currency's (stablecoins count as USD).
const eventCurrency = (sym) => {
  const q = quoteCurrency(sym);
  return !q || /^USD|BTC|ETH|BNB/.test(q) ? "USD" : q;
};
const conditionsOf = (a) => (Array.isArray(a.conditions) && a.conditions.length ? a.conditions : [{ left: a.left, op: a.op, right: a.right }]);
const pad = (n) => String(n).padStart(2, "0");
// Headlines come from outside feeds, so only web links are opened.
const openLink = (url) => /^https?:\/\//i.test(url || "") && window.open(url, "_blank", "noopener");
function ago(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}

// ---------- primitives drawn by the chart library ----------
class CountdownLabel {
  constructor(x) {
    this.x = x;
    const v = (this.v = { y: -100, text: "", bg: "#000", fg: "#fff", on: false });
    this.views = [{ coordinate: () => v.y, text: () => v.text, textColor: () => v.fg, backColor: () => v.bg, visible: () => v.on, tickVisible: () => false }];
  }
  attached({ requestUpdate }) {
    this.req = requestUpdate;
  }
  detached() {
    this.req = null;
  }
  updateAllViews() {
    this.x.countdownState(this.v);
  }
  priceAxisViews() {
    return this.views;
  }
}

// Lines for paper positions and orders (full width, or from their label to the scale).
class TradeLines {
  constructor(x) {
    this.x = x;
    this.items = [];
    this.axis = [];
    this.hidden = false;
    this.views = [{ zOrder: () => "top", renderer: () => ({ draw: (t) => t.useMediaCoordinateSpace(({ context, mediaSize }) => this.draw(context, mediaSize)) }) }];
  }
  attached({ requestUpdate }) {
    this.req = requestUpdate;
  }
  detached() {
    this.req = null;
  }
  updateAllViews() {
    const p = this.x.p;
    this.axis = this.hidden
      ? []
      : this.items.map((it) => ({ coordinate: () => p.main?.priceToCoordinate(it.price) ?? -100, text: () => p.formatPrice(it.price), textColor: () => "#ffffff", backColor: () => it.color, visible: () => true, tickVisible: () => true }));
  }
  paneViews() {
    return this.views;
  }
  priceAxisViews() {
    return this.axis;
  }
  draw(ctx, size) {
    if (this.hidden) return;
    const main = this.x.p.main;
    for (const it of this.items) {
      const y = main?.priceToCoordinate(it.price);
      if (y == null) continue;
      const yy = Math.round(y) + 0.5;
      ctx.save();
      ctx.strokeStyle = it.color;
      ctx.lineWidth = 1;
      ctx.setLineDash(it.dash || []);
      ctx.beginPath();
      ctx.moveTo(it.extend ? 0 : Math.max(0, it.x0 || 0), yy);
      ctx.lineTo(size.width, yy);
      ctx.stroke();
      ctx.restore();
    }
  }
}

// Economic releases (dots along the bottom, coloured by impact) and news (purple lightning).
class EventMarks {
  constructor(x) {
    this.x = x;
    this.views = [{ zOrder: () => "top", renderer: () => ({ draw: (t) => t.useMediaCoordinateSpace(({ context, mediaSize }) => this.draw(context, mediaSize)) }) }];
  }
  attached({ requestUpdate }) {
    this.req = requestUpdate;
  }
  detached() {
    this.req = null;
  }
  updateAllViews() {}
  paneViews() {
    return this.views;
  }
  draw(ctx, size) {
    const x = this.x,
      cs = x.cs(),
      items = x.evItems || [];
    const y = size.height - 11;
    for (const it of items) {
      const sx = x.p.timeToX(it.time);
      it.sx = sx;
      it.sy = y;
      if (sx == null || sx < -10 || sx > size.width + 10) continue;
      ctx.save();
      if (it.kind === "econ" && cs.eventBreaks) {
        ctx.strokeStyle = colorOf(cs, "eventBreaksColor");
        ctx.lineWidth = cs.eventBreaksWidth || 1;
        ctx.setLineDash(cs.eventBreaksStyle === "dotted" ? [1.5, 3] : cs.eventBreaksStyle === "dashed" ? [5, 4] : []);
        ctx.beginPath();
        ctx.moveTo(Math.round(sx) + 0.5, 0);
        ctx.lineTo(Math.round(sx) + 0.5, y - 8);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.beginPath();
      ctx.arc(sx, y, it.kind === "news" ? 7.5 : 6, 0, Math.PI * 2);
      ctx.fillStyle = it.color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = x.p.app.settings.theme === "light" ? "#ffffff" : "#131722";
      ctx.stroke();
      if (it.kind === "news") {
        ctx.translate(sx, y);
        ctx.fillStyle = "#ffffff";
        ctx.fill(BOLT);
      }
      ctx.restore();
    }
  }
}

export class ChartExtras {
  constructor(p) {
    this.p = p;
    this.lines = { high: null, low: null, bid: null, ask: null, project: null, pdc: null, alerts: [] };
    this.boxes = new Map();
    this.evItems = [];
    this.seenNews = null;
    const root = (this.root = document.createElement("div"));
    root.className = "cx";
    root.innerHTML = `<div class="cx-cur"></div><div class="cx-al"></div><button class="cx-plus" hidden title="Add an alert, an order or a line at this price">${svg('<path d="M9 4v10M4 9h10"/>')}</button><div class="cx-nav">${NAV.map(([k, t, i]) => `<button data-nav="${k}" title="${t}">${i}</button>`).join("")}</div><div class="cx-panes"></div><div class="cx-boxes"></div><div class="cx-tip" hidden></div>`;
    p.el.appendChild(root);
    this.$ = (s) => root.querySelector(s);
    // a second click on the label closes its menu (heard before the menu's own outside-click close)
    addEventListener("pointerdown", (this.onCurDown = (e) => {
      if (e.target === this.$(".cx-cur")) this.curWasOpen = p.app.drawToolbar?.pop?.dataset.for === "cx-cur";
    }), true);
    this.$(".cx-cur").onclick = (e) => {
      if (this.curWasOpen) return (this.curWasOpen = false);
      this.currencyMenu(e.currentTarget);
    };
    this.trade = p.legendEl.querySelector(".lg-trade");
    this.countdown = new CountdownLabel(this);
    this.tradeLines = new TradeLines(this);
    this.events = new EventMarks(this);
    const ts = p.chart.timeScale();
    ts.subscribeVisibleLogicalRangeChange((this.onRange = () => this.schedule()));
    p.chart.subscribeCrosshairMove((this.onMove = (e) => this.crosshair(e)));
    p.chart.subscribeClick((this.onClick = (e) => this.click(e)));
    this.ro = new ResizeObserver(() => this.schedule());
    this.ro.observe(p.el);
    p.el.addEventListener("pointermove", (this.onPtr = (e) => this.hover(e)));
    p.el.addEventListener("pointerleave", (this.onLeave = () => this.hover(null)));
    this.ticks = 0;
    this.timer = setInterval(() => this.tick(), 1000);
    this.bind();
  }

  cs() {
    return this.p.app.settings.chart;
  }
  get sym() {
    return this.p.cfg.symbol;
  }
  paper() {
    return this.p.app.panels?.paper;
  }

  // A new main series (chart type change): the primitives and price lines move to it.
  attach(main) {
    main.attachPrimitive(this.countdown);
    main.attachPrimitive(this.tradeLines);
    main.attachPrimitive(this.events);
    this.lines = { high: null, low: null, bid: null, ask: null, project: null, pdc: null, alerts: [] };
  }

  destroy() {
    clearInterval(this.timer);
    removeEventListener("pointerdown", this.onCurDown, true);
    this.ro.disconnect();
    const ch = this.p.chart;
    ch.timeScale().unsubscribeVisibleLogicalRangeChange(this.onRange);
    ch.unsubscribeCrosshairMove(this.onMove);
    ch.unsubscribeClick(this.onClick);
    this.root.remove();
  }

  // Settings changed or the symbol loaded: everything.
  refresh() {
    this.sig = "";
    this.renderTrade();
    this.alertLines();
    this.watermark();
    this.loadEvents();
    this.update();
    this.layout();
    const cs = this.cs();
    if (!cs.lockRatio && this.ratioLocked) {
      this.ratioLocked = false;
      this.p.main?.priceScale().applyOptions({ autoScale: true });
    }
  }

  // New bars or a new price.
  update() {
    this.highLow();
    this.prevDayClose();
    this.bidAskLines();
    this.tradePrices();
    this.tradeItems();
    this.countdown.req?.();
  }

  schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.layout();
      this.highLow();
    });
  }

  tick() {
    const cs = this.cs();
    this.ticks++;
    if (cs.countdown) this.countdown.req?.();
    // Dragging the price scale turns auto scale off; the A button follows.
    if (cs.scaleModes !== "hidden") this.drawScaleButtons();
    // Only the active chart asks for bid and ask (the exchanges rate-limit), others share its answer.
    if (this.ticks % 5 === 0 && this.p === this.p.app.active && isCrypto(this.sym) && (cs.baValue || cs.baLine || cs.buySell) && !document.hidden) this.pollSpread();
    else if (this.ticks % 5 === 2 && quotes.has(this.sym)) {
      this.tradePrices();
      this.bidAskLines();
    }
    if (this.ticks % 180 === 0) this.watchNews();
    if (this.ticks % 600 === 0) this.loadEvents();
  }

  // ---------- geometry ----------
  geo() {
    const p = this.p,
      cs = this.cs(),
      left = cs.placement === "left";
    const rect = p.el.getBoundingClientRect();
    // A scale that just moved sides has no width until the chart paints it.
    let sw = 0;
    try {
      sw = p.chart.priceScale(left ? "left" : "right").width();
    } catch {
      requestAnimationFrame(() => this.schedule());
    }
    const plotW = p.chart.timeScale().width();
    const panes = p.chart.panes().map((pn) => {
      const r = pn.getHTMLElement?.()?.getBoundingClientRect();
      return r ? { top: r.top - rect.top, h: r.height } : { top: 0, h: pn.getHeight() };
    });
    return { left, sw, plotW, plotX: left ? sw : 0, scaleX: left ? 0 : plotW, panes, bottom: panes.length ? panes.at(-1).top + panes.at(-1).h : rect.height };
  }

  layout() {
    const p = this.p;
    if (!p.main || !p.el.isConnected) return;
    const cs = this.cs(),
      g = (this.g = this.geo());
    p.placePaneLegends?.();
    const vis = (el, mode) => {
      el.hidden = mode === "hidden";
      el.classList.toggle("cx-hov", mode === "hover");
    };
    // currency and unit, at the top of the price scale
    const cur = this.$(".cx-cur");
    const q = this.p.ownCurrency(),
      to = this.p.convTo();
    cur.innerHTML = `${esc(to || q)}${svg('<path d="M5 7l4 4 4-4"/>')}`;
    cur.classList.toggle("conv", !!to);
    vis(cur, q ? cs.currencyUnit : "hidden");
    cur.title = to ? `Prices in ${to}, converted from ${q}. Click to change the currency.` : `Prices are in ${q}. Click to show them in another currency.`;
    cur.style.left = `${g.scaleX + 3}px`;
    cur.style.top = `${(g.panes[0]?.top || 0) + 3}px`;
    cur.style.width = `${Math.max(0, g.sw - 6)}px`;
    this.drawScaleButtons(true);
    // navigation buttons, bottom centre
    const nav = this.$(".cx-nav");
    vis(nav, cs.navButtons);
    nav.style.left = `${g.plotX + g.plotW / 2 - nav.offsetWidth / 2}px`;
    nav.style.top = `${g.bottom - 46}px`;
    this.drawPaneButtons();
    this.placeBoxes();
    this.lockRatio();
    this.events.req?.();
  }

  // A and L at the bottom of each pane's price scale.
  drawScaleButtons(force = false) {
    const cs = this.cs(),
      g = this.g,
      box = this.$(".cx-al");
    if (!g) return;
    box.hidden = cs.scaleModes === "hidden";
    box.classList.toggle("cx-hov", cs.scaleModes === "hover");
    if (box.hidden) return;
    const sid = cs.placement === "left" ? "left" : "right";
    const state = this.p.chart.panes().map((pn, i) => {
      let auto = true;
      try {
        auto = pn.priceScale(sid).options().autoScale;
      } catch {
        /* no scale yet */
      }
      return [auto, this.paneLog(i)];
    });
    const sig = JSON.stringify([state, g.panes, g.scaleX, g.sw]);
    if (!force && sig === this.alSig) return;
    this.alSig = sig;
    box.innerHTML = g.panes
      .map((pn, i) => `<div class="cx-alp" data-pane="${i}" style="left:${g.scaleX + g.sw / 2 - 21}px;top:${pn.top + pn.h - 23}px"><button data-a="auto" class="${state[i]?.[0] ? "on" : ""}" title="Auto (fits data to screen)">A</button><button data-a="log" class="${state[i]?.[1] ? "on" : ""}" title="Logarithmic scale">L</button></div>`)
      .join("");
  }
  paneLog(i) {
    if (i === 0) return !!this.p.cfg.log;
    const uids = this.p.paneUids?.[i] || [];
    return this.p.cfg.indicators.some((x) => uids.includes(x.uid) && x.log);
  }

  // Move up, move down, collapse, maximize and remove, top right of each pane (with 2+ panes).
  drawPaneButtons() {
    const cs = this.cs(),
      g = this.g,
      box = this.$(".cx-panes");
    const n = g.panes.length;
    box.hidden = cs.paneButtons === "hidden" || n < 2;
    box.classList.toggle("cx-hov", cs.paneButtons === "hover");
    if (box.hidden) {
      this.pbHtml = "";
      return (box.innerHTML = "");
    }
    const st = (this.p.paneState ||= { max: null, collapsed: [] });
    const html = g.panes
      .map((pn, i) => {
        // the price pane stays first; indicator panes move among themselves
        const shown = PANE_BTNS.filter(([k]) => !((k === "up" && i <= 1) || (k === "down" && (i === 0 || i === n - 1)) || (k === "remove" && i === 0)));
        const btns = shown
          .map(([k, t, ic, t2, ic2]) => {
            const on = (k === "max" && st.max === i) || (k === "collapse" && st.collapsed.includes(i));
            return `<button data-pb="${k}" data-tip="${on ? t2 : t}" data-keys="${PANE_KEYS[k] || ""}" aria-label="${on ? t2 : t}" class="${on ? "on" : ""}">${on ? ic2 : ic}</button>`;
          })
          .join("");
        return `<div class="cx-pb" data-pane="${i}">${btns}</div>`;
      })
      .join("");
    // Rebuilt only when the buttons change (live bars redraw the chart often), so a click or a
    // tooltip isn't cut off; otherwise they only move.
    if (html !== this.pbHtml) {
      const show = box.querySelector(".cx-pb.show")?.dataset.pane;
      this.pbHtml = html;
      box.innerHTML = html;
      if (show !== undefined) box.querySelector(`.cx-pb[data-pane="${show}"]`)?.classList.add("show");
      if (tipEl && !tipEl._for.isConnected) hideTip();
    }
    box.querySelectorAll(".cx-pb").forEach((el) => {
      const pn = g.panes[Number(el.dataset.pane)];
      el.style.top = `${pn.top + 5}px`;
      el.style.left = `${g.plotX + g.plotW - 10 - el.offsetWidth}px`;
    });
  }

  // Which pane the pointer is over: pane buttons show for that pane, navigation near the bottom.
  hover(e) {
    const g = this.g;
    if (!g) return;
    let idx = -1,
      nearBottom = false;
    if (e) {
      const r = this.p.el.getBoundingClientRect(),
        y = e.clientY - r.top;
      idx = g.panes.findIndex((pn) => y >= pn.top && y < pn.top + pn.h);
      nearBottom = y > g.bottom - 110 && y < g.bottom + 30;
    }
    this.$(".cx-panes").querySelectorAll(".cx-pb").forEach((el) => el.classList.toggle("show", Number(el.dataset.pane) === idx));
    this.$(".cx-nav").classList.toggle("show", nearBottom);
  }

  bind() {
    const p = this.p,
      app = p.app;
    this.root.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || b.disabled) return;
      if (b.dataset.nav) return this.navigate(b.dataset.nav);
      if (b.dataset.a) {
        const i = Number(b.closest("[data-pane]").dataset.pane);
        if (b.dataset.a === "auto") {
          const sid = this.cs().placement === "left" ? "left" : "right";
          const ps = p.chart.panes()[i]?.priceScale(sid);
          if (ps) ps.applyOptions({ autoScale: !ps.options().autoScale });
          if (i === 0 && this.cs().lockRatio) app.toast("Unlock the price to bar ratio (Settings, Scales and lines) to rescale.");
        } else if (i === 0) {
          p.cfg.log = !p.cfg.log;
          p.render(false);
          app.syncToolbar();
          app.persist();
        } else {
          const uids = p.paneUids?.[i] || [],
            on = !this.paneLog(i);
          for (const ind of p.cfg.indicators) if (uids.includes(ind.uid)) ind.log = on;
          p.render(false);
          app.persist();
        }
        return this.drawScaleButtons(true);
      }
      if (b.dataset.pb) return this.paneAction(b.dataset.pb, Number(b.closest("[data-pane]").dataset.pane));
      if (b.classList.contains("cx-plus")) return this.plusMenu(b);
      const box = b.closest(".cx-box");
      if (box && b.dataset.act) return this.boxAction(box.dataset.id, b.dataset.act, b);
    });
    // TradingView-style tooltips on the pane buttons: the name, then its shortcut
    this.root.addEventListener("pointerover", (e) => {
      const b = e.target.closest("[data-tip]");
      if (b && tipEl?._for !== b) showTip(b);
    });
    this.root.addEventListener("pointerout", (e) => {
      const b = e.target.closest("[data-tip]");
      if (b && !b.contains(e.relatedTarget)) hideTip();
    });
    this.root.addEventListener("pointerdown", hideTip, true);
    this.$(".cx-plus").addEventListener("pointerleave", () => {
      if (!this.overPlot) this.$(".cx-plus").hidden = true;
    });
  }

  // Double-click a pane: maximize it or put it back. Cmd/Ctrl + double-click: collapse or expand.
  paneDoubleClick(e) {
    const g = this.g;
    if (!g || g.panes.length < 2 || this.p.app.tool !== "cursor") return;
    const y = e.clientY - this.p.el.getBoundingClientRect().top;
    const i = g.panes.findIndex((pn) => y >= pn.top && y < pn.top + pn.h);
    if (i < 0) return;
    hideTip();
    this.paneAction(e.metaKey || e.ctrlKey ? "collapse" : "max", i);
  }

  navigate(k) {
    const ts = this.p.chart.timeScale(),
      r = ts.getVisibleLogicalRange();
    if (k === "reset") return this.p.resetView();
    if (!r) return;
    const w = r.to - r.from;
    if (k === "out") ts.setVisibleLogicalRange({ from: r.to - w * 1.25, to: r.to });
    if (k === "in") ts.setVisibleLogicalRange({ from: r.to - Math.max(5, w * 0.8), to: r.to });
    if (k === "left") ts.setVisibleLogicalRange({ from: r.from - w * 0.15, to: r.to - w * 0.15 });
    if (k === "right") ts.setVisibleLogicalRange({ from: r.from + w * 0.15, to: r.to + w * 0.15 });
  }

  paneAction(k, i) {
    const p = this.p,
      app = p.app,
      st = (p.paneState ||= { max: null, collapsed: [] });
    if (k === "max") st.max = st.max === i ? null : i;
    if (k === "collapse") st.collapsed = st.collapsed.includes(i) ? st.collapsed.filter((x) => x !== i) : [...st.collapsed, i];
    if (k === "max" || k === "collapse") {
      if (k === "max") st.collapsed = st.collapsed.filter((x) => x !== i);
      p.applyPaneSizes();
      return this.schedule();
    }
    if (app.settings.lockIndicators) return app.toast("Indicators are locked. Unlock them from the lock button on the left.");
    const groups = p.paneUids || [];
    if (k === "remove") {
      const gone = groups[i] || [];
      p.cfg.indicators = p.cfg.indicators.filter((x) => !gone.includes(x.uid));
      st.max = null;
      st.collapsed = [];
    } else {
      const j = k === "up" ? i - 1 : i + 1;
      if (j < 1 || j >= groups.length) return;
      const order = groups.map((_, x) => x);
      [order[i], order[j]] = [order[j], order[i]];
      const rank = new Map();
      order.forEach((paneIdx, pos) => (groups[paneIdx] || []).forEach((uid) => rank.set(uid, pos)));
      p.cfg.indicators = [...p.cfg.indicators].sort((a, b) => (rank.get(a.uid) ?? 0) - (rank.get(b.uid) ?? 0));
      st.max = null;
      st.collapsed = [];
    }
    p.render(false);
    app.persist();
  }

  // ---------- the + on the price scale ----------
  crosshair(e) {
    const cs = this.cs(),
      g = this.g,
      plus = this.$(".cx-plus");
    this.overPlot = !!e.point;
    const onMain = e.point && (e.paneIndex ?? 0) === 0;
    if (cs.plusButton && onMain && g && this.p.app.tool === "cursor" && this.p.main) {
      const price = this.p.main.coordinateToPrice(e.point.y);
      if (price != null) {
        this.plusPrice = price;
        plus.hidden = false;
        plus.style.top = `${(g.panes[0]?.top || 0) + e.point.y - 9}px`;
        plus.style.left = `${g.left ? g.scaleX + g.sw - 9 : g.scaleX - 9}px`;
      }
    } else if (!plus.matches(":hover")) plus.hidden = true;
    this.eventTip(e);
  }

  plusMenu(btn) {
    const p = this.p,
      app = p.app,
      px = this.plusPrice,
      t = ticker(this.sym),
      f = p.formatPrice(px),
      last = this.lastPrice();
    const paper = this.paper(),
      qty = this.qtyFor(px);
    const above = last != null && px > last;
    // on a converted chart only the line (alerts and orders use the symbol's own prices)
    const conv = !!p.convTo();
    const items = conv ? [] : [`<button data-k="alert">Add alert on ${esc(t)} at ${esc(f)}</button>`];
    if (paper && qty && !conv) {
      items.push(`<hr><button data-k="sell-${above ? "limit" : "stop"}">Sell ${esc(this.fmtQty(qty))} ${esc(t)} @ ${esc(f)} ${above ? "limit" : "stop"}</button>`);
      items.push(`<button data-k="buy-${above ? "stop" : "limit"}">Buy ${esc(this.fmtQty(qty))} ${esc(t)} @ ${esc(f)} ${above ? "stop" : "limit"}</button>`);
    }
    items.push(`${conv ? "" : "<hr>"}<button data-k="hline">Draw horizontal line at ${esc(f)}</button>`);
    const tb = app.drawToolbar;
    const pop = tb.openPopover(btn, items.join(""), "cx-plus");
    pop.classList.add("dtb-list", "cx-menu");
    const r = btn.getBoundingClientRect();
    pop.style.left = `${Math.max(4, Math.min(r.left - pop.offsetWidth - 4, innerWidth - pop.offsetWidth - 4))}px`;
    pop.style.top = `${Math.max(4, Math.min(r.top - 6, innerHeight - pop.offsetHeight - 4))}px`;
    pop.onclick = (e) => {
      const k = e.target.closest("[data-k]")?.dataset.k;
      if (!k) return;
      tb.closePopover();
      if (k === "alert") return app.panels.openAlertDialog({ rules: [{ left: { kind: "price", field: "close" }, op: "crosses", right: { kind: "value", v: Number(px.toPrecision(8)) } }] });
      if (k === "hline") {
        const d = { id: `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, type: "hline", points: [{ time: p.bars.at(-1)?.time ?? Math.floor(Date.now() / 1000), price: px }], ...app.drawingDefaults("hline"), ...p.ownTag() };
        p.drawings.items.push(d);
        p.drawings.selected = d;
        app.saveDrawings(p.drawKey(), p.drawings.items);
        return p.drawings.update();
      }
      const [side, type] = k.split("-");
      this.confirm(btn, `${side === "buy" ? "Buy" : "Sell"} ${this.fmtQty(qty)} ${t} @ ${f} ${type}`, side === "buy" ? "Buy" : "Sell", side, () => paper.place({ symbol: this.sym, side, type, price: px, qty }));
    };
  }

  // ---------- currency menu ----------
  // TradingView's currency menu on the price scale: search, the chart's currency on top, starred ones,
  // then every currency the chart can be shown in (fiat from Yahoo's rates, coins from their USDT markets).
  async currencyMenu(btn) {
    const p = this.p,
      app = p.app,
      tb = app.drawToolbar;
    const own = p.ownCurrency();
    if (!own) return;
    let list;
    try {
      list = await (currencyList ||= api.get("/api/currencies").catch((e) => ((currencyList = null), Promise.reject(e))));
    } catch (e) {
      return app.toast(`Couldn't load the currency list: ${esc(e.message)}`, "err");
    }
    const shown = p.convTo() || own,
      favs = () => app.settings.currencyFavorites || [];
    const pop = tb.openPopover(btn, `<div class="cur-h">Currencies</div><label class="cur-search">${svg('<circle cx="8" cy="8" r="5"/><path d="M12 12l3.5 3.5"/>')}<input placeholder="Search" spellcheck="false" autocomplete="off"></label><div class="cur-list"></div>`, "cx-cur");
    pop.classList.add("cur-menu");
    const r = btn.getBoundingClientRect();
    pop.style.left = `${Math.max(4, Math.min(r.right - pop.offsetWidth, innerWidth - pop.offsetWidth - 4))}px`;
    pop.style.top = `${r.bottom + 4}px`;
    const box = pop.querySelector(".cur-list"),
      input = pop.querySelector("input");
    const byCode = new Map(list.map((c) => [c.code, c]));
    const row = (code, sub) => {
      const c = byCode.get(code) || { code, name: code === own ? "This symbol's currency" : code, kind: "crypto" };
      const fav = favs().includes(code);
      return `<div class="cur-row${code === shown ? " on" : ""}" data-c="${esc(code)}">${currencyIcon(c)}<span class="cur-t"><b>${esc(code)}</b><small>${esc(sub || c.name)}</small></span><button class="cur-star${fav ? " fav" : ""}" data-star="${esc(code)}" title="${fav ? "Remove from favorites" : "Add to favorites"}">${STAR_SVG}</button></div>`;
    };
    const render = () => {
      const q = input.value.trim().toUpperCase();
      let html;
      if (q) {
        const hits = list.filter((c) => c.code.includes(q) || c.name.toUpperCase().includes(q));
        hits.sort((a, b) => (b.code.startsWith(q) ? 1 : 0) - (a.code.startsWith(q) ? 1 : 0) || a.code.localeCompare(b.code));
        html = hits.map((c) => row(c.code)).join("") || '<div class="cur-none">No currency matches.</div>';
      } else {
        const top = [shown, ...(shown !== own ? [own] : [])];
        const starred = favs().filter((c) => !top.includes(c) && byCode.has(c));
        html =
          row(shown, shown !== own ? `${byCode.get(shown)?.name || shown} (converted)` : undefined) +
          (shown !== own ? row(own, `${byCode.get(own)?.name || own}, the symbol's own`) : "") +
          '<hr>' +
          (starred.length ? starred.map((c) => row(c)).join("") + "<hr>" : "") +
          list.filter((c) => !top.includes(c.code) && !starred.includes(c.code)).map((c) => row(c.code)).join("");
      }
      box.innerHTML = html;
    };
    render();
    input.focus();
    input.oninput = () => {
      render();
      box.scrollTop = 0;
    };
    input.onkeydown = (e) => {
      if (e.key === "Enter") box.querySelector("[data-c]")?.click();
      if (e.key === "Escape") tb.closePopover();
    };
    box.onclick = (e) => {
      const star = e.target.closest("[data-star]");
      if (star) {
        const code = star.dataset.star,
          cur = favs();
        app.settings.currencyFavorites = cur.includes(code) ? cur.filter((x) => x !== code) : [...cur, code];
        app.persist();
        const top = box.scrollTop;
        render();
        box.scrollTop = top;
        input.focus({ preventScroll: true }); // typing goes on into the search, as on TradingView
        return;
      }
      const code = e.target.closest("[data-c]")?.dataset.c;
      if (!code) return;
      tb.closePopover();
      if (code !== shown) p.setCurrency(code);
    };
  }

  // ---------- buy and sell buttons ----------
  renderTrade() {
    const cs = this.cs(),
      el = this.trade;
    if (!el) return;
    const on = cs.buySell && !!this.paper() && !this.sym.startsWith("SPREAD:") && !this.p.convTo();
    el.hidden = !on;
    if (!on) return;
    if (!el.firstChild) {
      el.innerHTML = `<button class="cx-sell" data-side="sell"><b></b><span>SELL</span></button><span class="cx-spread"></span><button class="cx-buy" data-side="buy"><b></b><span>BUY</span></button>`;
      el.onclick = (e) => {
        const b = e.target.closest("[data-side]");
        if (b) this.marketOrder(b.dataset.side, b);
      };
      el.onpointerover = (e) => {
        const b = e.target.closest("[data-side]");
        if (b && this.cs().projectOrder) this.projectLine(b.dataset.side);
      };
      el.onpointerout = (e) => {
        if (e.target.closest("[data-side]") && !e.relatedTarget?.closest?.("[data-side]")) this.projectLine(null);
      };
    }
    this.tradePrices();
  }
  freshQuote() {
    const q = quotes.get(this.sym);
    return q && Date.now() - q.at < 20000 && !this.p.replay ? q : null;
  }
  lastPrice() {
    const p = this.p;
    if (p.replay) return p.bars[p.replay.index]?.close ?? null;
    if (p.convTo()) return p.bars.at(-1)?.close ?? null;
    return p.app.prices[this.sym] ?? p.bars.at(-1)?.close ?? null;
  }
  sidePrice(side) {
    const q = this.freshQuote(),
      last = this.lastPrice();
    if (!q || last == null) return last;
    // Keep the quoted spread around the live last price, which moves faster than the poll.
    const mid = (q.bid + q.ask) / 2;
    return side === "buy" ? last + (q.ask - mid) : last - (mid - q.bid);
  }
  tradePrices() {
    const el = this.trade;
    if (!el || el.hidden || !el.firstChild) return;
    const sell = this.sidePrice("sell"),
      buy = this.sidePrice("buy"),
      q = this.freshQuote();
    el.querySelector(".cx-sell b").textContent = this.p.formatPrice(sell);
    el.querySelector(".cx-buy b").textContent = this.p.formatPrice(buy);
    el.querySelector(".cx-spread").textContent = q ? this.p.formatPrice(q.ask - q.bid) : "";
  }
  async pollSpread() {
    const sym = this.sym,
      r = await spreadOf(sym);
    if (r && r.bid > 0) quotes.set(sym, { bid: r.bid, ask: r.ask, at: Date.now() });
    this.tradePrices();
    this.bidAskLines();
  }
  qtyFor(px) {
    const amt = this.p.app.settings.orderAmount || 1000;
    return px > 0 ? amt / px : 0;
  }
  fmtQty(q) {
    return q >= 100 ? fmtNum(q, 1).replace(/\.0$/, "") : String(Number(q.toPrecision(4)));
  }
  marketOrder(side, btn) {
    const paper = this.paper(),
      px = this.sidePrice(side);
    if (!paper || !(px > 0)) return this.p.app.toast("No live price yet.", "err");
    const go = (qty) => paper.place({ symbol: this.sym, side, type: "market", price: px, qty });
    if (this.cs().oneClick) return go(this.qtyFor(px));
    // Without one-click trading the order is confirmed first, with the amount editable.
    const app = this.p.app,
      tb = app.drawToolbar,
      t = ticker(this.sym),
      cur = quoteCurrency(this.sym) || "USD";
    const pop = tb.openPopover(btn, `<div class="cx-ticket"><div class="cx-tk-h"><b class="${side}">${side === "buy" ? "Buy" : "Sell"} ${esc(t)}</b> at market</div><label>Amount (${esc(cur)})<input type="number" min="0" step="any" value="${app.settings.orderAmount || 1000}"></label><div class="cx-tk-q"></div><div class="cx-tk-b"><button class="btn small" data-x="no">Cancel</button><button class="btn small primary ${side}" data-x="yes">${side === "buy" ? "Buy" : "Sell"}</button></div></div>`, "cx-ticket");
    const inp = pop.querySelector("input"),
      qEl = pop.querySelector(".cx-tk-q");
    const show = () => (qEl.textContent = `≈ ${this.fmtQty(Number(inp.value) / px)} ${t} at ${this.p.formatPrice(px)}`);
    inp.oninput = show;
    show();
    inp.focus();
    inp.select();
    const ok = () => {
      const amt = Number(inp.value);
      if (!(amt > 0)) return inp.focus();
      app.settings.orderAmount = amt;
      tb.closePopover();
      go(amt / px);
    };
    inp.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Enter") ok();
      if (e.key === "Escape") tb.closePopover();
    };
    pop.querySelector("[data-x=yes]").onclick = ok;
    pop.querySelector("[data-x=no]").onclick = () => tb.closePopover();
  }
  // With "Project order", hovering Buy or Sell shows where the order would fill.
  projectLine(side) {
    const main = this.p.main;
    if (this.lines.project) {
      try {
        main.removePriceLine(this.lines.project);
      } catch {
        /* series gone */
      }
      this.lines.project = null;
    }
    if (!side || !main) return;
    const px = this.sidePrice(side);
    if (!(px > 0)) return;
    this.lines.project = main.createPriceLine({ price: px, color: side === "buy" ? BUY : SELL, lineWidth: 1, lineStyle: LW.LineStyle.Dashed, axisLabelVisible: true, title: `${side === "buy" ? "Buy" : "Sell"} ${this.fmtQty(this.qtyFor(px))}` });
  }

  // A small confirm for order actions when one-click trading is off.
  confirm(anchor, text, okLabel, side, fn) {
    if (this.cs().oneClick) return fn();
    const tb = this.p.app.drawToolbar;
    const pop = tb.openPopover(anchor, `<div class="cx-ticket"><div class="cx-tk-h">${esc(text)}</div><div class="cx-tk-b"><button class="btn small" data-x="no">Cancel</button><button class="btn small primary ${side || ""}" data-x="yes">${esc(okLabel)}</button></div></div>`, "cx-confirm");
    pop.querySelector("[data-x=yes]").onclick = () => {
      tb.closePopover();
      fn();
    };
    pop.querySelector("[data-x=no]").onclick = () => tb.closePopover();
  }

  // ---------- paper positions and orders on the chart ----------
  tradeItems() {
    const cs = this.cs(),
      paper = this.paper(),
      p = this.p;
    const items = [];
    if (paper && cs.positions && !p.app.settings.hidePositions && !p.convTo()) {
      const acct = paper.account(),
        pos = acct.positions[this.sym];
      const last = this.lastPrice();
      if (pos) {
        const long = pos.qty > 0;
        items.push({ id: "pos", kind: "pos", price: pos.avg, qty: pos.qty, color: long ? BUY : SELL, pnl: cs.pnl && cs.pnlPos && last != null ? this.pnlText((last - pos.avg) * pos.qty, last - pos.avg, pos.avg, cs.pnlPositions, long) : null });
      }
      for (const o of acct.orders.filter((x) => x.symbol === this.sym)) {
        const bracket = /stop loss|take profit/.test(o.note || "");
        const color = bracket ? (/take profit/.test(o.note) ? PROFIT : SELL) : o.side === "buy" ? BUY : SELL;
        let pnl = null;
        if (bracket && pos && cs.pnl && cs.pnlBr) pnl = this.pnlText((o.price - pos.avg) * Math.sign(pos.qty) * o.qty, (o.price - pos.avg) * Math.sign(pos.qty), pos.avg, cs.pnlBrackets, true);
        const label = bracket ? (/take profit/.test(o.note) ? "TP" : "SL") : `${o.side === "buy" ? "Buy" : "Sell"} ${o.type}`;
        items.push({ id: o.id, kind: "order", label, price: o.price, qty: o.qty, color, dash: [4, 3], pnl });
      }
    }
    for (const it of items) it.extend = cs.extendLines;
    this.tradeLines.items = items;
    this.syncBoxes(items);
    this.tradeLines.req?.();
  }
  pnlText(money, move, avg, unit, long) {
    const sign = (v) => (v > 0 ? "+" : v < 0 ? "−" : "");
    const cls = money > 0 ? "up" : money < 0 ? "down" : "";
    if (unit === "percent") {
      const v = (move / avg) * 100 * (long ? 1 : -1);
      return { text: `${sign(v)}${Math.abs(v).toFixed(2)}%`, cls };
    }
    if (unit === "ticks") {
      const tick = this.p.main?.options().priceFormat?.minMove || 0.01;
      const v = Math.round(Math.abs(move) / tick) * Math.sign(money);
      return { text: `${sign(v)}${Math.abs(v).toLocaleString()} ticks`, cls };
    }
    const cur = quoteCurrency(this.sym) || "USD";
    return { text: `${sign(money)}${Math.abs(money).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`, cls };
  }
  syncBoxes(items) {
    const host = this.$(".cx-boxes"),
      cs = this.cs(),
      seen = new Set();
    for (const it of items) {
      seen.add(it.id);
      let el = this.boxes.get(it.id);
      if (!el) {
        el = document.createElement("div");
        el.className = "cx-box";
        el.dataset.id = it.id;
        host.appendChild(el);
        this.boxes.set(it.id, el);
      }
      const head = it.kind === "pos" ? (it.qty > 0 ? "Long" : "Short") : it.label;
      const btns = it.kind === "pos" ? `${cs.reverseButton ? `<button data-act="reverse" title="Reverse position">${ICON_REVERSE}</button>` : ""}<button data-act="close" title="Close position">${ICON_X}</button>` : `<button data-act="cancel" title="Cancel order">${ICON_X}</button>`;
      const html = `<span class="cx-bh">${esc(head)}</span><span class="cx-bq">${esc(this.fmtQty(Math.abs(it.qty)))}</span>${it.pnl ? `<span class="cx-bp ${it.pnl.cls}">${esc(it.pnl.text)}</span>` : ""}${btns}`;
      if (el.dataset.html !== html) {
        el.dataset.html = html;
        el.innerHTML = html;
      }
      el.style.setProperty("--c", it.color);
    }
    for (const [id, el] of this.boxes)
      if (!seen.has(id)) {
        el.remove();
        this.boxes.delete(id);
      }
    this.placeBoxes();
  }
  placeBoxes() {
    const g = this.g,
      cs = this.cs(),
      main = this.p.main;
    if (!g || !main) return;
    const top0 = g.panes[0]?.top || 0,
      h0 = g.panes[0]?.h || 0;
    for (const it of this.tradeLines.items) {
      const el = this.boxes.get(it.id);
      if (!el) continue;
      const y = main.priceToCoordinate(it.price);
      el.hidden = y == null || y < 0 || y > h0;
      if (el.hidden) continue;
      const w = el.offsetWidth;
      const x = cs.alignment === "left" ? g.plotX + 8 : cs.alignment === "center" ? g.plotX + (g.plotW - w) / 2 : g.plotX + g.plotW - w - 64;
      el.style.left = `${Math.round(x)}px`;
      el.style.top = `${Math.round(top0 + y - el.offsetHeight / 2)}px`;
      it.x0 = x - g.plotX;
    }
    this.tradeLines.req?.();
  }
  boxAction(id, act, btn) {
    const paper = this.paper();
    if (!paper) return;
    const t = ticker(this.sym);
    if (act === "cancel") return this.confirm(btn, `Cancel this ${t} order?`, "Cancel order", "", () => paper.cancel(id));
    if (act === "close") return this.confirm(btn, `Close your ${t} position at market?`, "Close", "", () => paper.close(this.sym));
    if (act === "reverse") return this.confirm(btn, `Reverse your ${t} position at market?`, "Reverse", "", () => paper.reverse(this.sym));
  }

  // Fills as arrows on their bars: blue up for buys, red down for sells.
  execMarkers() {
    const cs = this.cs(),
      paper = this.paper(),
      bars = this.p.bars;
    if (!cs.execMarks || !paper || !bars.length || this.hideForShot) return [];
    const out = [];
    for (const h of paper.account().history || []) {
      if (h.symbol !== this.sym) continue;
      const t = h.time / 1000;
      if (t < bars[0].time) continue;
      let lo = 0,
        hi = bars.length - 1;
      while (lo < hi) {
        const m = (lo + hi + 1) >> 1;
        if (bars[m].time <= t) lo = m;
        else hi = m - 1;
      }
      const buy = h.side === "buy";
      out.push({ time: bars[lo].time, position: buy ? "belowBar" : "aboveBar", shape: buy ? "arrowUp" : "arrowDown", color: buy ? BUY : SELL, text: cs.execLabels ? `${buy ? "Buy" : "Sell"} ${this.fmtQty(h.qty)} @ ${this.p.formatPrice(h.price)}` : "" });
    }
    return out;
  }
  // From the paper account: lines, labels, markers.
  tradeChanged() {
    this.tradeItems();
    this.p.refreshMarkers?.();
  }

  // ---------- price lines ----------
  priceLine(key, on, opts) {
    const main = this.p.main;
    if (!main) return;
    if (!on) {
      if (this.lines[key]) {
        try {
          main.removePriceLine(this.lines[key]);
        } catch {
          /* series replaced */
        }
        this.lines[key] = null;
      }
      return;
    }
    if (this.lines[key]) this.lines[key].applyOptions(opts);
    else this.lines[key] = main.createPriceLine(opts);
  }
  // Highest high and lowest low of the bars on screen.
  highLow() {
    const cs = this.cs(),
      p = this.p,
      on = (cs.hlValue || cs.hlLine) && p.shown.length;
    let hi = -Infinity,
      lo = Infinity;
    if (on) {
      const r = p.chart.timeScale().getVisibleLogicalRange();
      if (!r) return;
      const a = Math.max(0, Math.ceil(r.from)),
        b = Math.min(p.shown.length - 1, Math.floor(r.to));
      for (let i = a; i <= b; i++) {
        const x = p.shown[i];
        if (x.high > hi) hi = x.high;
        if (x.low < lo) lo = x.low;
      }
    }
    const ok = on && Number.isFinite(hi);
    const o = (title, price) => ({ price, title: cs.hlValue ? title : "", color: colorOf(cs, "highLowColor"), lineWidth: cs.highLowWidth || 1, lineStyle: LINE_STYLE[cs.highLowStyle] ?? 1, lineVisible: cs.hlLine, axisLabelVisible: cs.hlValue });
    this.priceLine("high", ok, ok && o("High", hi));
    this.priceLine("low", ok, ok && o("Low", lo));
  }
  // Previous day close (Settings, Scales and lines): the close of the last finished daily bar, from
  // the daily bars themselves (on crypto the exchange's UTC day, on stocks the last session), so it
  // matches TradingView's even when the chart's own bars don't reach back that far.
  prevDayClose() {
    const cs = this.cs(),
      on = cs.pdcValue || cs.pdcLine,
      sym = this.sym;
    if (!on || !sym || sym.startsWith("SPREAD:")) return this.priceLine("pdc", false);
    const c = (this.pdcCache ||= {}),
      hit = c[sym];
    if (!hit || (Date.now() - hit.at > 10 * 60e3 && !hit.pending)) {
      c[sym] = { ...(hit || {}), at: hit?.at || 0, pending: true };
      api
        .candles(sym, "1D", 5)
        .then((r) => {
          const bars = r.candles || [];
          c[sym] = { at: Date.now(), price: bars.length >= 2 ? bars.at(-2).close : null, time: bars.length >= 2 ? bars.at(-2).time : null };
        })
        .catch(() => (c[sym] = { at: Date.now(), price: null }))
        .finally(() => this.sym === sym && this.prevDayClose());
    }
    let price = c[sym]?.price;
    // on a converted chart, at the rate in force when that day closed
    if (this.p.rates && Number.isFinite(price)) {
      const k = this.p.rateAt(c[sym].time + 86399);
      price = k ? price * k : null;
    }
    const ok = Number.isFinite(price);
    this.priceLine("pdc", ok, ok && { price, title: "", color: colorOf(cs, "pdcColor"), lineWidth: cs.pdcWidth || 1, lineStyle: LINE_STYLE[cs.pdcStyle] ?? 1, lineVisible: !!cs.pdcLine, axisLabelVisible: !!cs.pdcValue });
  }
  bidAskLines() {
    const cs = this.cs(),
      q = this.freshQuote(),
      on = (cs.baValue || cs.baLine) && !!q && !this.p.convTo();
    const o = (price, color) => ({ price, color, lineWidth: 1, lineStyle: LW.LineStyle.Dotted, lineVisible: cs.baLine, axisLabelVisible: cs.baValue, title: "" });
    this.priceLine("bid", on, on && o(q.bid, colorOf(cs, "bidColor")));
    this.priceLine("ask", on, on && o(q.ask, colorOf(cs, "askColor")));
  }
  // Price alerts on this symbol: green above the price, red below (or the colour picked).
  alertLines() {
    const cs = this.cs(),
      main = this.p.main;
    if (!main) return;
    for (const l of this.lines.alerts)
      try {
        main.removePriceLine(l);
      } catch {
        /* series replaced */
      }
    this.lines.alerts = [];
    // alerts are in the symbol's own currency: not drawn on a converted chart
    if (!cs.alertLines || this.p.convTo()) return;
    const last = this.lastPrice();
    for (const a of this.p.app.alertList || []) {
      if (a.symbol !== this.sym || (cs.onlyActiveAlerts && !a.active)) continue;
      for (const c of conditionsOf(a)) {
        // a Moving Up/Down alert's number is an amount, not a price; a channel has two bounds
        if (/^moving/.test(c.op)) continue;
        const vals = [typeof c.right === "number" && PRICE_FIELDS.includes(c.left) ? c.right : typeof c.left === "number" && PRICE_FIELDS.includes(c.right) ? c.left : null];
        if (typeof c.right2 === "number" && PRICE_FIELDS.includes(c.left)) vals.push(c.right2);
        for (const v of vals) {
          if (!Number.isFinite(v)) continue;
          const color = cs.alertLineColor || (last != null && v < last ? SELL : PROFIT);
          this.lines.alerts.push(main.createPriceLine({ price: v, color, lineWidth: 1, lineStyle: a.active ? LW.LineStyle.Solid : LW.LineStyle.Dashed, axisLabelVisible: true, title: a.active ? "Alert" : "Alert (stopped)" }));
        }
      }
    }
  }

  // ---------- countdown ----------
  countdownState(v) {
    const cs = this.cs(),
      p = this.p,
      last = p.shown.at(-1),
      raw = p.bars.at(-1);
    v.on = false;
    if (!cs.countdown || !cs.symValue || p.replay || !last || !raw || !p.main) return;
    const sec = parseTf(p.cfg.tf).seconds;
    let end = raw.time + sec;
    if (/M$/.test(p.cfg.tf)) {
      const d = new Date(raw.time * 1000);
      end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + (parseInt(p.cfg.tf, 10) || 1), d.getUTCDate()) / 1000;
    }
    const rem = Math.floor(end - Date.now() / 1000);
    if (rem <= 0 || rem > sec * 1.05 + 86400 * 3) return;
    const y = p.main.priceToCoordinate(last.close);
    if (y == null) return;
    const d = Math.floor(rem / 86400),
      h = Math.floor((rem % 86400) / 3600),
      m = Math.floor((rem % 3600) / 60),
      s = rem % 60;
    v.text = d ? `${d}d ${h}h` : h ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    const prev = p.shown.at(-2);
    const up = cs.prevClose && prev ? last.close >= prev.close : last.close >= last.open;
    v.bg = cs.symLineColor || (up ? cs.bodyUp : cs.bodyDown);
    // black on a light label (a white symbol line), white on a dark one, as the price label does
    v.fg = textOn(v.bg);
    v.y = y + Math.round((cs.scaleFontSize || 12) * 1.5) + 2;
    v.on = true;
  }

  // ---------- watermark ----------
  watermark() {
    const cs = this.cs(),
      p = this.p,
      show = cs.watermark === "visible" || (cs.watermark === "replay" && !!p.replay);
    if (!show) {
      if (this.wm) {
        try {
          this.wm.detach();
        } catch {
          /* pane gone */
        }
        this.wm = null;
      }
      return;
    }
    const color = colorOf(cs, "watermarkColor"),
      name = p.app.symbolName?.(this.sym);
    const lines = [{ text: `${ticker(this.sym)}, ${p.cfg.tf}`, color, fontSize: 64, fontStyle: "600" }, ...(name ? [{ text: name, color, fontSize: 20 }] : [])];
    if (this.wm) this.wm.applyOptions({ lines });
    else this.wm = LW.createTextWatermark(p.chart.panes()[0], { horzAlign: "center", vertAlign: "center", lines });
  }

  // ---------- price to bar ratio ----------
  currentRatio() {
    const p = this.p,
      r = p.chart.timeScale().getVisibleLogicalRange(),
      vr = p.main?.priceScale().getVisibleRange?.(),
      h = p.chart.panes()[0]?.getHeight();
    if (!r || !vr || !h) return 0;
    const spacing = p.chart.timeScale().width() / Math.max(1, r.to - r.from);
    return Number((((vr.to - vr.from) / h) * spacing).toPrecision(6));
  }
  lockRatio() {
    const cs = this.cs(),
      p = this.p;
    if (!cs.lockRatio || p.cfg.log || !p.main || !(cs.lockRatioValue > 0)) return;
    const ts = p.chart.timeScale(),
      r = ts.getVisibleLogicalRange(),
      ps = p.main.priceScale(),
      vr = ps.getVisibleRange?.(),
      h = p.chart.panes()[0]?.getHeight();
    if (!r || !vr || !h) return;
    const spacing = ts.width() / Math.max(1, r.to - r.from),
      span = (h * cs.lockRatioValue) / spacing,
      mid = (vr.from + vr.to) / 2;
    if (Math.abs(vr.to - vr.from - span) <= span * 1e-6) return;
    this.ratioLocked = true;
    ps.setVisibleRange({ from: mid - span / 2, to: mid + span / 2 });
  }

  // ---------- economic events and news ----------
  async loadEvents() {
    const cs = this.cs(),
      sym = this.sym,
      items = [];
    const now = Date.now() / 1000;
    if (cs.econEvents && !sym.startsWith("SPREAD:")) {
      const cur = eventCurrency(sym);
      for (const r of (await calendar()) || []) {
        if (r.country !== cur || !/High|Medium/.test(r.impact)) continue;
        const t = Date.parse(r.date) / 1000;
        if (!Number.isFinite(t) || (cs.onlyFuture && t < now)) continue;
        items.push({ kind: "econ", time: t, r, color: r.impact === "High" ? SELL : "#ff9800" });
      }
    }
    if (cs.latestNews && !sym.startsWith("SPREAD:")) {
      const news = ((await newsOf(sym)) || []).filter((n) => n.time).sort((a, b) => b.time - a.time);
      for (const n of news.slice(0, 3)) items.push({ kind: "news", time: n.time / 1000, n, color: "#9c27b0" });
      if (!this.seenNews) this.seenNews = new Set(news.map((n) => n.url));
    }
    if (sym !== this.sym) return;
    this.evItems = items;
    this.events.req?.();
  }
  // A toast when a new headline arrives for the active chart's symbol.
  async watchNews() {
    const cs = this.cs(),
      p = this.p;
    if (!cs.newsNotify || p !== p.app.active || this.sym.startsWith("SPREAD:")) return;
    const sym = this.sym,
      news = (await newsOf(sym, 60000)) || [];
    if (sym !== this.sym) return;
    if (!this.seenNews) return (this.seenNews = new Set(news.map((n) => n.url)));
    for (const n of news.filter((x) => !this.seenNews.has(x.url)).slice(0, 3)) {
      this.seenNews.add(n.url);
      const el = p.app.toast(`<b>${esc(ticker(sym))} news</b><br>${esc(n.title)}`, "news", 12000);
      el.style.cursor = "pointer";
      el.onclick = () => openLink(n.url);
    }
    if (cs.latestNews) this.loadEvents();
  }
  hitEvent(e) {
    if (!e?.point || (e.paneIndex ?? 0) !== 0) return null;
    let best = null,
      d = 10;
    for (const it of this.evItems) {
      if (it.sx == null) continue;
      const dd = Math.hypot(it.sx - e.point.x, it.sy - e.point.y);
      if (dd < d) {
        d = dd;
        best = it;
      }
    }
    return best;
  }
  eventTip(e) {
    const tip = this.$(".cx-tip"),
      it = this.hitEvent(e),
      g = this.g;
    this.hovered = it;
    if (!it || !g) return (tip.hidden = true);
    // in the chart's time zone and date format, like the crosshair
    const cs = this.cs(),
      wall = it.time + tzOffset(this.p.zone, it.time),
      when = `${fmtDate(wall, cs.dateFormat, true)} ${fmtClock(wall, cs.hours === "12")}`;
    tip.innerHTML =
      it.kind === "econ"
        ? `<b>${esc(it.r.country)} · ${esc(it.r.title)}</b><span>${esc(when)} · ${esc(it.r.impact)} impact</span>${it.r.forecast || it.r.previous ? `<span>${it.r.forecast ? `Forecast ${esc(it.r.forecast)}` : ""}${it.r.forecast && it.r.previous ? " · " : ""}${it.r.previous ? `Previous ${esc(it.r.previous)}` : ""}</span>` : ""}<i>Click for the calendar</i>`
        : `<b>${esc(it.n.title)}</b><span>${esc(it.n.source || "")} · ${esc(ago(it.n.time))}</span><i>Click to read</i>`;
    tip.hidden = false;
    const w = tip.offsetWidth;
    tip.style.left = `${Math.max(4, Math.min(g.plotX + it.sx - w / 2, g.plotX + g.plotW - w - 4))}px`;
    tip.style.top = `${(g.panes[0]?.top || 0) + it.sy - tip.offsetHeight - 14}px`;
  }
  click(e) {
    if (this.p.app.tool !== "cursor") return;
    const it = this.hitEvent(e);
    if (!it) return;
    if (it.kind === "news") openLink(it.n.url);
    else this.p.app.panels?.showSide?.("calendar");
  }

  // ---------- snapshots ----------
  // Paper lines and fill arrows go into the saved image only with that setting on; their labels
  // are painted in, since they're page elements rather than chart drawing.
  beforeShot() {
    if (this.cs().inSnapshots) return false;
    this.hideForShot = true;
    this.tradeLines.hidden = true;
    this.tradeLines.updateAllViews();
    this.tradeLines.req?.();
    this.p.refreshMarkers?.();
    return true;
  }
  afterShot() {
    this.hideForShot = false;
    this.tradeLines.hidden = false;
    this.tradeLines.updateAllViews();
    this.tradeLines.req?.();
    this.p.refreshMarkers?.();
  }
  paintBoxes(ctx, chartRect) {
    if (!this.cs().inSnapshots) return;
    ctx.save();
    ctx.font = "600 11px -apple-system, Segoe UI, Roboto, sans-serif";
    for (const el of this.boxes.values()) {
      if (el.hidden) continue;
      const r = el.getBoundingClientRect(),
        x = r.left - chartRect.left,
        y = r.top - chartRect.top;
      ctx.fillStyle = getComputedStyle(el).getPropertyValue("--c") || BUY;
      ctx.fillRect(x, y, r.width, r.height);
      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "middle";
      ctx.fillText([...el.querySelectorAll("span")].map((s) => s.textContent).join("  "), x + 6, y + r.height / 2);
    }
    ctx.restore();
  }
}

// Black or white text for a label colour, by the chart library's own rule for its price labels
// (a weighted brightness above 160 of 255 takes black).
export function textOn(color) {
  const c = String(color || "").trim();
  let r, g, b;
  const hex = /^#([0-9a-f]{3,8})$/i.exec(c);
  if (hex) {
    const h = hex[1].length <= 4 ? hex[1].replace(/./g, (x) => x + x) : hex[1];
    [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  } else {
    const m = /rgba?\(([^)]+)\)/i.exec(c);
    if (!m) return "#ffffff";
    [r, g, b] = m[1].split(",").map((x) => parseFloat(x));
  }
  return 0.199 * r + 0.687 * g + 0.114 * b > 160 ? "#000000" : "#ffffff";
}

// ---------- tooltips ----------
let tipEl = null;
function showTip(btn) {
  hideTip();
  const keys = (btn.dataset.keys || "")
    .split("+")
    .filter(Boolean)
    .map((k) => (k === "mod" ? `<kbd>${MAC ? "⌘" : "Ctrl"}</kbd>` : /^(Alt|Shift|Ctrl|⌥|⇧)$/.test(k) ? `<kbd>${esc(k)}</kbd>` : esc(k)))
    .join(" + ");
  tipEl = document.createElement("div");
  tipEl.className = "tv-tip";
  tipEl.innerHTML = `<span>${esc(btn.dataset.tip)}</span>${keys ? `<i class="tv-tip-sep"></i><span class="tv-tip-keys">${keys}</span>` : ""}`;
  document.body.appendChild(tipEl);
  const r = btn.getBoundingClientRect(),
    w = tipEl.offsetWidth,
    h = tipEl.offsetHeight;
  tipEl.style.left = `${Math.max(4, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 4))}px`;
  tipEl.style.top = `${r.top - h - 8 > 4 ? r.top - h - 8 : r.bottom + 8}px`;
  tipEl._for = btn;
}
function hideTip() {
  tipEl?.remove();
  tipEl = null;
}

// The status line's market dot: open, pre-market, post-market or closed, from the exchange's hours.
export function marketState(symbol, tzOffset) {
  const ex = exchange(symbol);
  if (CRYPTO.includes(ex)) return { cls: "open", tip: "Market open · crypto trades around the clock" };
  const now = Date.now() / 1000;
  const wall = (tz) => {
    const d = new Date((now + tzOffset(tz, now)) * 1000);
    return { day: d.getUTCDay(), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
  };
  if (ex === "US" || ex === "YAHOO") {
    const { day, min } = wall("America/New_York");
    if (day === 0 || day === 6) return { cls: "closed", tip: "Market closed (weekend)" };
    if (min >= 570 && min < 960) return { cls: "open", tip: "Market open" };
    if (min >= 240 && min < 570) return { cls: "pre", tip: "Pre-market" };
    if (min >= 960 && min < 1200) return { cls: "post", tip: "Post-market" };
    return { cls: "closed", tip: "Market closed" };
  }
  if (ex === "FX") {
    const { day, min } = wall("America/New_York");
    const open = !(day === 6 || (day === 5 && min >= 1020) || (day === 0 && min < 1020));
    return open ? { cls: "open", tip: "Market open" } : { cls: "closed", tip: "Market closed (weekend)" };
  }
  if (ex === "CME") {
    const { day, min } = wall("America/Chicago");
    const weekend = day === 6 || (day === 5 && min >= 960) || (day === 0 && min < 1020);
    if (weekend) return { cls: "closed", tip: "Market closed (weekend)" };
    if (min >= 960 && min < 1020) return { cls: "closed", tip: "Daily break (4 to 5 pm Chicago)" };
    return { cls: "open", tip: "Market open" };
  }
  return null;
}

