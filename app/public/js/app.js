import { api, download, esc, ticker, exchange } from "./api.js";
import { ChartPane, CHART_TYPES, newUid } from "./chart.js";
import { TOOLS, TOOL_BY_ID, TOOL_GROUPS, GROUP_OF, SHORTCUTS } from "./drawings.js";

const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
// Shortcuts are a letter, or "Shift+" and a letter, with Option (Alt).
const keyLabel = (k) => (MAC ? `⌥ ${k.replace("Shift+", "⇧ ")}` : `Alt+${k}`);
const SHORTCUT_TOOL = Object.fromEntries(Object.entries(SHORTCUTS).map(([id, k]) => [k.replace(/(\w)$/, "Key$1"), id]));
// The cursor menu: label and icon for each pointer style.
const CURSORS = {
  cross: ["Cross", '<svg viewBox="0 0 24 24"><path d="M12 3v7M12 14v7M3 12h7M14 12h7"/></svg>'],
  dot: ["Dot", '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/></svg>'],
  arrow: ["Arrow", '<svg viewBox="0 0 24 24"><path d="M6 3.5l12.5 7.2-5.6 1.6-2.3 5.6z"/></svg>'],
  demo: ["Demonstration", '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M9.5 7.5l7 3.8-3.2 1.1-1.3 3.3z"/></svg>'],
  magic: ["Magic", '<svg viewBox="0 0 24 24"><path d="M4 20L14.5 9.5M13 6.5l4.5 4.5M17 3v2.5M20.5 6.5H18M19.5 3.5L18 5M10 3.5v2M20.5 13.5h-2"/></svg>'],
};
// The presenting cursors: a ring that follows the pointer and ripples on a click (Demonstration),
// or a short glowing trail that fades (Magic). Drawn on one see-through layer over the page.
class CursorFx {
  constructor(app) {
    this.app = app;
    this.mode = null;
    this.trail = [];
    this.ripples = [];
    this.cv = document.createElement("canvas");
    this.cv.className = "cursor-fx";
    document.body.appendChild(this.cv);
    const over = (e) => e.target.closest?.(".pane .chart");
    document.addEventListener("pointermove", (e) => {
      this.at = this.mode && over(e) ? { x: e.clientX, y: e.clientY } : null;
      if (this.at && this.mode === "magic") this.trail.push({ ...this.at, t: performance.now() });
      this.kick();
    });
    document.addEventListener("pointerdown", (e) => {
      if (this.mode === "demo" && over(e)) this.ripples.push({ x: e.clientX, y: e.clientY, t: performance.now() });
      this.kick();
    });
  }
  kick() {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame());
  }
  frame() {
    this.raf = 0;
    const cv = this.cv, dpr = devicePixelRatio || 1, now = performance.now();
    if (cv.width !== innerWidth * dpr || cv.height !== innerHeight * dpr) {
      cv.width = innerWidth * dpr;
      cv.height = innerHeight * dpr;
    }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    this.trail = this.trail.filter((p) => now - p.t < 700);
    this.ripples = this.ripples.filter((r) => now - r.t < 600);
    if (this.mode === "magic" && this.trail.length > 1) {
      ctx.lineCap = ctx.lineJoin = "round";
      for (let i = 1; i < this.trail.length; i++) {
        const p = this.trail[i - 1], q = this.trail[i], life = 1 - (now - q.t) / 700;
        ctx.strokeStyle = `rgba(255, 152, 0, ${0.9 * life})`;
        ctx.lineWidth = 2 + 4 * life;
        ctx.shadowColor = "rgba(255, 200, 80, 0.9)";
        ctx.shadowBlur = 10 * life;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }
    if (this.mode === "demo") {
      for (const r of this.ripples) {
        const k = (now - r.t) / 600;
        ctx.strokeStyle = `rgba(124, 77, 255, ${0.6 * (1 - k)})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(r.x, r.y, 18 + 26 * k, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (this.at) {
        ctx.fillStyle = "rgba(124, 77, 255, 0.22)";
        ctx.strokeStyle = "rgba(124, 77, 255, 0.75)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(this.at.x, this.at.y, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(124, 77, 255, 0.95)";
        ctx.beginPath();
        ctx.arc(this.at.x, this.at.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (this.trail.length || this.ripples.length) this.kick();
  }
}
// Icons for the switches at the bottom of the drawing bar.
const BAR = Object.fromEntries(
  Object.entries({
    magnet: '<path d="M5.5 4h4v8a2.5 2.5 0 0 0 5 0V4h4v8a6.5 6.5 0 0 1-13 0zM5.5 8h4M14.5 8h4"/>',
    magnetStrong: '<path d="M5.5 4h4v8a2.5 2.5 0 0 0 5 0V4h4v8a6.5 6.5 0 0 1-13 0zM5.5 8h4M14.5 8h4M2.5 3l1.5 1.5M21.5 3L20 4.5M12 1v2"/>',
    keep: '<path d="M4 20l1-4 9-9 3 3-9 9zM12 9l3 3"/><rect x="15.5" y="15" width="6" height="5" rx="1"/><path d="M17 15v-1.5a1.5 1.5 0 0 1 3 0V15"/>',
    lock: '<rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 7.8-1.2M12 15v2"/>',
    lockShut: '<rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11M12 15v2"/>',
    hide: '<path d="M2.5 11s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6zM9.2 11a2.8 2.8 0 1 0 5.6 0 2.8 2.8 0 1 0-5.6 0M14 19.5c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0"/>',
    eyeOff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 9.5 6 9.5 6a16 16 0 0 1-3 3.6M6.6 6.6A16 16 0 0 0 2.5 11s3.5 6 9.5 6a9.6 9.6 0 0 0 4.5-1.1"/>',
    sync: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    zoomout: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5l5 5M8 10.5h5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  }).map(([k, v]) => [k, `<svg viewBox="0 0 24 24">${v}</svg>`]),
);
import {
  INDICATORS,
  BY_ID,
  registerIndicator,
  compute,
} from "../lib/indicators.js";
import { parseTf, toCsv } from "../lib/series.js";
import { initPanels } from "./panels.js";
import { DrawToolbar } from "./drawtoolbar.js";
import { emojiPanel } from "./emojis.js";
import { openChartSettings, CHART_DEFAULTS, THEME_KEYS, playSound } from "./chartsettings.js";
import { watchUpdates } from "./updates.js";
import { openSymbolSearch as openSearchDialog } from "./symbolsearch.js";
import { IntervalMenu } from "./intervals.js";
import { ChartTypeMenu } from "./charttypes.js";
import { RangeBar } from "./rangebar.js";
import { Copilot } from "./copilot.js";
import { openIndicatorDialog, openFavoritesMenu } from "./indicatorpicker.js";
import { openIndicatorSettings as openIndSettings } from "./indsettings.js";
import { PineEditor } from "./pineeditor.js";
import { Layouts, IndicatorTemplates } from "./layouts.js";

const $ = (s, el = document) => el.querySelector(s);
const LAYOUTS = { 1: 1, "2v": 2, "2h": 2, 3: 3, 4: 4, 6: 6, 8: 8, 16: 16 };
// in menu order (an object would put the numbered ones first)
const LAYOUT_NAMES = [["1", "1 chart"], ["2v", "2 side by side"], ["2h", "2 stacked"], ["3", "3 charts"], ["4", "4 charts"], ["6", "6 charts"], ["8", "8 charts"], ["16", "16 charts"]];
// A layout's icon: a landscape screen split the way its charts are laid out. The button itself
// always shows the screen split in the middle.
function layoutIcon(id) {
  const L = 3.5, R = 20.5, T = 6.5, B = 17.5, my = 12;
  const v = (x) => `M${x} ${T}V${B}`,
    h = (y, x0 = L) => `M${x0} ${y}H${R}`,
    cols = (k) => Array.from({ length: k - 1 }, (_, i) => v(L + ((R - L) * (i + 1)) / k));
  const lines = { "2v": [v(12)], "2h": [h(my)], 3: [v(14.83), h(my, 14.83)], 4: [v(12), h(my)], 6: [...cols(3), h(my)], 8: [...cols(4), h(my)], 16: [...cols(4), h(9.25), h(my), h(14.75)] }[id] || [];
  return `<svg viewBox="0 0 24 24"><rect x="${L}" y="${T}" width="${R - L}" height="${B - T}" rx="1.5"/>${lines.length ? `<path d="${lines.join("")}"/>` : ""}</svg>`;
}
const DEFAULT_WATCHLISTS = {
  Main: [
    "BINANCE:BTCUSDT",
    "BINANCE:ETHUSDT",
    "BINANCE:SOLUSDT",
    "US:AAPL",
    "US:NVDA",
    "US:SPY",
    "US:QQQ",
    "FX:EURUSD",
  ],
};

class App {
  constructor() {
    this.panes = [];
    this.active = null;
    this.tool = "cursor";
    this.prices = {};
    this.priceListeners = new Set();
    this.saveTimer = null;
  }

  async init() {
    let state = {};
    try {
      state = await api.get("/api/state");
    } catch {
      /* first run */
    }
    this.state = {
      layout: "1",
      panes: [
        {
          symbol: "BINANCE:BTCUSDT",
          tf: "1D",
          type: "candles",
          indicators: [
            { uid: newUid(), id: "ema", params: { length: 21 } },
            { uid: newUid(), id: "rsi", params: {} },
          ],
        },
      ],
      watchlists: DEFAULT_WATCHLISTS,
      activeWatchlist: "Main",
      drawings: {},
      settings: {},
      paper: null,
      strategies: {},
      ...state,
    };
    this.settings = {
      theme: "dark",
      volume: true,
      bars: 3000,
      utc: false,
      stayInDrawMode: false,
      syncCrosshair: false,
      ...this.state.settings,
    };
    // The chart Settings dialog's values, with defaults for anything new. The old "Time axis: UTC"
    // switch becomes the UTC time zone.
    const chartCfg = this.settings.chart || {};
    if (!this.settings.chart && this.settings.utc) chartCfg.timezone = "Etc/UTC";
    this.settings.chart = { ...structuredClone(CHART_DEFAULTS), ...chartCfg };
    delete this.settings.utc;
    this.state.settings = this.settings;
    document.documentElement.dataset.theme = this.settings.theme;
    await this.loadCustomIndicators();
    // saved Pine scripts join the indicator list before any chart asks for them
    this.pineEditor = new PineEditor(this);
    this.pineEditor.registerAll();
    this.buildToolbar();
    this.drawToolbar = new DrawToolbar(this);
    this.buildDrawbar();
    this.setLayout(this.state.layout, false);
    // AskCharts AI's panel on the right toolbar (its key and model live on the server)
    this.copilot = new Copilot(this);
    this.panels = initPanels(this);
    this.layouts = new Layouts(this);
    this.layouts.render();
    this.indTemplates = new IndicatorTemplates(this);
    this.bindKeys();
    this.listenAlerts();
    this.refreshAlerts();
    this.checkHealth();
    setInterval(() => this.checkHealth(), 60000);
  }

  // ---------- persistence ----------
  persist() {
    this.layouts?.changed();
    this.state.panes = this.panes.map((p) => p.cfg);
    this.state.active = this.panes.indexOf(this.active);
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(
      () =>
        api
          .put("/api/state", this.state)
          .catch((e) => this.toast(`Couldn't save: ${esc(e.message)}`, "err")),
      400,
    );
  }
  // A new drawing starts from the look saved as this tool's default (the toolbar's Template menu).
  drawingDefaults(type) {
    const def = this.settings.drawDefaults?.[type];
    const out = def ? structuredClone(def) : {};
    // what was picked in the Icons panel
    if (this.pendingGlyph?.type === type) out.text = this.pendingGlyph.value;
    return out;
  }

  getDrawings(symbol) {
    return structuredClone(this.state.drawings[symbol] || []);
  }
  saveDrawings(symbol, items) {
    this.state.drawings[symbol] = items.map(
      ({ id, type, points, text, color, rr, style, locked, hidden, table, image, imgSize, url, pane }) => ({
        id,
        type,
        points,
        text,
        color,
        rr,
        style,
        locked,
        hidden,
        table,
        image,
        imgSize,
        url,
        pane,
      }),
    );
    // `symbol` is the chart's drawing key: the symbol, plus the currency on a converted chart
    for (const p of this.panes)
      if (p.drawKey() === symbol && p.drawings.items !== items)
        p.drawings.setItems(this.getDrawings(symbol));
    this.persist();
    this.panels?.onObjectsChange?.();
  }

  // ---------- custom indicators ----------
  async loadCustomIndicators() {
    try {
      const list = await api.get("/api/custom");
      for (const c of list) await this.importCustom(c.file, c.mtime);
    } catch {
      /* none */
    }
  }
  async importCustom(file, v = Date.now()) {
    try {
      const mod = await import(`/custom/${encodeURIComponent(file)}?v=${v}`);
      return registerIndicator({
        ...mod.default,
        id: `custom:${file.replace(/\.js$/, "")}`,
      });
    } catch (e) {
      this.toast(
        `Custom indicator ${file} failed to load: ${e.message}`,
        "err",
      );
      return null;
    }
  }

  // ---------- layout ----------
  setLayout(layout, save = true) {
    const count = LAYOUTS[layout] || 1;
    this.state.layout = String(layout);
    const grid = $("#grid");
    grid.dataset.count = count;
    const cols = {
      1: "1fr",
      2: layout === "2h" ? "1fr" : "1fr 1fr",
      3: "2fr 1fr",
      4: "1fr 1fr",
      6: "1fr 1fr 1fr",
      8: "1fr 1fr 1fr 1fr",
      16: "repeat(4, 1fr)",
    }[count];
    const rows = {
      1: "1fr",
      2: layout === "2h" ? "1fr 1fr" : "1fr",
      3: "1fr 1fr",
      4: "1fr 1fr",
      6: "1fr 1fr",
      8: "1fr 1fr",
      16: "repeat(4, 1fr)",
    }[count];
    grid.style.gridTemplateColumns = cols;
    grid.style.gridTemplateRows = rows;
    const cfgs = this.panes.length
      ? this.panes.map((p) => p.cfg)
      : this.state.panes;
    while (this.panes.length > count) this.panes.pop().destroy();
    const tfs = ["1D", "4h", "1h", "15m", "1W", "5m", "30m", "2h"];
    for (let i = 0; i < count; i++) {
      if (this.panes[i]) continue;
      const el = document.createElement("div");
      el.className = "pane";
      grid.appendChild(el);
      const base = cfgs[i] || {
        ...structuredClone(cfgs[0] || {}),
        tf: tfs[i % tfs.length],
        indicators: [],
      };
      const pane = new ChartPane(this, el, base);
      this.panes.push(pane);
      pane.load();
    }
    [...grid.children].forEach((el) => {
      if (!this.panes.some((p) => p.el === el)) el.remove();
    });
    if (count === 3) this.panes[0].el.style.gridRow = "span 2";
    else if (this.panes[0]) this.panes[0].el.style.gridRow = "";
    this.setActive(
      this.panes[Math.min(this.state.active ?? 0, count - 1)] || this.panes[0],
    );
    this.applyCursorMode();
    if (save) this.persist();
  }

  setActive(pane) {
    if (!pane || this.active === pane) return;
    this.active?.el.classList.remove("active");
    this.active = pane;
    pane.el.classList.add("active");
    this.syncToolbar();
    this.panels?.onActiveChange?.();
    this.drawToolbar?.sync();
    this.refreshDrawbar();
  }

  onPaneLoaded(pane) {
    if (pane === this.active) {
      this.syncToolbar();
      this.panels?.onActiveChange?.();
    }
  }

  // ---------- toolbar ----------
  buildToolbar() {
    // one interval button with TradingView's menu (favourites pinned beside it)
    this.intervals = new IntervalMenu(this);
    // chart type: favourite types as icons and TradingView's menu
    this.chartTypes = new ChartTypeMenu(this);
    // the date ranges, Go to date and the clock under the charts
    this.rangeBar = new RangeBar(this);
    $("#indFavBtn").onclick = (e) => openFavoritesMenu(this, e.currentTarget);
    $("#symbolBtn").onclick = () => this.openSymbolSearch();
    $("#indicatorsBtn").onclick = () => this.openIndicatorPicker();
    $("#compareBtn").onclick = () =>
      this.openSymbolSearch(
        "",
        (sym) => {
          this.active.cfg.compare.push(sym);
          this.persist();
          this.active.load({ keepView: true });
        },
        "Compare with…",
      );
    // a second click on a menu button closes its menu (heard before the menu's own outside-click close)
    addEventListener("pointerdown", (e) => {
      this.menuWasOpen = e.target.closest?.("#layoutSelBtn, #brandBtn") ? this.drawToolbar?.pop?.dataset.for : null;
    }, true);
    $("#layoutSelBtn").onclick = () => {
      if (this.menuWasOpen === "layout") return (this.menuWasOpen = null);
      this.layoutMenu();
    };
    // The logo, like TradingView's: hovering names who is signed in and the active layout, a click
    // offers Sign out. The sign-in gateway answers /session; opened directly on this computer there
    // is no account, so the logo only gives the app's name.
    const brand = $("#brandBtn");
    fetch("/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (this.account = j?.email || null))
      .catch(() => {});
    brand.onmouseenter = () => {
      brand.title = this.account ? `AskCharts\nSigned in as ${this.account}\nActive layout: ${this.layouts?.cur?.name || "Unnamed"}` : "AskCharts";
    };
    brand.onclick = () => {
      if (this.menuWasOpen === "account") return (this.menuWasOpen = null);
      if (this.account) this.accountMenu();
    };
    $("#layoutSelBtn").innerHTML = layoutIcon("2v");
    // Sync: a symbol picked on one chart goes on every chart in the layout
    const syncBtn = $("#syncBtn"),
      showSync = () => {
        const on = !!this.settings.syncSymbol;
        syncBtn.classList.toggle("on", on);
        syncBtn.title = `Sync symbol across charts: ${on ? "on" : "off"}`;
      };
    showSync();
    syncBtn.onclick = () => {
      this.settings.syncSymbol = !this.settings.syncSymbol;
      showSync();
      this.toast(this.settings.syncSymbol ? "Symbol sync on: a symbol you pick goes on every chart." : "Symbol sync off.");
      this.persist();
    };
    $("#replayBtn").onclick = () => {
      if (this.active.replay) return this.active.stopReplay();
      if (this.active.convTo()) return this.active.startReplay(0); // says why it can't
      this.setTool("replay-pick");
      this.toast("Click the bar you want replay to start from.");
    };
    $("#alertBtn").onclick = () => this.panels.openAlertDialog();
    $("#snapBtn").onclick = async () =>
      (await this.active.screenshot())
        .toBlob((b) =>
          download(
            `${ticker(this.active.cfg.symbol)}-${this.active.cfg.tf}.png`,
            b,
          ),
        );
    $("#csvBtn").onclick = () => this.exportCsv();
    $("#themeBtn").onclick = () => {
      this.settings.theme = this.settings.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = this.settings.theme;
      // as on TradingView, a theme switch puts canvas colours back to the theme's own
      for (const k of THEME_KEYS) this.settings.chart[k] = "";
      this.panes.forEach((p) => p.applyTheme());
      this.panels.onTheme?.();
      this.persist();
    };
    $("#settingsBtn").onclick = () => this.openSettings();
    // a dot on the gear when a newer AskCharts is out (Settings, Updates)
    watchUpdates($("#settingsBtn"));
  }

  syncToolbar() {
    const p = this.active;
    if (!p) return;
    $("#symbolLabel").textContent = ticker(p.cfg.symbol);
    $("#symbolBtn").title =
      `${p.cfg.symbol} — change symbol (or just start typing)`;
    this.intervals?.render();
    this.chartTypes?.render();
    this.rangeBar?.tick();
    $("#replayBtn").classList.toggle("on", !!p.replay);
  }

  // The layout button's menu: every layout with its icon, the current one marked.
  // The logo's menu: the account, the active layout and Sign out (the gateway ends the session).
  accountMenu() {
    const tb = this.drawToolbar,
      btn = $("#brandBtn");
    tb.closePopover();
    const pop = tb.openPopover(
      btn,
      `<div class="acct"><span class="acct-h">Signed in as</span><b>${esc(this.account)}</b><span class="acct-h">Active layout: ${esc(this.layouts?.cur?.name || "Unnamed")}</span></div><hr>` +
        `<button data-m="out"><svg viewBox="0 0 24 24"><path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14M10 16l4-4-4-4M14 12H4.5"/></svg><span>Sign out</span></button>`,
      "account",
    );
    pop.classList.add("dtb-list", "lt-pop", "acct-menu");
    const r = btn.getBoundingClientRect();
    pop.style.left = `${Math.max(4, r.left)}px`;
    pop.style.top = `${r.bottom + 4}px`;
    pop.onclick = (e) => {
      if (!e.target.closest('[data-m="out"]')) return;
      tb.closePopover();
      location.href = "/logout";
    };
  }

  layoutMenu() {
    const tb = this.drawToolbar,
      btn = $("#layoutSelBtn");
    if (tb.pop?.dataset.for === "layout") return tb.closePopover();
    tb.closePopover();
    const cur = String(this.state.layout);
    const pop = tb.openPopover(
      btn,
      LAYOUT_NAMES
        .map(([id, name]) => `<button data-l="${id}" class="${id === cur ? "on" : ""}">${layoutIcon(id)}<span>${name}</span></button>`)
        .join(""),
      "layout",
    );
    pop.classList.add("dtb-list", "lt-pop", "ly-menu");
    const r = btn.getBoundingClientRect();
    pop.style.left = `${Math.max(4, r.left)}px`;
    pop.style.top = `${r.bottom + 4}px`;
    pop.onclick = (e) => {
      const b = e.target.closest("[data-l]");
      if (!b) return;
      tb.closePopover();
      if (b.dataset.l !== String(this.state.layout)) this.setLayout(b.dataset.l);
    };
  }

  setTf(tf) {
    // Settings, Scales and lines: keep the chart's left edge where it was
    if (this.settings.chart.keepLeftEdge) {
      const r = this.active.chart.timeScale().getVisibleLogicalRange();
      this.active.keepLeft = r ? this.active.timeOfLogical(r.from) : null;
    }
    this.active.cfg.tf = tf;
    const loaded = this.active.load();
    this.syncToolbar();
    this.persist();
    return loaded;
  }

  setSymbol(sym, pane = this.active) {
    const targets = this.settings.syncSymbol ? this.panes : [pane];
    for (const p of targets) {
      p.cfg.symbol = sym;
      // as on TradingView, a new symbol shows in its own currency
      p.cfg.currency = null;
      p.cfg.compare = p.cfg.compare.filter((s) => s !== sym);
      p.load();
    }
    this.syncToolbar();
    this.persist();
  }

  // TradingView's drawing bar: the cursor, the tool groups (each button shows the last tool used;
  // the tab beside it opens the group's menu), the Icons panel, then Measure and Zoom, then the
  // magnet, keep drawing, lock, hide and sync switches, and Remove.
  buildDrawbar() {
    const bar = $("#drawbar");
    const icon = (id) => `<svg viewBox="0 0 24 24">${TOOL_BY_ID[id].icon}</svg>`;
    const tab = (gid, label) => `<button class="dg-more" data-more="${gid}" title="${esc(label)}"><svg viewBox="0 0 24 24"><path d="M10 7l5 5-5 5"/></svg></button>`;
    const sw = (act, label, gid, menu) => `<div class="dgroup" data-group="${gid}"><button data-act="${act}" title="${esc(label)}">${BAR[act]}</button>${menu ? tab(gid, menu) : ""}</div>`;
    const cur = this.tool === "eraser" ? "eraser" : "cursor";
    bar.innerHTML =
      `<div class="dgroup" data-group="cursor"><button data-tool="${cur}" title="${cur === "eraser" ? "Eraser" : CURSORS[this.cursorMode()][0]}">${cur === "eraser" ? icon("eraser") : CURSORS[this.cursorMode()][1]}</button>${tab("cursor", "Cursors")}</div>` +
      TOOL_GROUPS.map((g) => {
        // the Icons button opens its panel rather than a menu
        if (g.picker) return `<div class="dgroup" data-group="${g.id}"><button data-more="${g.id}" title="${esc(g.label)}"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.5c1 1.4 2.2 2 3.5 2s2.5-.6 3.5-2M9 9.5v.5M15 9.5v.5"/></svg></button></div>`;
        const id = this.groupTool(g);
        return `<div class="dgroup" data-group="${g.id}"><button data-tool="${id}" title="${this.toolTitle(id)}">${icon(id)}</button>${tab(g.id, g.label)}</div>`;
      }).join("") +
      "<hr>" +
      `<button data-tool="ruler" title="Measure (or Shift + click on the chart)">${icon("ruler")}</button>` +
      `<button data-tool="zoom" title="Zoom in">${icon("zoom")}</button>` +
      `<button data-act="zoomout" class="hidden" title="Zoom out">${BAR.zoomout}</button>` +
      "<hr>" +
      sw("magnet", "Magnet", "magnet", "Magnet mode") +
      sw("keep", "Keep drawing", "keep") +
      sw("lock", "Lock all drawings", "lock", "Lock options") +
      sw("hide", "Hide all drawings", "hide", "Hide options") +
      sw("sync", "Sync drawings", "sync", "Sync options") +
      "<hr>" +
      sw("trash", "Remove objects", "trash", "Remove options");
    bar.onclick = (e) => {
      const more = e.target.closest("[data-more]");
      if (more) return this.toggleToolMenu(more.dataset.more);
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.tool) this.setTool(this.tool === b.dataset.tool ? "cursor" : b.dataset.tool);
      const s = this.settings,
        act = b.dataset.act;
      if (act === "trash") return this.toggleToolMenu("trash");
      if (act === "zoomout") return this.zoomOut();
      if (act === "magnet") s.magnetOn = !s.magnetOn;
      if (act === "keep") s.stayInDrawMode = !s.stayInDrawMode;
      if (act === "lock") s.lockDrawings = !s.lockDrawings;
      if (act === "hide") s.hideDrawings = !s.hideDrawings;
      if (act === "sync") s.drawingSync = this.syncMode() === "off" ? "layout" : "off";
      if (act) this.drawbarChanged();
    };
    this.setTool("cursor");
    this.refreshDrawbar();
  }

  syncMode() {
    return this.settings.drawingSync || "layout";
  }

  cursorMode() {
    return CURSORS[this.settings.cursorMode] ? this.settings.cursorMode : "cross";
  }

  // Cross, dot, arrow, demonstration or magic: the pointer over the charts, the crosshair lines,
  // and the presenting effects (a ring that follows the pointer, or a fading trail).
  applyCursorMode() {
    const mode = this.cursorMode(),
      lines = mode === "cross" || mode === "dot";
    document.body.classList.remove(...Object.keys(CURSORS).map((k) => `cur-${k}`), "cur-eraser");
    document.body.classList.add(this.tool === "eraser" ? "cur-eraser" : `cur-${mode}`);
    for (const p of this.panes) p.chart.applyOptions({ crosshair: p.crosshairOptions() });
    this.fx ||= new CursorFx(this);
    this.fx.mode = this.tool === "cursor" ? mode : null;
    const btn = $('#drawbar .dgroup[data-group="cursor"] [data-tool]');
    if (btn && this.tool !== "eraser") {
      btn.dataset.tool = "cursor";
      btn.title = CURSORS[mode][0];
      btn.innerHTML = CURSORS[mode][1];
    }
    if (btn && this.tool === "eraser") {
      btn.dataset.tool = "eraser";
      btn.title = "Eraser";
      btn.innerHTML = `<svg viewBox="0 0 24 24">${TOOL_BY_ID.eraser.icon}</svg>`;
    }
  }

  // A drawing is locked by its own lock, or by "Lock drawings" on the left.
  isLocked(d) {
    return !!d?.locked || !!this.settings.lockDrawings;
  }

  // After a switch on the drawing bar: redraw every chart, refresh the bar, save.
  drawbarChanged() {
    this.refreshDrawbar();
    for (const p of this.panes) {
      p.render(false);
      p.drawings.update();
    }
    if (this.drawToolbar?.d) this.drawToolbar.render();
    this.panels?.onObjectsChange?.();
    this.persist();
  }

  refreshDrawbar() {
    const s = this.settings,
      set = (act, on, icon) => {
        const b = $(`#drawbar [data-act="${act}"]`);
        if (!b) return;
        b.classList.toggle("active", !!on);
        if (icon && b.dataset.icon !== icon) {
          b.dataset.icon = icon;
          b.innerHTML = BAR[icon];
        }
      };
    set("magnet", s.magnetOn, s.magnetMode === "strong" ? "magnetStrong" : "magnet");
    set("keep", s.stayInDrawMode);
    set("lock", s.lockDrawings, s.lockDrawings ? "lockShut" : "lock");
    set("hide", s.hideDrawings, s.hideDrawings ? "eyeOff" : "hide");
    set("sync", this.syncMode() !== "off", this.syncMode() === "global" ? "globe" : "sync");
    $('#drawbar [data-act="zoomout"]')?.classList.toggle("hidden", !this.active?.zoomStack?.length);
  }

  // Zoom out: back to the view before the last Zoom in, its prices too (auto scale back on if it was).
  zoomOut() {
    const p = this.active,
      r = p?.zoomStack?.pop();
    if (r) {
      p.chart.timeScale().setVisibleLogicalRange(r.time || r);
      const ps = p.main?.priceScale();
      if (ps && r.time) {
        if (r.auto) ps.applyOptions({ autoScale: true });
        else if (r.price) p.setPriceRange(r.price);
      }
    }
    this.refreshDrawbar();
  }

  // Menus for the magnet, lock, hide, sync and remove buttons, in TradingView's words.
  actionMenu(gid) {
    const s = this.settings,
      p = this.active,
      box = $(`#drawbar .dgroup[data-group="${gid}"]`),
      m = document.createElement("div");
    m.className = "tool-menu am-menu";
    m.dataset.group = gid;
    const item = (k, label, on, icon = "") => `<button data-k="${k}" class="${on ? "on" : ""}">${icon ? `<span class="am-icon">${icon}</span>` : ""}<span>${esc(label)}</span>${on ? `<span class="am-check">${BAR.check}</span>` : ""}</button>`;
    const toggle = (k, label, on) => `<button data-k="${k}" class="am-toggle"><span>${esc(label)}</span><i class="${on ? "on" : ""}"></i></button>`;
    const draw = () => {
      const pid = p?.cfg.pid,
        mine = (p?.drawings.items || []).filter((d) => !(d.pane && d.pane !== pid)),
        nd = mine.filter((d) => s.removeLocked || !this.isLocked(d)).length,
        ni = p?.cfg.indicators.length || 0,
        n = (k, one) => `${k} ${one}${k === 1 ? "" : "s"}`;
      if (gid === "cursor")
        m.innerHTML =
          Object.entries(CURSORS).map(([k, [label, ic]]) => item(`cur:${k}`, label, this.tool === "cursor" && this.cursorMode() === k, ic)).join("") +
          "<hr>" + item("eraser", "Eraser", this.tool === "eraser", `<svg viewBox="0 0 24 24">${TOOL_BY_ID.eraser.icon}</svg>`) +
          "<hr>" + toggle("vtip", "Values tooltip on long press", s.valuesTooltip !== false);
      if (gid === "magnet")
        m.innerHTML = item("weak", "Weak magnet", s.magnetOn && s.magnetMode !== "strong", BAR.magnet) + item("strong", "Strong magnet", s.magnetOn && s.magnetMode === "strong", BAR.magnetStrong) + "<hr>" + toggle("snapind", "Snap to indicators", s.magnetIndicators);
      if (gid === "lock") m.innerHTML = item("ld", "Lock drawings", s.lockDrawings) + item("li", "Lock indicators", s.lockIndicators) + item("la", "Lock all", s.lockDrawings && s.lockIndicators);
      if (gid === "hide")
        m.innerHTML = item("hd", "Hide drawings", s.hideDrawings) + item("hi", "Hide indicators", s.hideIndicators) + item("hp", "Hide positions and orders", s.hidePositions) + item("ha", "Hide all", s.hideDrawings && s.hideIndicators && s.hidePositions);
      if (gid === "sync") m.innerHTML = item("layout", "New drawings sync in layout", this.syncMode() === "layout", BAR.sync) + item("global", "New drawings sync globally", this.syncMode() === "global", BAR.globe);
      if (gid === "trash")
        m.innerHTML = item("rd", `Remove ${n(nd, "drawing")}`, false) + item("ri", `Remove ${n(ni, "indicator")}`, false) + item("ra", `Remove ${n(nd, "drawing")} & ${n(ni, "indicator")}`, false) + "<hr>" + toggle("rlocked", "Always remove locked drawings", s.removeLocked);
    };
    draw();
    document.body.appendChild(m);
    const r = box.getBoundingClientRect(),
      top = Math.max(8, Math.min(r.top, innerHeight - 8 - m.offsetHeight));
    m.style.left = `${r.right + 14}px`;
    m.style.top = `${top}px`;
    box.classList.add("open");
    m.onclick = (e) => {
      const k = e.target.closest("[data-k]")?.dataset.k;
      if (!k) return;
      // switches inside the menu flip in place and leave it open
      if (k === "snapind" || k === "rlocked" || k === "vtip") {
        if (k === "snapind") s.magnetIndicators = !s.magnetIndicators;
        else if (k === "vtip") s.valuesTooltip = s.valuesTooltip === false;
        else s.removeLocked = !s.removeLocked;
        draw();
        return this.persist();
      }
      this.closeToolMenu();
      if (k.startsWith("cur:")) {
        s.cursorMode = k.slice(4);
        this.setTool("cursor");
        return this.persist();
      }
      if (k === "eraser") return this.setTool("eraser");
      if (k === "weak" || k === "strong") {
        const was = s.magnetOn && (s.magnetMode === "strong") === (k === "strong");
        s.magnetMode = k;
        s.magnetOn = !was;
      }
      if (k === "ld") s.lockDrawings = !s.lockDrawings;
      if (k === "li") s.lockIndicators = !s.lockIndicators;
      if (k === "la") s.lockDrawings = s.lockIndicators = !(s.lockDrawings && s.lockIndicators);
      if (k === "hd") s.hideDrawings = !s.hideDrawings;
      if (k === "hi") s.hideIndicators = !s.hideIndicators;
      if (k === "hp") s.hidePositions = !s.hidePositions;
      if (k === "ha") s.hideDrawings = s.hideIndicators = s.hidePositions = !(s.hideDrawings && s.hideIndicators && s.hidePositions);
      if (k === "layout" || k === "global") s.drawingSync = this.syncMode() === k ? "off" : k;
      if (k === "rd" || k === "ri" || k === "ra") return this.removeObjects(p, k !== "ri", k !== "rd");
      this.drawbarChanged();
    };
    this.onMenuOutside = (e) => {
      if (!m.contains(e.target) && !e.target.closest("[data-more]") && !e.target.closest('[data-act="trash"]')) this.closeToolMenu();
    };
    document.addEventListener("pointerdown", this.onMenuOutside, true);
    this.toolMenu = m;
  }

  // Remove the chart's drawings and/or indicators, with an Undo in the message. Locked drawings
  // stay unless "Always remove locked drawings" is on.
  removeObjects(p, drawings, indicators) {
    if (!p) return;
    const before = { items: [...p.drawings.items], inds: [...p.cfg.indicators] },
      pid = p.cfg.pid,
      s = this.settings;
    let nd = 0, ni = 0;
    if (drawings) {
      const keep = p.drawings.items.filter((d) => (d.pane && d.pane !== pid) || (!s.removeLocked && this.isLocked(d)));
      nd = p.drawings.items.length - keep.length;
      p.drawings.items = keep;
      p.drawings.selected = null;
      this.saveDrawings(p.drawKey(), keep);
    }
    if (indicators && s.lockIndicators) this.toast("Indicators are locked, so they stay.");
    else if (indicators) {
      ni = p.cfg.indicators.length;
      p.cfg.indicators = [];
      p.render(false);
    }
    p.drawings.update();
    this.persist();
    this.panels?.onObjectsChange?.();
    if (!nd && !ni) return;
    const el = this.toast(`Removed ${[nd && `${nd} drawing${nd === 1 ? "" : "s"}`, ni && `${ni} indicator${ni === 1 ? "" : "s"}`].filter(Boolean).join(" and ")}. <button class="toast-undo">Undo</button>`, "", 8000);
    el.querySelector(".toast-undo").onclick = () => {
      p.drawings.items = before.items;
      p.cfg.indicators = before.inds;
      this.saveDrawings(p.drawKey(), before.items);
      p.render(false);
      p.drawings.update();
      this.persist();
      this.panels?.onObjectsChange?.();
      el.remove();
    };
  }

  groupTool(g) {
    const last = this.settings.toolGroups?.[g.id];
    return GROUP_OF[last] === g.id ? last : g.sections[0].items[0];
  }

  toolTitle(id) {
    const k = SHORTCUTS[id];
    return `${TOOL_BY_ID[id].label}${k ? ` (${keyLabel(k)})` : ""}`;
  }

  toggleToolMenu(gid) {
    const was = this.toolMenu?.dataset.group;
    this.closeToolMenu();
    if (was === gid) return;
    if (["cursor", "magnet", "lock", "hide", "sync", "trash"].includes(gid)) return this.actionMenu(gid);
    const g = TOOL_GROUPS.find((x) => x.id === gid),
      box = $(`#drawbar .dgroup[data-group="${gid}"]`);
    // Icons: pick an emoji, sticker or icon, then click the chart to place it.
    const m = g.picker
      ? emojiPanel(this, (type, value) => {
          this.closeToolMenu();
          this.pendingGlyph = { type, value };
          this.setTool(type);
        })
      : document.createElement("div");
    if (!g.picker) m.className = "tool-menu";
    m.dataset.group = gid;
    if (!g.picker) m.innerHTML = g.sections
      .map(
        (s, i) =>
          `${i ? "<hr>" : ""}${s.title ? `<div class="tm-h">${esc(s.title)}</div>` : ""}` +
          s.items
            .map((id) => `<button data-tool="${id}" class="${id === this.tool ? "on" : ""}"><svg viewBox="0 0 24 24">${TOOL_BY_ID[id].icon}</svg><span>${esc(TOOL_BY_ID[id].label)}</span>${SHORTCUTS[id] ? `<kbd>${keyLabel(SHORTCUTS[id])}</kbd>` : ""}</button>`)
            .join(""),
      )
      .join("");
    document.body.appendChild(m);
    const r = box.getBoundingClientRect(),
      top = Math.max(8, Math.min(r.top, innerHeight - 8 - m.offsetHeight));
    m.style.left = `${r.right + 14}px`;
    m.style.top = `${top}px`;
    m.style.maxHeight = `${innerHeight - top - 8}px`;
    box.classList.add("open");
    if (!g.picker)
      m.onclick = (e) => {
        const b = e.target.closest("[data-tool]");
        if (!b) return;
        this.closeToolMenu();
        this.setTool(b.dataset.tool);
      };
    this.onMenuOutside = (e) => {
      if (!m.contains(e.target) && !e.target.closest("[data-more]")) this.closeToolMenu();
    };
    document.addEventListener("pointerdown", this.onMenuOutside, true);
    this.toolMenu = m;
  }

  closeToolMenu() {
    if (!this.toolMenu) return false;
    this.toolMenu.remove();
    this.toolMenu = null;
    document.removeEventListener("pointerdown", this.onMenuOutside, true);
    document.querySelectorAll("#drawbar .dgroup.open").forEach((x) => x.classList.remove("open"));
    return true;
  }

  setTool(tool) {
    this.tool = tool;
    const gid = GROUP_OF[tool];
    document.querySelectorAll("#drawbar .dgroup").forEach((g) => g.classList.toggle("picked", g.dataset.group === gid && TOOL_GROUPS.find((x) => x.id === gid)?.picker));
    if (gid && !TOOL_GROUPS.find((x) => x.id === gid)?.picker) {
      // The group's button takes on the tool just picked; it's saved with the next save.
      (this.settings.toolGroups ||= {})[gid] = tool;
      const b = $(`#drawbar .dgroup[data-group="${gid}"] [data-tool]`);
      if (b && b.dataset.tool !== tool) {
        b.dataset.tool = tool;
        b.title = this.toolTitle(tool);
        b.innerHTML = `<svg viewBox="0 0 24 24">${TOOL_BY_ID[tool].icon}</svg>`;
      }
    }
    document
      .querySelectorAll("#drawbar [data-tool]")
      .forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
    for (const p of this.panes) p.setInteractive(tool === "cursor" || tool === "eraser");
    document.body.style.cursor = tool === "cursor" || tool === "eraser" ? "" : "crosshair";
    this.applyCursorMode();
  }

  // ---------- modals ----------
  modal(title, bodyHtml, { foot = "", wide = false } = {}) {
    const card = $("#modalCard");
    card.className = "modal-card";
    card.style.width = wide ? "min(780px, 96vw)" : "";
    card.innerHTML = `<div class="modal-head"><span>${esc(title)}</span><button data-close title="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div><div class="modal-body">${bodyHtml}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ""}`;
    $("#modal").classList.remove("hidden");
    card.querySelector("[data-close]").onclick = () => this.closeModal();
    $("#modal").onmousedown = (e) => {
      if (e.target.id === "modal") this.closeModal();
    };
    return card;
  }
  // A dialog can ask to hear about every close but its own Ok (chart Settings puts its edits back).
  closeModal() {
    const undo = this.onModalClose;
    this.onModalClose = null;
    this.drawToolbar?.closePopover();
    undo?.();
    $("#modal").classList.add("hidden");
    $("#modalCard").innerHTML = "";
  }

  openSymbolSearch(initial = "", onPick = null, title = "Symbol search") {
    openSearchDialog(this, { initial, onPick, title });
  }

  openIndicatorPicker() {
    openIndicatorDialog(this);
  }

  // From the Indicators dialog or its favourites dropdown. Anchored ones ask for a bar first.
  addIndicatorById(id) {
    const def = BY_ID[id];
    if (!def || !this.active) return;
    const uid = this.active.addIndicator(id);
    const anchor = (def.inputs || []).find((i) => i.type === "time");
    if (anchor) {
      this.closeModal();
      this.pickAnchor(this.active, uid, anchor.key);
    } else this.toast(`Added ${esc(def.name)}`);
    // a Pine strategy's report goes to the Strategy tester, as on TradingView
    if (def.strategy) this.pineEditor?.showStrategy(this.active, uid);
  }

  /** Wait for a click on the chart and anchor indicator `uid` there (Anchored VWAP). Escape keeps the current anchor. */
  pickAnchor(pane, uid, key) {
    this.pendingAnchor = { pane, uid, key };
    this.setTool("anchor-pick");
    this.toast("Click the bar to anchor it to.");
  }

  // TradingView's indicator Settings: Inputs, Style and Visibility (indsettings.js)
  openIndicatorSettings(pane, ind, tab) {
    openIndSettings(this, pane, ind, tab);
  }

  // tab: one of the dialog's tabs ("alerts", "ai"…), or the last one used
  openSettings(tab) {
    openChartSettings(this, CHART_TYPES, tab);
  }

  // Every chart, once per frame however fast the dialog changes.
  applyChartSettings() {
    if (this.csFrame) return;
    this.csFrame = requestAnimationFrame(() => {
      this.csFrame = 0;
      for (const p of this.panes) p.applySettings();
    });
  }

  // The full name for the status line ("XRP / U.S. Dollar"), looked up once per symbol.
  symbolName(sym) {
    const c = (this.names ||= {});
    if (sym in c) return c[sym];
    c[sym] = null;
    api
      .search(ticker(sym))
      .then((r) => {
        c[sym] = r.find((x) => x.symbol === sym)?.name || "";
        for (const p of this.panes)
          if (p.cfg.symbol === sym) {
            p.updateLegend();
            p.extras?.watermark();
          }
      })
      .catch(() => (c[sym] = ""));
    return null;
  }

  // Alert lines on the charts follow the alerts list.
  setAlertList(list) {
    this.alertList = list;
    for (const p of this.panes) p.extras?.alertLines();
  }
  async refreshAlerts() {
    try {
      this.setAlertList(await api.get("/api/alerts"));
    } catch {
      /* server down */
    }
  }

  syncCrosshair(src, p) {
    const utc = src.timeOfLogical(p.logical);
    for (const pane of this.panes) {
      if (pane === src || !pane.shown.length) continue;
      const l = pane.logicalOf(utc);
      const i = Math.max(0, Math.min(pane.shown.length - 1, Math.round(l)));
      const b = pane.shown[i];
      if (b) pane.chart.setCrosshairPosition(b.close, pane.times[i], pane.main);
    }
  }

  exportCsv() {
    const p = this.active;
    const extra = {};
    for (const ind of p.cfg.indicators) {
      const def = BY_ID[ind.id];
      const res = p.indResults[ind.uid] || {};
      for (const o of def?.outputs || [])
        if (Array.isArray(res[o.key])) extra[`${ind.id}_${o.key}`] = res[o.key];
    }
    download(`${ticker(p.cfg.symbol)}-${p.cfg.tf}.csv`, toCsv(p.shown, extra));
  }

  // ---------- keys ----------
  bindKeys() {
    document.addEventListener("keydown", (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(
        document.activeElement?.tagName,
      );
      if (e.key === "Escape") {
        if (this.drawToolbar?.closePopover()) return;
        if (!$("#modal").classList.contains("hidden")) return this.closeModal();
        if (this.closeToolMenu()) return;
        if (this.active?.finishOpenDrawing()) return;
        if (this.active?.drawings.ruler) {
          this.active.drawings.ruler = null;
          this.active.drawings.update();
          return;
        }
        if (this.tool !== "cursor") return this.setTool("cursor");
        if (this.active?.drawings.selected) {
          this.active.drawings.selected = null;
          this.active.drawings.update();
        }
        return;
      }
      // Option (Alt) + letter picks a drawing tool, as on TradingView. e.code, because Option
      // changes the character on a Mac.
      // Option (Alt) + A creates an alert, + G opens Go to date (TradingView's keys)
      if (e.altKey && !e.shiftKey && !e.metaKey && !e.ctrlKey && !typing && (e.code === "KeyA" || e.code === "KeyG")) {
        e.preventDefault();
        return e.code === "KeyA" ? this.panels.openAlertDialog() : this.rangeBar?.openGoTo();
      }
      const shortcut = SHORTCUT_TOOL[(e.shiftKey ? "Shift+" : "") + e.code];
      if (e.altKey && !e.metaKey && !e.ctrlKey && !typing && shortcut) {
        e.preventDefault();
        this.closeToolMenu();
        return this.setTool(shortcut);
      }
      // Ctrl/Cmd + S saves the layout; "." opens a saved one (TradingView's keys)
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "s" && !typing) {
        e.preventDefault();
        return this.layouts?.save();
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "." && $("#modal").classList.contains("hidden")) {
        e.preventDefault();
        return this.layouts?.openDialog();
      }
      if (e.key === "Enter" && this.active?.finishOpenDrawing()) return;
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        this.active?.deleteSelectedDrawing()
      ) {
        e.preventDefault();
        return;
      }
      if (!$("#modal").classList.contains("hidden")) return;
      // a number changes the interval, a letter searches for a symbol (as on TradingView)
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        this.intervals.quickChange(e.key);
      } else if (/^[a-z^]$/i.test(e.key)) {
        e.preventDefault();
        this.openSymbolSearch(e.key.toUpperCase());
      }
    });
  }

  // A drawn line as an alert condition: trend lines and rays are checked at the line's price on
  // each bar, on the server, so they fire with this tab closed.
  lineOperandFor(d) {
    const [a, b] = d.points;
    const line = (extend, label) => ({ kind: "line", label, line: { t1: a.time, p1: a.price, t2: b.time, p2: b.price, extend } });
    switch (d.type) {
      case "hline": return { kind: "value", v: Number(a.price.toPrecision(8)) };
      case "hray": return { kind: "line", label: "Horizontal ray", line: { t1: a.time, p1: a.price, t2: a.time + 1, p2: a.price, extend: "right" } };
      case "trend": return line("none", "Trend line (between its two points)");
      case "arrow": return line("none", "Arrow (between its two points)");
      case "info": return line("none", "Info line (between its two points)");
      case "cross": return { kind: "value", v: Number(a.price.toPrecision(8)) };
      case "ray": return line("right", "Ray");
      case "extended": return line("both", "Extended line");
      case "channel": return line("none", "Channel's first line");
      default: return null;
    }
  }

  alertOnSelectedDrawing() {
    const d = this.active?.drawings.selected;
    if (!d) return this.toast("Click a line on the chart first to select it.");
    const right = this.lineOperandFor(d);
    if (!right) return this.toast("Alerts work on trend lines, rays, extended and horizontal lines.");
    this.panels.openAlertDialog({ rules: [{ left: { kind: "price", field: "close" }, op: "crosses", right }] });
  }

  // ---------- replay across charts ----------
  syncReplayFrom(pane, bar) {
    if (!bar) return;
    const end = bar.time + parseTf(pane.cfg.tf).seconds;
    for (const p of this.panes) if (p !== pane && p.bars.length && !(p.replay && !p.replay.follower)) p.replayTo(end);
  }
  onReplayStart(pane) {
    if (this.settings.syncReplay && !pane.replay?.follower) this.syncReplayFrom(pane, pane.bars[pane.replay.index]);
    this.syncToolbar();
    this.panels?.onReplayChange?.();
  }
  onReplayBar(pane, bar) {
    if (this.settings.syncReplay && !pane.replay?.follower) this.syncReplayFrom(pane, bar);
    this.panels?.onReplayBar?.(pane, bar);
  }
  onReplayStop(pane) {
    for (const p of this.panes) if (p !== pane && p.replay?.follower) p.stopReplay();
    this.syncToolbar();
    this.panels?.onReplayChange?.();
  }

  // ---------- prices, alerts, status ----------
  onPrice(symbol, price) {
    this.prices[symbol] = price;
    for (const fn of this.priceListeners) fn(symbol, price);
  }

  listenAlerts() {
    const es = new EventSource("/api/events");
    // a lost live connection (the app restarting, the network) is noted once, and its return
    es.onerror = () => {
      if (this.sseLost || es.readyState === EventSource.CLOSED) return;
      this.sseLost = Date.now();
    };
    es.onopen = () => {
      if (this.sseLost && Date.now() - this.sseLost > 5000) this.panels?.notice?.("Reconnected to the app after a lost connection.", "ok");
      this.sseLost = 0;
    };
    es.addEventListener("alert", (m) => {
      const e = JSON.parse(m.data);
      // Settings, Alerts: the volume, and whether the pop-up hides itself after 20 seconds
      const cs = this.settings.chart;
      // each alert's own Notifications choices (older alerts have none: everything on)
      const n = e.notify || this.alertList?.find((a) => a.id === e.alertId)?.notify || {};
      // the server starts a named alert's text with its name, which is the title here
      const body = e.name && e.text.startsWith(`${e.name}: `) ? e.text.slice(e.name.length + 2) : e.text;
      if (n.toast !== false) this.toast(`<b>${esc(e.name || "Alert")}</b><br>${esc(body)}`, "alert", cs.autoHideToasts ? 20000 : 0);
      if (cs.alertSound && n.sound !== false) playSound(n.soundName || "ding", cs.alertVolume);
      this.refreshAlerts();
      if (n.desktop !== false && "Notification" in window && Notification.permission === "granted")
        new Notification(e.name || "AskCharts alert", { body });
      this.panels?.onAlertFired?.(e);
    });
  }

  async checkHealth() {
    try {
      const h = await api.get("/api/health");
      const failing = Object.entries(h.providers || {})
        .filter(([, v]) => !v.ok)
        .map(([k]) => k);
      this.setStatus(
        failing.length ? "warn" : "ok",
        failing.length
          ? `Some sources are failing (${failing.join(", ")}); fallbacks are in use.`
          : "All data sources responding",
      );
      this.healthNotice(failing.join(", "), failing.length ? `Some data sources are failing (${failing.join(", ")}); fallbacks are in use.` : "All data sources are responding again.");
      this.historyNotice(h.history);
    } catch {
      this.setStatus(
        "bad",
        "The local server is not responding. Is it still running?",
      );
      this.healthNotice("server", "The app's server is not responding.");
    }
  }
  // A change in data health goes to Notifications once, not every minute.
  healthNotice(key, text) {
    if (key === (this.healthKey ?? "")) return;
    this.healthKey = key;
    this.panels?.notice?.(text, key ? "warn" : "ok");
  }
  // The history store (Settings, Market data): two failed updates in a row, or none for three hours
  // with Automatic on, go to Notifications once, and once more when it's updating again.
  historyNotice(hs) {
    const key = !hs ? "" : hs.failures >= 2 ? "fail" : hs.stale ? "stale" : "";
    if (key === (this.historyKey ?? "")) return;
    const was = this.historyKey;
    this.historyKey = key;
    if (key === "fail")
      this.panels?.notice?.(`Kraken history: the last ${hs.failures} updates failed (${hs.lastError?.message || "no reason given"}). Charts still work, but their stored bars stop at the last good update. Settings, Market data has the details.`);
    else if (key === "stale")
      this.panels?.notice?.(`Kraken history hasn't updated since ${new Date(hs.since).toLocaleString()}. Settings, Market data has the details.`);
    else if (was) this.panels?.notice?.("Kraken history is updating again.", "ok");
  }
  setStatus(level, title) {
    const el = $("#status");
    el.className = `status ${level}`;
    if (title) el.title = title;
  }

  // ms 0 keeps the toast until it's clicked.
  toast(html, kind = "", ms = 3500) {
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.innerHTML = html;
    $("#toasts").appendChild(el);
    if (ms) setTimeout(() => el.remove(), ms);
    else {
      el.title = "Click to close";
      el.addEventListener("click", () => el.remove());
    }
    return el;
  }
}

const app = new App();
window.app = app;
app.init().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="toast err" style="position:fixed;left:20px;bottom:20px">Startup failed: ${esc(e.message)}</div>`,
  );
});
