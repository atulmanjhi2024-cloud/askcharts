// TradingView's symbol search: the chart's symbol selected in the box, category chips, a source
// filter, and rows with a logo, the ticker (matching part in blue), the name, the kind of market
// and the exchange. Arrow keys move, Enter opens, Esc closes.
import { api, esc, ticker, exchange } from "./api.js";

const KINDS = [
  ["all", "All", null],
  ["stocks", "Stocks", ["stock", "stocks", "equity"]],
  ["funds", "Funds", ["etf", "mutualfunds", "mutualfund", "fund"]],
  ["futures", "Futures", ["futures", "future"]],
  ["forex", "Forex", ["forex", "currency"]],
  ["crypto", "Crypto", ["crypto", "cryptocurrency"]],
  ["indices", "Indices", ["index"]],
  ["bonds", "Bonds", false],
  ["economy", "Economy", false],
  ["options", "Options", false],
];
const NO_DATA = { bonds: "There's no bond data here.", economy: "There's no economic data series here.", options: "There's no options data here." };
// How TradingView names each kind of market in its results.
const TYPE = { crypto: "spot crypto", cryptocurrency: "spot crypto", stocks: "stock", stock: "stock", equity: "stock", etf: "fund etf", mutualfunds: "fund", mutualfund: "fund", fund: "fund", forex: "forex", currency: "forex", futures: "futures", future: "futures", index: "index", commodity: "commodity" };
// Where the data comes from, with a colour for its badge (no outside logos).
const SOURCES = {
  BINANCE: ["Binance", "#f0b90b", "#1e2026"],
  COINBASE: ["Coinbase", "#0052ff", "#fff"],
  KRAKEN: ["Kraken", "#7132f5", "#fff"],
  US: ["US", "#2962ff", "#fff"],
  FX: ["Forex", "#089981", "#fff"],
  CME: ["CME", "#e2232a", "#fff"],
  YAHOO: ["Yahoo", "#6001d2", "#fff"],
  CSV: ["Your files", "#787b86", "#fff"],
  SPREAD: ["Spread", "#787b86", "#fff"],
};
const US_EXCHANGES = { PSE: "NYSE Arca", BAT: "Cboe BZX", BATS: "Cboe BZX", ASE: "NYSE American", AMEX: "NYSE American", NYQ: "NYSE", NMS: "NASDAQ", NGM: "NASDAQ", NCM: "NASDAQ" };
const ICON_SEARCH = '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5l5 5"/></svg>';
const ICON_CLEAR = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M9 9l6 6M15 9l-6 6"/></svg>';
const ICON_X = '<svg viewBox="0 0 18 18"><path d="M5 5l8 8M13 5l-8 8"/></svg>';
const CHEVRON = '<svg viewBox="0 0 18 18"><path d="M5 7.5l4 4 4-4"/></svg>';

const sourceOf = (sym) => SOURCES[exchange(sym)] ? exchange(sym) : "YAHOO";
const venue = (r) => {
  const ex = exchange(r.symbol);
  if (ex === "US") return US_EXCHANGES[r.exchange] || (r.exchange && r.exchange !== "US" ? r.exchange : "US");
  if (ex === "YAHOO") return r.exchange || "Yahoo";
  return SOURCES[ex]?.[0] || r.exchange || ex;
};
const flat = (s) => String(s || "").toUpperCase().replace(/[-_/ ]/g, "");
function logo(sym) {
  const t = ticker(sym);
  let h = 0;
  for (const c of t) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `<span class="wl-badge ss-logo" style="--h:${h}">${esc((t.match(/[A-Z0-9]/i) || ["?"])[0].toUpperCase())}</span>`;
}
const exLogo = (src) => {
  const [name, bg, fg] = SOURCES[src] || SOURCES.YAHOO;
  return `<span class="ss-exl" style="background:${bg};color:${fg}">${esc(name[0])}</span>`;
};
// The part of the ticker that matches what's typed, in blue.
function mark(t, q) {
  const i = q ? t.toUpperCase().indexOf(q.toUpperCase()) : -1;
  if (i < 0) return esc(t);
  return `${esc(t.slice(0, i))}<em>${esc(t.slice(i, i + q.length))}</em>${esc(t.slice(i + q.length))}`;
}

