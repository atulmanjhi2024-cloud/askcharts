// TradingView's bar under the charts: the date ranges (1D to All, each in its own interval), Go to
// date, and a clock in the chart's time zone (a click on it picks the zone).
import { esc, exchange } from "./api.js";
import { parseTf } from "../lib/series.js";
import { zoneOf, tzOffset, offsetLabel, fmtClock, zoneOptions, localZone } from "./chartsettings.js";

const $ = (s, el = document) => el.querySelector(s);
// [button, interval, tooltip]. The intervals are the TradingView charting library's defaults.
export const RANGES = [
  ["1D", "1m", "1 day in 1 minute intervals"],
  ["5D", "5m", "5 days in 5 minute intervals"],
  ["1M", "30m", "1 month in 30 minute intervals"],
  ["3M", "1h", "3 months in 1 hour intervals"],
  ["6M", "2h", "6 months in 2 hour intervals"],
  ["YTD", "1D", "Year to date in 1 day intervals"],
  ["1Y", "1W", "1 year in 1 week intervals"],
  ["5Y", "1W", "5 years in 1 week intervals"],
  ["All", "1M", "All data in 1 month intervals"],
];
const CAL =
  '<svg viewBox="0 0 24 24"><rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M4 9.5h16M8.5 3.5v4M15.5 3.5v4M8 14h3M13 14l2 2-2 2M8 17h3"/></svg>';
