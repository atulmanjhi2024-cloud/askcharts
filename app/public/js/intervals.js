// TradingView's interval menu: one toolbar button showing the chart's interval, opening seconds,
// minutes, hours and days (each section folds), a star on each to pin it to the toolbar, custom
// intervals, and a number typed on the chart to change the interval ("5", "4h", "1D").
import { esc } from "./api.js";
import { parseTf } from "../lib/series.js";

const SECTIONS = [
  ["ticks", "Ticks", ["1T", "10T", "100T", "1000T"]],
  ["seconds", "Seconds", ["1s", "5s", "10s", "15s", "30s", "45s"]],
  ["minutes", "Minutes", ["1m", "2m", "3m", "5m", "10m", "15m", "30m", "45m"]],
  ["hours", "Hours", ["1h", "2h", "3h", "4h"]],
  ["days", "Days", ["1D", "1W", "2W", "1M", "3M", "6M", "12M"]],
];
const SECTION_OF = { s: "seconds", m: "minutes", h: "hours", D: "days", W: "days", M: "days" };
const UNIT_NAME = { s: "second", m: "minute", h: "hour", D: "day", W: "week", M: "month", T: "tick" };
const svg = (b) => `<svg viewBox="0 0 18 18">${b}</svg>`;
const ICON_STAR = svg('<path d="M9 2.6l1.9 4 4.3.5-3.2 2.9.9 4.3L9 12.2l-3.9 2.1.9-4.3-3.2-2.9 4.3-.5z"/>');
const ICON_PLUS = svg('<path d="M9 3.5v11M3.5 9h11"/>');
const ICON_X = svg('<path d="M5 5l8 8M13 5l-8 8"/>');
const CHEVRON = svg('<path d="M5 7.5l4 4 4-4"/>');
const TICKS = "Tick charts need every single trade, which the free feeds here don't keep.";

const unitOf = (tf) => /T$/.test(tf) ? { n: parseInt(tf, 10), unit: "T" } : parseTf(tf);
export function longName(tf) {
  const { n, unit } = unitOf(tf);
  return `${n} ${UNIT_NAME[unit]}${n > 1 ? "s" : ""}`;
}
// The toolbar label: 1D shows as D, 1W as W, 1M as M, the rest as written.
export const shortName = (tf) => (/^1[DWM]$/.test(tf) ? tf.slice(1) : tf);

// What's typed on the chart: "5" is minutes, then s, m, h, d, w and M (months) as units.
export function parseTyped(v) {
  const m = /^(\d*)\s*([smhdwSHDWM]?)$/.exec(String(v).trim());
  if (!m || (!m[1] && !m[2])) return null;
  const n = Number(m[1] || 1);
  const unit = { "": "m", s: "s", S: "s", m: "m", h: "h", H: "h", d: "D", D: "D", w: "W", W: "W", M: "M" }[m[2]];
  if (!(n >= 1) || n > 9999) return null;
  try {
    parseTf(`${n}${unit}`);
    return `${n}${unit}`;
  } catch {
    return null;
  }
}