export function openSymbolSearch(app, { initial = "", onPick = null, title = "Symbol search" } = {}) {
  let kind = app.settings.searchKind || "all",
    source = null,
    results = [],
    rows = [],
    sel = 0,
    timer,
    seq = 0;
  if (KINDS.find(([k]) => k === kind)?.[2] === false) kind = "all";
  const start = initial || ticker(app.active?.cfg.symbol || "");
  const card = app.modal(
    title,
    `<div class="ss-box">${ICON_SEARCH}<input id="ssQ" placeholder="Symbol, company or pair" autocomplete="off" spellcheck="false" value="${esc(start)}"><button class="ss-clear" title="Clear">${ICON_CLEAR}</button></div>
    <div class="ss-kinds">${KINDS.map(([k, label, types]) => `<button data-kind="${k}" ${types === false ? `disabled title="${esc(NO_DATA[k])}"` : ""}>${label}</button>`).join("")}</div>
    <div class="ss-filters"></div>
    <div class="ss-list"></div>`,
    { foot: '<span class="ss-foot">Crypto from Binance, Coinbase and Kraken. US stocks and funds from Nasdaq. Forex from Kraken. Indices, futures and other markets as Yahoo symbols, like YAHOO:^FTSE.</span>' },
  );
  card.classList.add("ss-card");
  const q = card.querySelector("#ssQ"),
    list = card.querySelector(".ss-list"),
    filters = card.querySelector(".ss-filters");

  const recent = () => (app.settings.recentSymbols ||= []);
  const pick = (r) => {
    const sym = typeof r === "string" ? r : r.symbol;
    if (typeof r === "object") {
      const keep = recent().filter((x) => x.symbol !== r.symbol);
      app.settings.recentSymbols = [{ symbol: r.symbol, name: r.name, type: r.type, exchange: r.exchange }, ...keep].slice(0, 12);
    }
    app.closeModal();
    if (onPick) onPick(sym);
    else app.setSymbol(sym);
  };

  const drawFilters = () => {
    card.querySelectorAll(".ss-kinds button").forEach((b) => b.classList.toggle("on", b.dataset.kind === kind));
    filters.innerHTML = source
      ? `<span class="ss-chip on">${exLogo(source)}${esc(SOURCES[source][0])}<button data-x="source" title="All sources">${ICON_X}</button></span>`
      : `<button class="ss-chip" data-x="sources">All sources${CHEVRON}</button>`;
  };
  const draw = () => {
    const types = KINDS.find(([k]) => k === kind)[2];
    const v = q.value.trim();
    const V = flat(v);
    // exactly as typed first, then the same letters (XRP-USD for XRPUSD), then starts with it
    const rank = (r) => {
      const t = ticker(r.symbol).toUpperCase(),
        f = flat(t);
      return t === v.toUpperCase() ? 0 : f === V ? 1 : f.startsWith(V) ? 2 : 3;
    };
    const base = v ? results : recent();
    rows = base
      .map((r, i) => [r, i])
      .filter(([r]) => !types || types.includes(String(r.type || "").toLowerCase()))
      .filter(([r]) => !source || sourceOf(r.symbol) === source)
      .sort((a, b) => (v ? rank(a[0]) - rank(b[0]) : 0) || a[1] - b[1])
      .map(([r]) => r);
    sel = Math.min(sel, Math.max(rows.length - 1, 0));
    const head = !v && rows.length ? '<div class="ss-head">Recently opened</div>' : "";
    list.innerHTML =
      head +
        rows
          .map((r, i) => {
            const t = ticker(r.symbol);
            return `<div class="ss-row${i === sel ? " sel" : ""}" data-i="${i}">${logo(r.symbol)}<span class="ss-t">${mark(t, v)}</span><span class="ss-n">${esc(String(r.name || "").trim())}</span><span class="ss-k">${esc(TYPE[String(r.type || "").toLowerCase()] || r.type || "")}</span><span class="ss-e">${esc(venue(r))}</span>${exLogo(sourceOf(r.symbol))}</div>`;
          })
          .join("") ||
      `<div class="ss-empty">${
        !v
          ? "Type a symbol, a company or a pair: XRPUSD, Tesla, EURUSD, ^FTSE."
          : results.length
            ? `Nothing here for <b>${esc(v)}</b>${source ? ` on ${esc(SOURCES[source][0])}` : ""}. Try All${source ? " sources" : ""}.`
            : `No matches. Press Enter to open <b>${esc(v.toUpperCase())}</b> as typed.`
      }</div>`;
    list.querySelector(".ss-row.sel")?.scrollIntoView({ block: "nearest" });
  };
  const run = async () => {
    const v = q.value.trim(),
      mine = ++seq;
    if (!v) {
      results = [];
      return draw();
    }
    list.classList.add("busy");
    let found = [];
    try {
      found = await api.search(v);
    } catch {
      /* no matches */
    }
    if (mine !== seq) return;
    list.classList.remove("busy");
    results = found;
    sel = 0;
    draw();
  };

  q.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(run, 150);
  };
  q.onkeydown = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      sel = e.key === "ArrowDown" ? Math.min(sel + 1, rows.length - 1) : Math.max(sel - 1, 0);
      draw();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (rows[sel]) pick(rows[sel]);
      else if (q.value.trim()) pick(q.value.trim());
    }
  };
  card.querySelector(".ss-clear").onclick = () => {
    q.value = "";
    results = [];
    sel = 0;
    draw();
    q.focus();
  };
  card.querySelector(".ss-kinds").onclick = (e) => {
    const b = e.target.closest("[data-kind]");
    if (!b || b.disabled) return;
    kind = b.dataset.kind;
    app.settings.searchKind = kind;
    sel = 0;
    drawFilters();
    draw();
    q.focus();
  };
  filters.onclick = (e) => {
    const b = e.target.closest("[data-x]");
    if (!b) return;
    if (b.dataset.x === "source") {
      source = null;
      drawFilters();
      draw();
      return q.focus();
    }
    // the sources in the current results first, then the rest
    const seen = [...new Set(results.map((r) => sourceOf(r.symbol)))];
    const all = [...seen, ...Object.keys(SOURCES).filter((k) => !seen.includes(k) && k !== "SPREAD" && k !== "CSV")];
    const tb = app.drawToolbar;
    const pop = tb.openPopover(b, all.map((k) => `<button data-src="${k}">${exLogo(k)}<span>${esc(SOURCES[k][0])}</span></button>`).join(""), "ss-src");
    pop.classList.add("dtb-list", "ss-srcpop");
    const r = b.getBoundingClientRect();
    pop.style.left = `${r.left}px`;
    pop.style.top = `${r.bottom + 4}px`;
    pop.onclick = (ev) => {
      const s = ev.target.closest("[data-src]")?.dataset.src;
      if (!s) return;
      tb.closePopover();
      source = s;
      sel = 0;
      drawFilters();
      draw();
      q.focus();
    };
  };
  list.onclick = (e) => {
    const it = e.target.closest(".ss-row");
    if (it) pick(rows[Number(it.dataset.i)]);
  };
  list.onmousemove = (e) => {
    const it = e.target.closest(".ss-row");
    if (!it || Number(it.dataset.i) === sel) return;
    list.querySelector(".ss-row.sel")?.classList.remove("sel");
    it.classList.add("sel");
    sel = Number(it.dataset.i);
  };

  drawFilters();
  q.focus();
  if (initial) q.setSelectionRange(q.value.length, q.value.length);
  else q.select();
  if (q.value.trim()) run();
  else draw();
  return card;
}