const pad = (n) => String(n).padStart(2, "0");
// Chart (zone) seconds as the value of a date or time input, and back.
const dateVal = (t) => {
  const d = new Date(t * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const timeVal = (t) => {
  const d = new Date(t * 1000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
const wallOf = (date, time = "00:00") => {
  const t = Date.parse(`${date}T${time || "00:00"}:00Z`);
  return Number.isFinite(t) ? t / 1000 : NaN;
};

export class RangeBar {
  constructor(app) {
    this.app = app;
    this.el = $("#rangeBar");
    if (!this.el) return;
    this.el.innerHTML = `<div class="rb-ranges">${RANGES.map(([k, , tip]) => `<button class="rb-btn" data-r="${k}" title="${esc(tip)}">${k}</button>`).join("")}</div><span class="rb-sep"></span><button class="rb-btn rb-goto" data-x="goto" title="Go to date (${/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌥ G" : "Alt+G"})">${CAL}</button><span class="spacer"></span><button class="rb-btn rb-clock" data-x="zone" title="Time zone"></button>`;
    this.el.onclick = (e) => {
      const r = e.target.closest("[data-r]")?.dataset.r;
      if (r) return this.pick(r);
      const x = e.target.closest("[data-x]")?.dataset.x;
      if (x === "goto") this.openGoTo();
      if (x === "zone") this.zoneMenu(e.target.closest("[data-x]"));
    };
    this.tick();
    setInterval(() => this.tick(), 1000);
  }

  zone() {
    return zoneOf(this.app.settings.chart, this.app.active?.cfg.symbol);
  }
  // The clock: wall time in the chart's zone and its UTC offset ("03:55:36 AM UTC-4").
  tick() {
    const el = this.el?.querySelector(".rb-clock");
    if (!el) return;
    const tz = this.zone(),
      now = Math.floor(Date.now() / 1000);
    const text = `${fmtClock(now + tzOffset(tz, now), this.app.settings.chart.hours === "12", true)} ${offsetLabel(tz)}`;
    if (el.textContent !== text) el.textContent = text;
  }

  zoneMenu(btn) {
    const tb = this.app.drawToolbar,
      cs = this.app.settings.chart;
    const cur = cs.timezone || localZone();
    const pop = tb.openPopover(btn, zoneOptions().map(([v, l]) => `<button data-v="${esc(v)}" class="${v === cur ? "on" : ""}">${esc(l)}</button>`).join(""), "rb-zone");
    pop.classList.add("dtb-list", "cs-ddlist");
    const r = btn.getBoundingClientRect();
    pop.style.maxHeight = `${Math.max(160, r.top - 12)}px`;
    pop.style.left = `${Math.max(4, Math.min(r.right - pop.offsetWidth, innerWidth - pop.offsetWidth - 4))}px`;
    pop.style.top = `${Math.max(4, r.top - 4 - pop.offsetHeight)}px`;
    pop.querySelector(".on")?.scrollIntoView({ block: "center" });
    pop.onclick = (e) => {
      const it = e.target.closest("[data-v]");
      if (!it) return;
      tb.closePopover();
      cs.timezone = it.dataset.v === localZone() ? "" : it.dataset.v;
      this.app.applyChartSettings();
      this.app.persist();
      this.tick();
    };
  }

  // Where a range starts, in UTC seconds, counted back from the last bar.
  startOf(code, p) {
    const bars = p.shown,
      last = bars.at(-1).time;
    const days = { "1D": 1, "5D": 5 }[code];
    if (days) {
      // a market open around the clock: the last N days; a stock: its last N sessions
      // (5D on a Monday reaches back to last Tuesday, 1D is the last session)
      if (exchange(p.cfg.symbol) !== "US") return last - days * 86400;
      let seen = 0,
        prevDay = null,
        start = last;
      for (let i = bars.length - 1; i >= 0; i--) {
        const day = Math.floor(p.toChart(bars[i].time) / 86400);
        if (day !== prevDay) {
          if (++seen > days) break;
          prevDay = day;
        }
        start = bars[i].time;
      }
      return start;
    }
    // in the chart's own time (the zone on intraday charts, UTC dates on daily and up)
    const wall = new Date(p.toChart(last) * 1000);
    const y = wall.getUTCFullYear(),
      m = wall.getUTCMonth(),
      d = wall.getUTCDate();
    const back = { "1M": [0, 1], "3M": [0, 3], "6M": [0, 6], "1Y": [1, 0], "5Y": [5, 0] }[code];
    if (back) return p.fromChart(Date.UTC(y - back[0], m - back[1], d, wall.getUTCHours(), wall.getUTCMinutes()) / 1000);
    if (code === "YTD") return p.fromChart(Date.UTC(y, 0, 1) / 1000);
    return -Infinity;
  }

  async pick(code) {
    const app = this.app,
      p = app.active;
    if (!p) return;
    const tf = RANGES.find(([k]) => k === code)[1];
    if (p.cfg.tf !== tf) await app.setTf(tf);
    if (app.active !== p || !p.shown.length) return;
    this.show(p, code);
  }

  // Fit the range into view: from its first bar to the last (and the right margin).
  show(p, code) {
    const bars = p.shown,
      n = bars.length,
      m = p.cs.marginRight ?? 10;
    const start = this.startOf(code, p);
    let i = bars.findIndex((b) => b.time >= start);
    if (i < 0) i = n - 1;
    // the library keeps bars at least half a pixel apart; a long range on a narrow chart needs less
    const ts = p.chart.timeScale(),
      need = n - 1 + m - i,
      w = ts.width();
    if (w > 0 && need * 0.5 > w) ts.applyOptions({ minBarSpacing: Math.max(0.05, (w / need) * 0.9) });
    ts.setVisibleLogicalRange({ from: i, to: n - 1 + m });
    // a feed with fewer bars than the range (Kraken's 720) shows what it has, and says so
    const sec = parseTf(p.cfg.tf).seconds;
    if (Number.isFinite(start) && i === 0 && bars[0].time - start > sec * 2)
      this.app.toast(`This feed starts at ${esc(p.formatTime(p.toChart(bars[0].time)))} on ${esc(p.cfg.tf)}, so the range is shorter.`);
  }

  // TradingView's Go to: a date (and time), or a custom range.
  openGoTo() {
    const app = this.app,
      p = app.active;
    if (!p?.shown.length) return;
    const ts = p.chart.timeScale(),
      r = ts.getVisibleLogicalRange();
    // times here are UTC; the inputs show them in the chart's own time
    const mid = p.timeOfLogical(r ? Math.round((r.from + r.to) / 2) : p.shown.length - 1) ?? p.shown.at(-1).time;
    const intraday = parseTf(p.cfg.tf).seconds < 86400;
    const first = p.shown[0].time;
    const span = r ? Math.max(20, r.to - r.from) : 160;
    const end = p.timeOfLogical(Math.min(p.shown.length - 1, Math.round(r?.to ?? p.shown.length - 1))) ?? mid;
    const startT = p.timeOfLogical(Math.max(0, Math.round(r?.from ?? 0))) ?? first;
    const dt = (key, t) =>
      `<div class="rb-dt"><input type="date" class="cs-num" data-d="${key}" value="${dateVal(p.toChart(t))}">${intraday ? `<input type="time" class="cs-num" data-t="${key}" value="${timeVal(p.toChart(t))}">` : ""}</div>`;
    const card = app.modal(
      "Go to",
      `<div class="rb-tabs"><button data-tab="date" class="on">Date</button><button data-tab="range">Custom range</button></div>
      <div class="rb-pane" data-pane="date">${dt("at", mid)}</div>
      <div class="rb-pane" data-pane="range" hidden><label class="rb-lab">Start</label>${dt("from", startT)}<label class="rb-lab">End</label>${dt("to", end)}</div>`,
      { foot: '<span class="spacer"></span><button class="btn" data-x="cancel">Cancel</button><button class="btn cs-ok" data-x="go">Go to</button>' },
    );
    card.classList.add("rb-card");
    let tab = "date";
    const read = (key) => {
      const wall = wallOf(card.querySelector(`[data-d="${key}"]`).value, card.querySelector(`[data-t="${key}"]`)?.value);
      return Number.isFinite(wall) ? p.fromChart(wall) : NaN;
    };
    const indexAt = (t) => {
      const i = p.shown.findIndex((b) => b.time >= t);
      return i < 0 ? p.shown.length - 1 : i;
    };
    const go = () => {
      const n = p.shown.length,
        m = p.cs.marginRight ?? 10;
      if (tab === "date") {
        const t = read("at");
        if (!Number.isFinite(t)) return app.toast("Pick a date.", "err");
        const i = indexAt(t);
        if (t < first) app.toast(`The loaded data starts at ${esc(p.formatTime(p.toChart(first)))}.`);
        // centred on the date, but never past the last bar (the view keeps its width)
        const to = Math.min(i + span / 2, n - 1 + m);
        ts.setVisibleLogicalRange({ from: to - span, to });
      } else {
        let a = read("from"),
          b = read("to");
        if (!Number.isFinite(a) || !Number.isFinite(b)) return app.toast("Pick both dates.", "err");
        if (b < a) [a, b] = [b, a];
        const i = indexAt(a);
        let j = indexAt(b);
        if (p.shown[j].time > b && j > i) j--;
        ts.setVisibleLogicalRange({ from: i, to: Math.max(j, i + 1) });
      }
      app.closeModal();
    };
    card.onclick = (e) => {
      const t = e.target.closest("[data-tab]")?.dataset.tab;
      if (t) {
        tab = t;
        card.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
        card.querySelectorAll("[data-pane]").forEach((el) => (el.hidden = el.dataset.pane !== t));
        return;
      }
      const x = e.target.closest("[data-x]")?.dataset.x;
      if (x === "cancel") app.closeModal();
      if (x === "go") go();
    };
    card.onkeydown = (e) => {
      if (e.key === "Enter") go();
    };
    card.querySelector('[data-d="at"]').focus();
  }
}