export class IntervalMenu {
  constructor(app) {
    this.app = app;
    this.box = document.querySelector("#tfButtons");
    this.box.onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.tf) return this.app.setTf(b.dataset.tf);
      if (b.dataset.menu) this.open(b);
    };
  }
  get s() {
    return this.app.settings;
  }
  favs() {
    return (this.s.intervalFavs ||= []);
  }
  customs() {
    return (this.s.customIntervals ||= []);
  }
  folds() {
    return (this.s.intervalFolds ||= { ticks: true });
  }

  // Pinned intervals as buttons, then the menu button (it names the interval when that isn't pinned).
  render() {
    const cur = this.app.active?.cfg.tf || "1D",
      favs = [...this.favs()].sort((a, b) => parseTf(a).seconds - parseTf(b).seconds);
    const pinned = favs.includes(cur);
    this.box.innerHTML = `${favs.map((tf) => `<button data-tf="${esc(tf)}" class="${tf === cur ? "active" : ""}" title="${esc(longName(tf))}">${esc(shortName(tf))}</button>`).join("")}<button data-menu="1" class="iv-btn${pinned ? " only" : ""}" title="${esc(longName(cur))}. Click for intervals, or type a number on the chart.">${pinned ? "" : `<span>${esc(shortName(cur))}</span>`}${pinned || favs.length ? CHEVRON : ""}</button>`;
  }

  open(btn) {
    const tb = this.app.drawToolbar;
    const pop = tb.openPopover(btn, this.html(), "iv-menu");
    pop.classList.add("iv-menu");
    this.pop = pop;
    this.btn = btn;
    this.place();
    pop.querySelector(".iv-item.on")?.scrollIntoView({ block: "nearest" });
    pop.onclick = (e) => this.onClick(e);
  }
  place() {
    const r = this.btn.getBoundingClientRect(),
      pop = this.pop;
    pop.style.left = `${Math.max(4, r.left)}px`;
    pop.style.top = `${r.bottom + 4}px`;
    pop.style.maxHeight = `${innerHeight - r.bottom - 12}px`;
  }
  html() {
    const cur = this.app.active?.cfg.tf,
      favs = this.favs(),
      customs = this.customs(),
      folds = this.folds();
    let h = `<button class="iv-add" data-act="add">${ICON_PLUS}<span>Add custom interval…</span></button>`;
    for (const [key, label, presets] of SECTIONS) {
      const extra = customs.filter((tf) => SECTION_OF[parseTf(tf).unit] === key && !presets.includes(tf));
      const items = [...presets, ...extra].sort((a, b) => (key === "ticks" ? 0 : parseTf(a).seconds - parseTf(b).seconds));
      const shut = !!folds[key];
      h += `<div class="iv-sec${shut ? " shut" : ""}" data-sec="${key}"><span>${label}</span>${CHEVRON}</div>`;
      if (shut) continue;
      for (const tf of items) {
        if (key === "ticks") {
          h += `<div class="iv-item dis" title="${esc(TICKS)}"><span>${esc(longName(tf))}</span></div>`;
          continue;
        }
        const fav = favs.includes(tf),
          custom = extra.includes(tf);
        h += `<div class="iv-item${tf === cur ? " on" : ""}" data-tf="${esc(tf)}"><span>${esc(longName(tf))}</span>${custom ? `<button class="iv-x" data-del="${esc(tf)}" title="Remove this interval">${ICON_X}</button>` : ""}<button class="iv-star${fav ? " fav" : ""}" data-star="${esc(tf)}" title="${fav ? "Remove from favorites" : "Add to favorites"}">${ICON_STAR}</button></div>`;
      }
    }
    return h;
  }
  refreshMenu() {
    const top = this.pop.scrollTop;
    this.pop.innerHTML = this.html();
    this.pop.scrollTop = top;
  }
  onClick(e) {
    const t = e.target;
    const star = t.closest("[data-star]")?.dataset.star,
      del = t.closest("[data-del]")?.dataset.del,
      sec = t.closest("[data-sec]")?.dataset.sec,
      tf = t.closest(".iv-item[data-tf]")?.dataset.tf;
    if (star) {
      const favs = this.favs();
      this.s.intervalFavs = favs.includes(star) ? favs.filter((x) => x !== star) : [...favs, star];
      this.app.persist();
      this.render();
      this.btn = this.box.querySelector("[data-menu]");
      this.place();
      return this.refreshMenu();
    }
    if (del) {
      this.s.customIntervals = this.customs().filter((x) => x !== del);
      this.s.intervalFavs = this.favs().filter((x) => x !== del);
      this.app.persist();
      this.render();
      return this.refreshMenu();
    }
    if (sec) {
      const f = this.folds();
      f[sec] = !f[sec];
      this.app.persist();
      return this.refreshMenu();
    }
    if (t.closest("[data-act=add]")) return this.addForm();
    if (tf) {
      this.app.drawToolbar.closePopover();
      this.app.setTf(tf);
    }
  }
  // Add custom interval: a number and a unit, added to its section and opened.
  addForm() {
    const pop = this.pop;
    pop.innerHTML = `<div class="iv-form"><div class="iv-form-h">Add custom interval</div><label>Interval<input type="number" min="1" max="9999" value="2"></label><label>Type<select><option value="s">Seconds</option><option value="m" selected>Minutes</option><option value="h">Hours</option><option value="D">Days</option><option value="W">Weeks</option><option value="M">Months</option></select></label><div class="iv-form-msg"></div><div class="iv-form-b"><button class="btn small" data-f="cancel">Cancel</button><button class="btn small primary" data-f="add">Add</button></div></div>`;
    const n = pop.querySelector("input"),
      u = pop.querySelector("select"),
      msg = pop.querySelector(".iv-form-msg");
    n.focus();
    n.select();
    const add = () => {
      const tf = parseTyped(`${Number(n.value)}${u.value === "m" ? "" : u.value}`);
      if (!tf) return (msg.textContent = "Use a whole number from 1 to 9999.");
      const preset = SECTIONS.some(([, , p]) => p.includes(tf));
      if (!preset && !this.customs().includes(tf)) this.s.customIntervals = [...this.customs(), tf];
      this.app.persist();
      this.app.drawToolbar.closePopover();
      this.app.setTf(tf);
    };
    pop.onclick = (e) => {
      const f = e.target.closest("[data-f]")?.dataset.f;
      if (f === "add") add();
      if (f === "cancel") {
        pop.onclick = (ev) => this.onClick(ev);
        this.refreshMenu();
      }
    };
    n.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Enter") add();
      if (e.key === "Escape") this.app.drawToolbar.closePopover();
    };
  }

  // A number typed on the chart opens "Change interval", as on TradingView.
  quickChange(first) {
    this.closeQuick();
    const el = document.createElement("div");
    el.className = "iv-quick";
    el.innerHTML = `<div class="iv-quick-h">Change interval</div><input value="${esc(first)}" spellcheck="false" autocomplete="off"><div class="iv-quick-hint"></div>`;
    document.body.appendChild(el);
    const inp = el.querySelector("input"),
      hint = el.querySelector(".iv-quick-hint");
    const show = () => {
      const tf = parseTyped(inp.value);
      hint.textContent = tf ? longName(tf) : "Not a valid interval";
      hint.classList.toggle("bad", !tf);
    };
    inp.oninput = show;
    inp.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Escape") this.closeQuick();
      if (e.key === "Enter") {
        const tf = parseTyped(inp.value);
        if (!tf) return;
        this.closeQuick();
        this.app.setTf(tf);
      }
    };
    inp.onblur = () => setTimeout(() => this.closeQuick(), 100);
    show();
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
    this.quick = el;
  }
  closeQuick() {
    this.quick?.remove();
    this.quick = null;
  }
}
