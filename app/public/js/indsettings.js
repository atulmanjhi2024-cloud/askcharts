// TradingView's indicator Settings dialog: Inputs, Style and Visibility tabs, and Properties for a strategy. What you change shows on
// the chart at once; Cancel or closing the dialog puts it all back, Ok keeps it. Defaults resets the
// indicator, or saves these settings for the next time it's added. Every name, option and tooltip
// comes from the indicator (a Pine script's own text), so all of it goes in escaped.

import { esc } from "./api.js";
import { BY_ID } from "../lib/indicators.js";
import { parseTf } from "../lib/series.js";
import { STYLES } from "./drawtoolbar.js";

const CHEVRON = '<svg viewBox="0 0 18 18" class="cs-chev"><path d="M5 7.5l4 4 4-4"/></svg>';
const TABS = [
  ["inputs", "Inputs"],
  ["properties", "Properties"],
  ["style", "Style"],
  ["visibility", "Visibility"],
];
// A strategy's Properties: TradingView's defaults for strategy() arguments the script leaves out
const STRAT_DEFAULTS = { initial_capital: 1000000, default_qty_type: "fixed", default_qty_value: 1, pyramiding: 0, commission_type: "percent", commission_value: 0, slippage: 0, calc_on_every_tick: false, use_bar_magnifier: false, backtest_fill_limits_assumption: 0 };
const LIMIT_TICKS = [0, 1, 2, 3, 5, 10, 20];
const TIPS = {
  capital: "The money the strategy starts with. Its results are in this currency.",
  currency: "Results stay in the symbol's own currency; converting them isn't built yet.",
  size: "How much each entry buys or sells when the script doesn't name a quantity: a number of contracts, an amount of money, or a share of the strategy's equity.",
  pyramiding: "How many entries in the same direction can be open at once. 0 and 1 both allow one.",
  detail: "How the strategy fills orders inside a bar: TradingView's four ticks per bar (open, the nearer extreme, the far one, close). High detalization, which uses lower-timeframe bars, isn't built yet.",
  exec: "On bar close: the script runs as each bar closes, so a live bar places no orders until it closes. On realtime bar tick: a live bar's orders are placed as it moves. On order fill isn't built yet.",
  commission: "Charged on every entry and exit: a percent of the order's value, or an amount per contract or per order.",
  leverage: "Margin and margin calls aren't emulated yet, so this shows the script's own setting and every order fills in full.",
  slippage: "Market and stop orders fill this many ticks worse than the price that triggered them.",
  limits: "Requested price: a limit order fills as soon as the price touches it. Otherwise the price has to go past it by that many ticks, and it still fills at its own price.",
  delay: "Market orders fill on the next tick after they're placed: the next bar's open, or at once with process_orders_on_close.",
};
const BROKER_TIP = "The broker emulator fills the strategy's orders on the chart's bars: commission, leverage, slippage and how limit orders fill.";
const PLOT_TYPES = [
  ["line", "Line"],
  ["step", "Step line"],
  ["histogram", "Histogram"],
  ["columns", "Columns"],
  ["circles", "Circles"],
  ["cross", "Cross"],
];
// The chart's markers sit above a bar, below it, or at its price.
const LOCATIONS = [
  ["aboveBar", "Above bar"],
  ["belowBar", "Below bar"],
  ["inBar", "Absolute"],
];
const WIDTHS = [1, 2, 3, 4].map((w) => [String(w), `${w}px`]);
const LINE_STYLES = STYLES.filter(([s]) => ["solid", "dashed", "dotted"].includes(s)).map(([s, l]) => [s, l]);
const PRECISION = [["", "Default"], ...Array.from({ length: 9 }, (_, n) => [String(n), String(n)])];
const OBJECTS = [
  ["box", "Boxes"],
  ["label", "Pane labels"],
  ["linefill", "Line fills"],
  ["line", "Lines"],
  ["table", "Tables"],
];
// input.timeframe: "" is the chart's own, as TradingView's "Chart"
const PINE_TFS = [["", "Chart"], ["1", "1 minute"], ["3", "3 minutes"], ["5", "5 minutes"], ["15", "15 minutes"], ["30", "30 minutes"], ["45", "45 minutes"], ["60", "1 hour"], ["120", "2 hours"], ["180", "3 hours"], ["240", "4 hours"], ["D", "1 day"], ["W", "1 week"], ["M", "1 month"]];
// A built-in indicator's own timeframe (patch 13's mapToChart)
const IND_TFS = [["", "Chart"], ["5m", "5 minutes"], ["15m", "15 minutes"], ["1h", "1 hour"], ["4h", "4 hours"], ["1D", "1 day"], ["1W", "1 week"], ["1M", "1 month"]];
const PRICE = ["close", "open", "high", "low", "hl2", "hlc3", "ohlc4", "hlcc4"];
const VIS = [
  ["seconds", "Seconds", 1, 59],
  ["minutes", "Minutes", 1, 59],
  ["hours", "Hours", 1, 24],
  ["days", "Days", 1, 366],
  ["weeks", "Weeks", 1, 52],
  ["months", "Months", 1, 12],
];
const UNIT_ROW = { s: "seconds", m: "minutes", h: "hours", D: "days", W: "weeks", M: "months" };
// The glyph a shape row's button shows, as TradingView's shape button does
const GLYPHS = new Map(Object.entries({ triangleup: "\u25B2", triangledown: "\u25BC", arrowup: "\u2191", arrowdown: "\u2193", circle: "\u25CF", square: "\u25A0", diamond: "\u25C6", flag: "\u2691", cross: "+", xcross: "\u00D7", labelup: "\u25B2", labeldown: "\u25BC", char: "A" }));

// Visibility tab: is this indicator shown on the chart's interval?
export function visibleOn(ind, tf) {
  const v = ind?.vis;
  if (!v) return true;
  let p;
  try {
    p = parseTf(tf);
  } catch {
    return true;
  }
  const r = v[UNIT_ROW[p.unit]];
  if (!r) return true;
  return r.on !== false && p.n >= (r.from ?? 1) && p.n <= (r.to ?? Infinity);
}

// the dialog's title, as TradingView's: the short name, trimmed
const shortName = (def) => (/\(([^)]+)\)$/.exec(def.name)?.[1].split(" / ")[0] || def.name).trim();

export function openIndicatorSettings(app, pane, ind, start = "inputs") {
  const def = BY_ID[ind.id];
  if (!def) return;
  const KEEP = ["params", "colors", "style", "vis", "tf", "props"];
  const before = structuredClone(Object.fromEntries(KEEP.map((k) => [k, ind[k]])));
  // Properties only for a strategy, between Inputs and Style as on TradingView
  const tabs = TABS.filter(([k]) => k !== "properties" || def.strategy);
  let tab = tabs.some(([k]) => k === start) ? start : "inputs";
  const card = app.modal(
    shortName(def),
    `<div class="is-tabs">${tabs.map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join("")}</div><div class="is-page"></div>`,
    { foot: `<button class="cs-dd is-defaults" data-x="defaults"><span>Defaults</span>${CHEVRON}</button><span class="spacer"></span><button class="btn" data-x="cancel">Cancel</button><button class="btn primary cs-ok" data-x="ok">Ok</button>` },
  );
  card.classList.add("cs-card", "is-card");
  const page = card.querySelector(".is-page");
  const tb = app.drawToolbar;

  // ---- state: changes go straight onto the indicator and the chart; closing undoes them
  // a saved default is kept even when the dialog's other changes are cancelled
  let defaultsChanged = false;
  const restore = () => {
    for (const k of KEEP) {
      if (before[k] === undefined) delete ind[k];
      else ind[k] = structuredClone(before[k]);
    }
    pane.render(false);
    if (defaultsChanged) app.persist();
  };
  app.onModalClose = restore;
  let timer = 0;
  const changed = (later = false) => {
    clearTimeout(timer);
    if (later) timer = setTimeout(() => pane.render(false), 350);
    else pane.render(false);
  };
  const style = () => (ind.style ||= {});
  const bag = (k) => (style()[k] ||= {});
  const param = (i) => ind.params?.[i.key] ?? i.default;
  const setParam = (key, v) => {
    ind.params = { ...(ind.params || {}), [key]: v };
  };
  // a strategy's Properties: what's set here, else the script's strategy() argument, else TradingView's default
  const prop = (k) => ind.props?.[k] ?? def.strategyOpts?.[k] ?? STRAT_DEFAULTS[k];
  const setProp = (k, v) => {
    ind.props = { ...(ind.props || {}), [k]: v };
  };
  const quote = () => (typeof def.strategyOpts?.currency === "string" && def.strategyOpts.currency !== "NONE" ? def.strategyOpts.currency : /(USDT|USDC|FDUSD|BUSD|USD|EUR|GBP|JPY|AUD|CAD|CHF|BTC|ETH)$/.exec(String(pane.cfg.symbol).split(":").pop())?.[1] || "USD");

  // ---- controls
  const dd = (id, options, cur, { dis = false, cls = "" } = {}) => {
    const label = options.find(([v]) => String(v) === String(cur ?? ""))?.[1] ?? String(cur ?? "");
    lists.set(id, options);
    return `<button class="cs-dd is-dd${cls}" data-dd="${esc(id)}" ${dis ? "disabled" : ""}><span>${esc(label)}</span>${CHEVRON}</button>`;
  };
  const chk = (id, label, on, { dis = false } = {}) =>
    `<label class="cs-chk${dis ? " dis" : ""}"><input type="checkbox" data-chk="${esc(id)}" ${on ? "checked" : ""} ${dis ? "disabled" : ""}><span class="cs-box"></span><span>${esc(label)}</span></label>`;
  const swatch = (id, color, { dis = false } = {}) => `<button class="cs-sw is-sw" data-color="${esc(id)}" style="--c:${esc(color || "#2962ff")}" ${dis ? "disabled" : ""}></button>`;
  const info = (tip) => (tip ? `<span class="cs-help is-info" title="${esc(tip)}">i</span>` : "");
  const lists = new Map();
  // a shape's colour: the script's own, else the one it last drew with (often from a colour input)
  const shapeColor = (s) => s.color || pane.indResults?.[ind.uid]?.markers?.findLast?.((m) => m.plot === s.key)?.color || "#2962ff";

  const sourceOptions = () => {
    const others = pane.cfg.indicators
      .filter((x) => x.uid !== ind.uid && !String(x.params?.source || "").includes(ind.uid) && BY_ID[x.id]?.outputs.length)
      .flatMap((x) => BY_ID[x.id].outputs.map((o) => [`ind:${x.uid}:${o.key}`, `${shortName(BY_ID[x.id])} ${pane.indicatorParamsLabel(x)}: ${o.label}`]));
    return [...PRICE.map((s) => [s, s]), ...others];
  };
  const control = (i) => {
    const v = param(i);
    const k = esc(i.key);
    switch (i.type) {
      case "int":
      case "float":
        return `<input class="cs-num is-num" type="number" data-in="${k}" data-t="${i.type}" step="${esc(i.step ?? (i.type === "int" ? 1 : "any"))}"${i.min !== undefined ? ` min="${esc(i.min)}"` : ""}${i.max !== undefined ? ` max="${esc(i.max)}"` : ""} value="${esc(v)}">`;
      case "select":
        return dd(`in:${i.key}`, i.options.map((o) => [o, o]), v);
      case "source":
        return dd(`in:${i.key}`, sourceOptions(), v, { cls: " wide" });
      case "timeframe":
        return dd(`in:${i.key}`, PINE_TFS, v);
      case "color":
        return swatch(`in:${i.key}`, v);
      case "text":
        return `<input class="cs-num is-text" type="text" data-in="${k}" data-t="text" value="${esc(v)}">`;
      case "textarea":
        return `<textarea class="cs-num is-ta" data-in="${k}" data-t="text" rows="3">${esc(v)}</textarea>`;
      case "time": {
        const local = v ? new Date((v - new Date(v * 1000).getTimezoneOffset() * 60) * 1000).toISOString().slice(0, 16) : "";
        return `<input class="cs-num is-time" type="datetime-local" data-in="${k}" data-t="time" value="${local}"><button class="btn small" type="button" data-pick="${k}">Pick on chart</button>`;
      }
      default:
        return "";
    }
  };
  // a row: label, control, info; a bool is its own label
  const inputRow = (i) =>
    i.type === "bool"
      ? `<div class="is-l span">${chk(`in:${i.key}`, i.label, param(i) === true || param(i) === "true")}</div><div class="is-i">${info(i.tooltip)}</div>`
      : `<div class="is-l">${esc(i.label)}</div><div class="is-c">${control(i)}</div><div class="is-i">${info(i.tooltip)}</div>`;

  const PAGES = {
    inputs() {
      const inputs = def.inputs || [];
      let h = "",
        group = null;
      for (let k = 0; k < inputs.length; k++) {
        const i = inputs[k];
        if ((i.group || null) !== group) {
          group = i.group || null;
          if (group) h += `<div class="cs-sec">${esc(group)}</div>`;
        }
        // TradingView's inline: inputs with the same inline id share one row
        if (i.inline && inputs[k + 1]?.inline === i.inline && (inputs[k + 1].group || null) === group) {
          const row = [i];
          while (inputs[k + 1]?.inline === i.inline && (inputs[k + 1].group || null) === group) row.push(inputs[++k]);
          h += `<div class="is-inline">${row.map((x) => (x.type === "bool" ? chk(`in:${x.key}`, x.label, param(x) === true || param(x) === "true") : `<span class="is-ilab">${esc(x.label)}</span>${control(x)}`)).join("")}</div><div class="is-i">${info(row.findLast((x) => x.tooltip)?.tooltip)}</div>`;
          continue;
        }
        h += inputRow(i);
      }
      // XRPL On chain follows the chart's bars: no timeframe of its own
      if (!def.pine && !def.onchain) h += `<div class="is-l">Timeframe</div><div class="is-c">${dd("tf", IND_TFS, ind.tf || "")}</div><div class="is-i"></div>`;
      return h ? `<div class="is-grid">${h}</div>` : '<div class="is-empty">This indicator has no inputs.</div>';
    },
    style() {
      const st = ind.style || {};
      let h = "";
      if (def.strategy) {
        const on = st.trades !== false;
        h += `<div class="is-l span">${chk("strat:trades", "Trades on chart", on)}</div><div class="is-i"></div>`;
        h += `<div class="is-l span is-sub">${chk("strat:signals", "Signal labels", st.signals !== false, { dis: !on })}</div><div class="is-i"></div>`;
        h += `<div class="is-l span is-sub">${chk("strat:qty", "Quantity", st.qty !== false, { dis: !on })}</div><div class="is-i"></div>`;
      }
      for (const o of def.outputs || []) {
        if (o.key === "pnone" || o.legendOnly) continue;
        const type = st.type?.[o.key] || (o.kind === "histogram" ? "histogram" : o.dots ? "circles" : "line");
        h += `<div class="is-l span-c">${chk(`off:${o.key}`, o.label, !(st.off?.[o.key] ?? o.off))}</div><div class="is-c">${swatch(`c:${o.key}`, ind.colors?.[o.key] || o.color)}${dd(`w:${o.key}`, WIDTHS, st.width?.[o.key] || o.lineWidth || 1, { cls: " narrow" })}${dd(`t:${o.key}`, PLOT_TYPES, type, { cls: " mid" })}</div><div class="is-i"></div>`;
      }
      for (const s of def.shapes || []) {
        const sh = st.shapes?.[s.key] || {};
        const color = sh.color || shapeColor(s);
        h += `<div class="is-l span-c">${chk(`off:${s.key}`, s.label, !st.off?.[s.key])}</div><div class="is-c"><button class="cs-sw is-shape" data-color="sc:${esc(s.key)}" style="--c:${esc(color)}" title="Colour">${esc(GLYPHS.get(s.shape) || "\u25CF")}</button>${dd(`loc:${s.key}`, LOCATIONS, sh.location || s.location || "aboveBar", { cls: " mid" })}</div><div class="is-i"></div>`;
      }
      const levels = def.hlines || (def.levels || []).map((price) => ({ price }));
      levels.forEach((lv, k) => {
        const o = st.hl?.[k] || {};
        h += `<div class="is-l span-c">${chk(`hl:${k}`, lv.title || `Level ${lv.price}`, !o.off)}</div><div class="is-c">${swatch(`hlc:${k}`, o.color || lv.color || "#787b86")}${dd(`hls:${k}`, LINE_STYLES, o.style || lv.style || "dashed", { cls: " mid" })}${dd(`hlw:${k}`, WIDTHS, o.width || lv.width || 1, { cls: " narrow" })}</div><div class="is-i"></div>`;
      });
      const kinds = OBJECTS.filter(([k]) => def.objects?.includes(k));
      if (kinds.length) {
        h += '<div class="cs-sec">Graphic objects</div>';
        for (const [k, l] of kinds) h += `<div class="is-l span">${chk(`obj:${k}`, l, st.objects?.[k] !== false)}</div><div class="is-i"></div>`;
      }
      // a strategy that plots nothing has no output values, as on TradingView
      if (!def.strategy || (def.outputs || []).some((o) => o.key !== "pnone")) {
        h += '<div class="cs-sec">Output values</div>';
        h += `<div class="is-l">Precision</div><div class="is-c">${dd("prec", PRECISION, st.precision ?? "")}</div><div class="is-i"></div>`;
        h += `<div class="is-l span">${chk("scaleLabels", "Labels on price scale", (st.scaleLabels ?? def.scaleLabels) !== false)}</div><div class="is-i"></div>`;
        h += `<div class="is-l span">${chk("statusValues", "Values in status line", st.statusValues !== false)}</div><div class="is-i"></div>`;
      }
      if (def.inputs?.length) {
        h += '<div class="cs-sec">Input values</div>';
        h += `<div class="is-l span">${chk("statusInputs", "Inputs in status line", st.statusInputs !== false)}</div><div class="is-i"></div>`;
      }
      return `<div class="is-grid">${h}</div>`;
    },
    properties() {
      const cur = quote();
      const num = (k, { min = 0, step = "any", suffix = "", dis = false, value } = {}) =>
        `<span class="is-pnum${suffix ? " suffixed" : ""}"><input class="cs-num is-num" type="${dis ? "text" : "number"}" data-pr="${k}" min="${min}" step="${step}" value="${esc(value ?? prop(k))}" ${dis ? "disabled" : ""}>${suffix ? `<i>${esc(suffix)}</i>` : ""}</span>`;
      const row = (label, ctl, tip) => `<div class="is-l">${esc(label)}</div><div class="is-c">${ctl}</div><div class="is-i">${info(tip)}</div>`;
      const leverage = (k) => {
        const m = Number(def.strategyOpts?.[k] ?? ((def.pineVersion || 6) >= 6 ? 100 : 0));
        return m > 0 ? String(+(100 / m).toFixed(2)) : "Infinity";
      };
      const exec = prop("calc_on_every_tick") === true || prop("calc_on_every_tick") === "true" ? "tick" : "close";
      let h = '<div class="cs-sec">General</div>';
      h += row("Initial capital", `${num("initial_capital", { min: 1 })}${dd("pr:currency", [[cur, cur]], cur, { dis: true, cls: " narrow" })}`, TIPS.capital);
      h += row("Default order size", `${num("default_qty_value", { min: 0 })}${dd("pr:default_qty_type", [["fixed", "Contracts"], ["cash", cur], ["percent_of_equity", "% of equity"]], prop("default_qty_type"), { cls: " mid" })}`, TIPS.size);
      h += row("Pyramiding", num("pyramiding", { min: 0, step: 1, suffix: "orders" }), TIPS.pyramiding);
      h += '<div class="cs-sec">Detalization and execution</div>';
      h += row("Bar detalization", dd("pr:use_bar_magnifier", [["false", "Default (4 ticks per bar)"], ["true", "High (~40 ticks per bar)", { dis: "Needs lower-timeframe bars, not built yet" }]], "false", { cls: " wide" }), TIPS.detail);
      h += row("Script execution", dd("pr:exec", [["close", "On bar close"], ["tick", "On realtime bar tick"], ["fills", "On order fill", { dis: "Not built yet" }]], exec, { cls: " wide" }), TIPS.exec);
      h += `<div class="cs-sec">Broker emulator ${info(BROKER_TIP)}</div>`;
      h += row("Commission", `${num("commission_value", { min: 0 })}${dd("pr:commission_type", [["percent", "Percent"], ["cash_per_contract", `${cur} per contract`], ["cash_per_order", `${cur} per order`]], prop("commission_type"), { cls: " mid" })}`, TIPS.commission);
      h += row("Long leverage", num("margin_long", { dis: true, value: leverage("margin_long") }), TIPS.leverage);
      h += row("Short leverage", num("margin_short", { dis: true, value: leverage("margin_short") }), TIPS.leverage);
      h += row("Slippage", num("slippage", { min: 0, step: 1, suffix: "ticks" }), TIPS.slippage);
      h += row("Limit order execution", dd("pr:backtest_fill_limits_assumption", LIMIT_TICKS.map((n) => [String(n), n ? `Price goes ${n} tick${n > 1 ? "s" : ""} past it` : "Requested price"]), String(prop("backtest_fill_limits_assumption") || 0), { cls: " wide" }), TIPS.limits);
      h += row("Order execution delay", dd("pr:delay", [["tick", "One tick"]], "tick", { dis: true, cls: " mid" }), TIPS.delay);
      return `<div class="is-grid is-props">${h}</div>`;
    },
    visibility() {
      const v = ind.vis || {};
      let h = `<div class="is-vrow">${chk("vis:ticks", "Ticks", v.ticks !== false)}</div>`;
      for (const [k, label, lo, hi] of VIS) {
        const r = v[k] || {},
          on = r.on !== false,
          from = r.from ?? lo,
          to = r.to ?? hi;
        h += `<div class="is-vrow">${chk(`vis:${k}`, label, on)}<input class="cs-num is-vnum" type="number" data-vf="${k}" min="${lo}" max="${hi}" value="${from}" ${on ? "" : "disabled"}><span class="is-dual"><input type="range" min="${lo}" max="${hi}" value="${from}" data-vr="${k}:from" ${on ? "" : "disabled"}><input type="range" min="${lo}" max="${hi}" value="${to}" data-vr="${k}:to" ${on ? "" : "disabled"}></span><input class="cs-num is-vnum" type="number" data-vt="${k}" min="${lo}" max="${hi}" value="${to}" ${on ? "" : "disabled"}></div>`;
      }
      h += `<div class="is-vrow">${chk("vis:ranges", "Ranges", v.ranges !== false)}</div>`;
      return `<div class="is-vis">${h}</div>`;
    },
  };

  const show = (t) => {
    tab = t;
    tb.closePopover();
    card.querySelectorAll(".is-tabs [data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
    card.classList.toggle("is-wide", t === "visibility" || t === "properties");
    lists.clear();
    const top = page.dataset.tab === t ? page.scrollTop : 0;
    page.dataset.tab = t;
    page.innerHTML = PAGES[t]();
    page.scrollTop = top;
  };
  const redraw = () => show(tab);
  card.querySelector(".is-tabs").onclick = (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) show(b.dataset.tab);
  };

  // ---- the Visibility tab's rows: keep from <= to, inside the row's range
  const visRow = (k) => (((ind.vis ||= {})[k] ||= {}));
  const setVis = (k, from, to) => {
    const [, , lo, hi] = VIS.find(([x]) => x === k);
    const clamp = (x, d) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(Number(x)) ? Number(x) : d)));
    let f = clamp(from, lo),
      t = clamp(to, hi);
    if (f > t) [f, t] = [t, f];
    Object.assign(visRow(k), { from: f, to: t });
    const row = page.querySelector(`[data-vf="${k}"]`)?.closest(".is-vrow");
    if (row) {
      row.querySelector(`[data-vf="${k}"]`).value = f;
      row.querySelector(`[data-vt="${k}"]`).value = t;
      row.querySelector(`[data-vr="${k}:from"]`).value = f;
      row.querySelector(`[data-vr="${k}:to"]`).value = t;
    }
  };

  // ---- edits
  const onCheck = (id, on) => {
    const [kind, key] = splitId(id);
    if (kind === "in") setParam(key, on);
    else if (kind === "off") bag("off")[key] = !on;
    else if (kind === "hl") (bag("hl")[key] ||= {}).off = !on;
    else if (kind === "obj") bag("objects")[key] = on;
    else if (kind === "strat") {
      style()[key] = on;
      if (key === "trades") redraw();
    }
    else if (kind === "vis") {
      if (key === "ticks" || key === "ranges") (ind.vis ||= {})[key] = on;
      else visRow(key).on = on;
      redraw();
    } else if (["scaleLabels", "statusValues", "statusInputs"].includes(id)) style()[id] = on;
    changed();
  };
  page.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.chk) return onCheck(t.dataset.chk, t.checked);
    if (t.dataset.in) {
      const i = (def.inputs || []).find((x) => x.key === t.dataset.in);
      if (!i) return;
      if (t.dataset.t === "time") setParam(i.key, t.value ? Math.floor(new Date(t.value).getTime() / 1000) : 0);
      else if (t.dataset.t === "text") setParam(i.key, t.value);
      else {
        let n = Number(t.value);
        if (!Number.isFinite(n)) n = Number(i.default) || 0;
        if (i.type === "int") n = Math.round(n);
        if (i.min !== undefined) n = Math.max(i.min, n);
        if (i.max !== undefined) n = Math.min(i.max, n);
        t.value = n;
        setParam(i.key, n);
      }
      return changed();
    }
    if (t.dataset.pr) {
      const k = t.dataset.pr;
      let n = Number(t.value);
      if (!Number.isFinite(n) || n < Number(t.min || 0)) n = Number(prop(k)) || Number(t.min) || 0;
      if (t.step === "1") n = Math.round(n);
      t.value = n;
      setProp(k, n);
      return changed();
    }
    if (t.dataset.vf || t.dataset.vt) {
      const k = t.dataset.vf || t.dataset.vt;
      setVis(k, t.dataset.vf ? t.value : visRow(k).from, t.dataset.vt ? t.value : visRow(k).to);
      return changed();
    }
  });
  page.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.vr) {
      const [k, end] = t.dataset.vr.split(":");
      const r = visRow(k),
        [, , lo, hi] = VIS.find(([x]) => x === k);
      setVis(k, end === "from" ? t.value : r.from ?? lo, end === "to" ? t.value : r.to ?? hi);
      return changed(true);
    }
    if (t.dataset.pr && t.value !== "" && Number.isFinite(Number(t.value)) && Number(t.value) >= Number(t.min || 0)) {
      setProp(t.dataset.pr, t.step === "1" ? Math.round(Number(t.value)) : Number(t.value));
      return changed(true);
    }
    // typing in a number or text field updates the chart after a short pause; limits apply on change
    if (t.dataset.in && t.dataset.t !== "time") {
      const i = (def.inputs || []).find((x) => x.key === t.dataset.in);
      if (!i) return;
      if (t.dataset.t === "text") setParam(i.key, t.value);
      else if (t.value !== "" && Number.isFinite(Number(t.value))) setParam(i.key, i.type === "int" ? Math.round(Number(t.value)) : Number(t.value));
      else return;
      changed(true);
    }
  });
  page.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches("input")) {
      e.preventDefault();
      e.target.blur();
    }
  });
  page.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.dd) return ddList(b, b.dataset.dd);
    if (b.dataset.color) return colorPick(b, b.dataset.color);
    if (b.dataset.pick) {
      // keep what's been changed so far, then pick the bar
      app.onModalClose = null;
      app.closeModal();
      app.persist();
      return app.pickAnchor(pane, ind.uid, b.dataset.pick);
    }
  });

  const ddList = (btn, id) => {
    const items = lists.get(id) || [];
    const cur = currentOf(id);
    const pop = tb.openPopover(btn, items.map(([v, l, o]) => `<button data-v="${esc(v)}" class="${String(v) === String(cur ?? "") ? "on" : ""}"${o?.dis ? ` disabled title="${esc(o.dis)}"` : ""}>${esc(l)}</button>`).join(""), "is-dd");
    pop.classList.add("dtb-list", "cs-ddlist");
    const r = btn.getBoundingClientRect();
    pop.style.minWidth = `${r.width}px`;
    const below = innerHeight - r.bottom - 8,
      above = r.top - 8,
      h = pop.offsetHeight;
    const room = below >= Math.min(h, 240) || below >= above ? below : above;
    pop.style.maxHeight = `${Math.max(120, room)}px`;
    pop.style.left = `${Math.max(4, Math.min(r.left, innerWidth - pop.offsetWidth - 4))}px`;
    pop.style.top = `${room === below ? r.bottom + 4 : Math.max(4, r.top - 4 - pop.offsetHeight)}px`;
    pop.querySelector(".on")?.scrollIntoView({ block: "center" });
    pop.onclick = (e) => {
      const it = e.target.closest("[data-v]");
      if (!it || it.disabled) return;
      tb.closePopover();
      setFromList(id, it.dataset.v);
      redraw();
      changed();
    };
  };
  const currentOf = (id) => {
    const [kind, key] = splitId(id);
    const st = ind.style || {};
    if (kind === "in") return param((def.inputs || []).find((x) => x.key === key) || {});
    if (kind === "w") return st.width?.[key] || def.outputs.find((o) => o.key === key)?.lineWidth || 1;
    if (kind === "t") return st.type?.[key];
    if (kind === "loc") return st.shapes?.[key]?.location || def.shapes?.find((s) => s.key === key)?.location || "aboveBar";
    if (kind === "hls") return st.hl?.[key]?.style;
    if (kind === "hlw") return st.hl?.[key]?.width;
    if (id === "prec") return st.precision ?? "";
    if (id === "tf") return ind.tf || "";
    if (kind === "pr") {
      if (key === "exec") return prop("calc_on_every_tick") === true ? "tick" : "close";
      if (key === "backtest_fill_limits_assumption") return String(prop(key) || 0);
      return prop(key);
    }
    return "";
  };
  const setFromList = (id, v) => {
    const [kind, key] = splitId(id);
    if (kind === "in") setParam(key, v);
    else if (kind === "w") bag("width")[key] = Number(v);
    else if (kind === "t") bag("type")[key] = v;
    else if (kind === "loc") (bag("shapes")[key] ||= {}).location = v;
    else if (kind === "hls") (bag("hl")[key] ||= {}).style = v;
    else if (kind === "hlw") (bag("hl")[key] ||= {}).width = Number(v);
    else if (id === "prec") v === "" ? delete style().precision : (style().precision = v);
    else if (id === "tf") ind.tf = v || undefined;
    else if (kind === "pr") {
      if (key === "exec") setProp("calc_on_every_tick", v === "tick");
      else if (key === "backtest_fill_limits_assumption") setProp(key, Number(v) || 0);
      else setProp(key, v);
    }
  };
  const splitId = (id) => {
    const k = id.indexOf(":");
    return k < 0 ? [id, ""] : [id.slice(0, k), id.slice(k + 1)];
  };
  const colorPick = (btn, id) => {
    const [kind, key] = splitId(id);
    const st = ind.style || {};
    const cur =
      kind === "in" ? param((def.inputs || []).find((x) => x.key === key) || {}) : kind === "c" ? ind.colors?.[key] || def.outputs.find((o) => o.key === key)?.color : kind === "sc" ? st.shapes?.[key]?.color || shapeColor(def.shapes?.find((s) => s.key === key) || {}) : st.hl?.[key]?.color || (def.hlines || [])[key]?.color;
    tb.colorPopover(btn, cur || "#2962ff", true, (c) => {
      if (kind === "in") setParam(key, c);
      else if (kind === "c") ind.colors = { ...(ind.colors || {}), [key]: c };
      else if (kind === "sc") (bag("shapes")[key] ||= {}).color = c;
      else if (kind === "hlc") (bag("hl")[key] ||= {}).color = c;
      btn.style.setProperty("--c", c);
      changed(true);
    });
  };

  // ---- footer
  card.querySelector("[data-x=defaults]").onclick = (e) => {
    const btn = e.currentTarget;
    const saved = !!app.settings.indDefaults?.[ind.id];
    const pop = tb.openPopover(btn, `<button data-d="reset">Reset settings</button><button data-d="save">Save as default</button>${saved ? '<button data-d="forget">Forget saved default</button>' : ""}`, "is-defaults");
    pop.classList.add("dtb-list", "cs-ddlist");
    const r = btn.getBoundingClientRect();
    pop.style.left = `${r.left}px`;
    pop.style.top = `${Math.max(4, r.top - 4 - pop.offsetHeight)}px`;
    pop.onclick = (ev) => {
      const d = ev.target.closest("[data-d]")?.dataset.d;
      if (!d) return;
      tb.closePopover();
      if (d === "reset") {
        for (const k of KEEP) delete ind[k];
        ind.params = {};
        redraw();
        changed();
      } else if (d === "save") {
        app.settings.indDefaults = { ...(app.settings.indDefaults || {}), [ind.id]: structuredClone({ params: ind.params || {}, colors: ind.colors, style: ind.style, vis: ind.vis, props: ind.props }) };
        defaultsChanged = true;
        app.toast(`New ${esc(shortName(def))} indicators start with these settings.`);
      } else if (d === "forget") {
        const all = { ...(app.settings.indDefaults || {}) };
        delete all[ind.id];
        app.settings.indDefaults = all;
        defaultsChanged = true;
        app.toast(`New ${esc(shortName(def))} indicators start with the script's own settings.`);
      }
    };
  };
  card.querySelector("[data-x=cancel]").onclick = () => app.closeModal();
  card.querySelector("[data-x=ok]").onclick = () => {
    clearTimeout(timer);
    app.onModalClose = null;
    app.closeModal();
    pane.render(false);
    app.persist();
  };
  show(tab);
}

