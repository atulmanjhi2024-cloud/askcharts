// TradingView's chart layouts (the name at the top right: save, autosave, copy, rename, new, open,
// recently used) and indicator templates (the four squares beside Indicators: save the chart's
// indicators under a name and put them back on any chart).
import { esc, ticker } from "./api.js";
import { BY_ID } from "../lib/indicators.js";
import { newUid } from "./chart.js";
import { CHART_DEFAULTS } from "./chartsettings.js";

const svg = (b) => `<svg viewBox="0 0 24 24">${b}</svg>`;
const I = {
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>'),
  rename: svg('<path d="M15.5 5.5l3 3L8 19H5v-3zM13.5 7.5l3 3"/>'),
  download: svg('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  folder: svg('<path d="M4 7.5A1.5 1.5 0 0 1 5.5 6H10l2 2h6.5A1.5 1.5 0 0 1 20 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/>'),
  info: svg('<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8.2v.3"/>'),
  save: svg('<path d="M5 5h11l3 3v11H5zM8 5v5h7V5M8 19v-6h8v6"/>'),
  star: '<svg viewBox="0 0 18 18"><path d="M9 2.6l1.9 4 4.3.5-3.2 2.9.9 4.3L9 12.2l-3.9 2.1.9-4.3-3.2-2.9 4.3-.5z"/></svg>',
  trash: svg('<path d="M5 7h14M10 11v6M14 11v6M7 7l1 12h8l1-12M9.5 7V5h5v2"/>'),
  chev: '<svg viewBox="0 0 18 18" class="lb-chev"><path d="M5 7.5l4 4 4-4"/></svg>',
};
const mac = /Mac|iPhone|iPad/.test(navigator.platform || "");
// "XRPUSD, 15" as TradingView writes a chart: minutes as a number, days, weeks and months as 1D...
export function chartLabel(cfg) {
  if (!cfg) return "";
  const m = /^(\d+)([smhDWM])$/.exec(cfg.tf || "");
  const tf = !m ? cfg.tf : m[2] === "m" ? m[1] : m[2] === "h" ? String(Number(m[1]) * 60) : m[2] === "s" ? `${m[1]}S` : `${m[1]}${m[2]}`;
  return `${ticker(cfg.symbol)}, ${tf}`;
}
const when = (t) => (t ? new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const id = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ======================================================================= layouts
export class Layouts {
  constructor(app) {
    this.app = app;
    this.btn = document.querySelector("#layoutBtn");
    this.btn.onclick = (e) => {
      if (e.target.closest(".lb-save")) return this.save();
      this.menu();
    };
    const s = app.state;
    s.layouts ||= {};
    // the first time: what's on screen becomes the first layout
    if (!s.layoutId || !s.layouts[s.layoutId]) {
      const first = Object.keys(s.layouts)[0];
      if (first) s.layoutId = first;
      else {
        s.layoutId = id("L");
        s.layouts[s.layoutId] = { name: "Unnamed", snap: this.snapshot(), saved: Date.now(), opened: Date.now() };
      }
    }
    if (app.settings.layoutAutosave === undefined) app.settings.layoutAutosave = true;
  }
  get all() {
    return this.app.state.layouts;
  }
  get cur() {
    return this.all[this.app.state.layoutId];
  }
  snapshot() {
    const app = this.app;
    return {
      layout: app.state.layout,
      panes: structuredClone(app.panes.length ? app.panes.map((p) => p.cfg) : app.state.panes),
      active: Math.max(0, app.panes.indexOf(app.active)),
      chart: structuredClone(app.settings.chart),
    };
  }
  dirty() {
    return this.cur && JSON.stringify(this.cur.snap) !== JSON.stringify(this.snapshot());
  }
  // Called on every save of the app's state: autosave keeps the layout in step, otherwise the
  // button offers Save.
  changed() {
    if (this.loading || !this.cur) return;
    if (this.app.settings.layoutAutosave) {
      if (this.dirty()) {
        this.cur.snap = this.snapshot();
        this.cur.saved = Date.now();
      }
    }
    this.render();
  }
  render() {
    const c = this.cur,
      dirty = !this.app.settings.layoutAutosave && this.dirty();
    this.btn.innerHTML = `<span class="lb-text"><span class="lb-name">${esc(c?.name || "Unnamed")}</span>${dirty ? '<span class="lb-save" title="Save layout">Save</span>' : ""}</span>${I.chev}`;
    this.btn.title = `${c?.name || "Unnamed"}${dirty ? " (unsaved changes)" : ""}: save, copy, rename, open or create a layout`;
  }
  save(quiet = false) {
    if (!this.cur) return;
    this.cur.snap = this.snapshot();
    this.cur.saved = Date.now();
    this.app.persist();
    this.render();
    if (!quiet) this.app.toast(`Saved the layout "${esc(this.cur.name)}"`);
  }
  // Put a saved layout on screen: its grid, charts (symbols, intervals, indicators) and settings.
  load(lid) {
    const L = this.all[lid];
    if (!L) return;
    const app = this.app,
      snap = structuredClone(L.snap);
    this.loading = true;
    for (const p of app.panes) p.destroy();
    app.panes = [];
    app.active = null;
    document.querySelector("#grid").innerHTML = "";
    app.state.panes = snap.panes;
    app.state.active = snap.active || 0;
    app.state.layoutId = lid;
    app.settings.chart = { ...structuredClone(CHART_DEFAULTS), ...(snap.chart || {}) };
    L.opened = Date.now();
    app.setLayout(snap.layout || "1", false);
    this.loading = false;
    app.persist();
    this.render();
  }
  // Leaving a layout with unsaved changes (autosave off) asks first.
  leave(then) {
    if (this.app.settings.layoutAutosave || !this.dirty()) return then();
    const tb = this.app.drawToolbar;
    const pop = tb.openPopover(this.btn, `<div class="lt-form"><div>Save the changes to <b>${esc(this.cur.name)}</b> first?</div><div class="lt-form-b"><button class="btn small" data-x="no">Don't save</button><button class="btn small primary" data-x="ok">Save</button></div></div>`, "lt-leave");
    pop.classList.add("lt-pop");
    this.under(pop, this.btn, true);
    pop.querySelector("[data-x=ok]").onclick = () => {
      tb.closePopover();
      this.save(true);
      then();
    };
    pop.querySelector("[data-x=no]").onclick = () => {
      tb.closePopover();
      then();
    };
  }
  under(pop, btn, right) {
    const r = btn.getBoundingClientRect();
    pop.style.left = `${Math.max(4, right ? r.right - pop.offsetWidth : r.left)}px`;
    pop.style.top = `${r.bottom + 4}px`;
  }
  menu() {
    const app = this.app,
      tb = app.drawToolbar,
      auto = !!app.settings.layoutAutosave;
    const recent = Object.entries(this.all)
      .sort((a, b) => (b[1].opened || 0) - (a[1].opened || 0))
      .slice(0, 4);
    const pop = tb.openPopover(
      this.btn,
      `<button data-m="save" class="${auto && !this.dirty() ? "dim" : ""}"><span>Save layout</span><kbd>${mac ? "⌘ S" : "Ctrl+S"}</kbd></button>
      <label class="lt-sw"><span>Autosave</span><input type="checkbox" data-m="auto" ${auto ? "checked" : ""}><i></i></label>
      <label class="lt-sw dis" title="Sharing publishes a layout on TradingView. This app is private to you, so there's nowhere to share it."><span>Share layout ${I.info}</span><input type="checkbox" disabled><i></i></label>
      <button data-m="copy">${I.copy}<span>Make a copy…</span></button>
      <button data-m="rename">${I.rename}<span>Rename…</span></button>
      <button data-m="csv">${I.download}<span>Download chart data…</span></button>
      <hr><button data-m="new">${I.plus}<span>Create new layout…</span></button>
      <hr><div class="lt-h">Recently used</div>
      ${recent.map(([lid, L]) => `<button data-open="${esc(lid)}" class="lt-recent${lid === app.state.layoutId ? " on" : ""}"><span>${esc(L.name)}</span><small>${esc(chartLabel(L.snap?.panes?.[L.snap.active || 0] || L.snap?.panes?.[0]))}</small></button>`).join("")}
      <hr><button data-m="open">${I.folder}<span>Open layout…</span><kbd>.</kbd></button>`,
      "lt-menu",
    );
    pop.classList.add("dtb-list", "lt-pop", "lt-menu");
    this.under(pop, this.btn, true);
    pop.onchange = (e) => {
      if (e.target.dataset.m === "auto") {
        app.settings.layoutAutosave = e.target.checked;
        if (e.target.checked) this.save(true);
        app.persist();
        this.render();
      }
    };
    pop.onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const m = b.dataset.m,
        open = b.dataset.open;
      tb.closePopover();
      if (open && open !== app.state.layoutId) return this.leave(() => this.load(open));
      if (m === "save") return this.save();
      if (m === "csv") return app.exportCsv();
      if (m === "rename") return this.nameDialog("Rename layout", this.cur.name, (n) => {
        this.cur.name = n;
        app.persist();
        this.render();
      });
      if (m === "copy") return this.nameDialog("Make a copy", `${this.cur.name} copy`, (n) => {
        const lid = id("L");
        this.all[lid] = { name: n, snap: this.snapshot(), saved: Date.now(), opened: Date.now() };
        app.state.layoutId = lid;
        app.persist();
        this.render();
        app.toast(`Now on the copy, "${esc(n)}"`);
      });
      if (m === "new") return this.nameDialog("Create new layout", "Unnamed", (n) => this.leave(() => {
        const lid = id("L"),
          cfg = app.active?.cfg;
        this.all[lid] = {
          name: n,
          snap: { layout: "1", panes: [{ symbol: cfg?.symbol || "BINANCE:BTCUSDT", tf: cfg?.tf || "1D", type: "candles", indicators: [], compare: [], log: false }], active: 0, chart: structuredClone(app.settings.chart) },
          saved: Date.now(),
          opened: Date.now(),
        };
        this.load(lid);
      }));
      if (m === "open") return this.openDialog();
    };
  }
  nameDialog(title, value, done) {
    const card = this.app.modal(title, `<label class="field">Layout name<input class="in" id="ltName" maxlength="60" value="${esc(value)}"></label>`, { foot: '<button class="btn" data-x="no">Cancel</button><button class="btn primary" data-x="ok">Save</button>' });
    const inp = card.querySelector("#ltName");
    inp.focus();
    inp.select();
    const ok = () => {
      const n = inp.value.trim();
      if (!n) return inp.focus();
      this.app.closeModal();
      done(n);
    };
    card.querySelector("[data-x=ok]").onclick = ok;
    card.querySelector("[data-x=no]").onclick = () => this.app.closeModal();
    // a block body: an on… handler that returns false cancels the key, so nothing could be typed
    inp.onkeydown = (e) => {
      if (e.key === "Enter") ok();
    };
  }
  openDialog() {
    const app = this.app;
    const card = app.modal("Open layout", `<div class="ss-box"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5l5 5"/></svg><input id="ltQ" placeholder="Search" autocomplete="off"></div><div class="lt-head"><span>Layout name</span><span>Charts</span><span>Modified</span><span></span></div><div class="lt-list"></div>`);
    card.classList.add("lt-card");
    const box = card.querySelector(".lt-list"),
      q = card.querySelector("#ltQ");
    const draw = () => {
      const t = q.value.trim().toLowerCase();
      const rows = Object.entries(this.all)
        .filter(([, L]) => !t || L.name.toLowerCase().includes(t))
        .sort((a, b) => (b[1].opened || 0) - (a[1].opened || 0));
      box.innerHTML = rows
        .map(([lid, L]) => {
          const charts = (L.snap?.panes || []).map(chartLabel).join(" · ");
          return `<div class="lt-row${lid === app.state.layoutId ? " on" : ""}" data-id="${esc(lid)}"><span class="lt-n">${esc(L.name)}</span><span class="lt-c">${esc(charts)}</span><span class="lt-d">${esc(when(L.saved))}</span>${lid === app.state.layoutId ? '<span class="lt-cur">Open</span>' : `<button class="lt-del" data-del="${esc(lid)}" title="Delete layout">${I.trash}</button>`}</div>`;
        })
        .join("");
    };
    q.oninput = draw;
    box.onclick = (e) => {
      const del = e.target.closest("[data-del]")?.dataset.del;
      if (del) {
        const row = e.target.closest(".lt-row");
        if (row.dataset.confirm) {
          delete this.all[del];
          app.persist();
          return draw();
        }
        row.dataset.confirm = "1";
        row.querySelector(".lt-d").textContent = "Click the bin again to delete";
        return;
      }
      const lid = e.target.closest("[data-id]")?.dataset.id;
      if (!lid) return;
      app.closeModal();
      if (lid !== app.state.layoutId) this.leave(() => this.load(lid));
    };
    draw();
    q.focus();
  }
}

// ======================================================================= indicator templates
export class IndicatorTemplates {
  constructor(app) {
    this.app = app;
    this.btn = document.querySelector("#indTplBtn");
    this.btn.onclick = () => this.menu();
  }
  get all() {
    return (this.app.state.indicatorTemplates ||= {});
  }
  names(t) {
    return t.indicators.map((x) => BY_ID[x.id]?.name || x.id).join(", ");
  }
  menu() {
    const tb = this.app.drawToolbar;
    const list = Object.entries(this.all).sort((a, b) => (b[1].fav ? 1 : 0) - (a[1].fav ? 1 : 0) || (b[1].used || 0) - (a[1].used || 0));
    const pop = tb.openPopover(
      this.btn,
      `<button data-m="save">${I.save}<span>Save indicator template…</span></button>${list.length ? `<hr><div class="lt-h">Recently used</div>${list
        .slice(0, 6)
        .map(([tid, t]) => `<div class="it-row" data-use="${esc(tid)}"><div class="it-txt"><span>${esc(t.name)}</span><small>${esc(this.names(t))}</small></div><button class="it-star${t.fav ? " fav" : ""}" data-star="${esc(tid)}" title="${t.fav ? "Remove from favorites" : "Add to favorites"}">${I.star}</button></div>`)
        .join("")}` : ""}<hr><button data-m="open">${I.folder}<span>Open template…</span></button>`,
      "it-menu",
    );
    pop.classList.add("dtb-list", "lt-pop", "it-menu");
    const r = this.btn.getBoundingClientRect();
    pop.style.left = `${Math.max(4, r.left)}px`;
    pop.style.top = `${r.bottom + 4}px`;
    pop.onclick = (e) => {
      const star = e.target.closest("[data-star]")?.dataset.star;
      if (star) {
        this.all[star].fav = !this.all[star].fav;
        this.app.persist();
        tb.closePopover();
        return this.menu();
      }
      const use = e.target.closest("[data-use]")?.dataset.use;
      const m = e.target.closest("[data-m]")?.dataset.m;
      if (!use && !m) return;
      tb.closePopover();
      if (use) return this.apply(use);
      if (m === "save") return this.saveDialog();
      if (m === "open") return this.openDialog();
    };
  }
  saveDialog() {
    const app = this.app,
      p = app.active;
    if (!p?.cfg.indicators.length) return app.toast("Add indicators to the chart first; a template saves the ones on it.");
    const card = app.modal(
      "Save indicator template",
      `<label class="field">Template name<input class="in" id="itName" maxlength="60" placeholder="Template name"></label>
      <p class="hint-text">Saves ${esc(p.cfg.indicators.map((x) => BY_ID[x.id]?.name || x.id).join(", "))}, with their settings and colours.</p>
      <label class="cs-chk"><input type="checkbox" id="itSym"><span class="cs-box"></span><span>Remember symbol (${esc(ticker(p.cfg.symbol))})</span></label>
      <label class="cs-chk" style="margin-top:8px"><input type="checkbox" id="itTf"><span class="cs-box"></span><span>Remember interval (${esc(p.cfg.tf)})</span></label>`,
      { foot: '<button class="btn" data-x="no">Cancel</button><button class="btn primary" data-x="ok">Save</button>' },
    );
    const inp = card.querySelector("#itName");
    inp.focus();
    const ok = () => {
      const n = inp.value.trim();
      if (!n) return inp.focus();
      const existing = Object.entries(this.all).find(([, t]) => t.name === n)?.[0];
      this.all[existing || id("T")] = {
        name: n,
        // with the Settings dialog's Style and Visibility choices, a strategy's Properties, and the pane chosen from More
        indicators: structuredClone(p.cfg.indicators).map(({ uid, id: iid, params, colors, tf, hidden, log, style, vis, overlay, props }) => ({ uid, id: iid, params, colors, tf, hidden, log, style, vis, overlay, props })),
        symbol: card.querySelector("#itSym").checked ? p.cfg.symbol : null,
        tf: card.querySelector("#itTf").checked ? p.cfg.tf : null,
        used: Date.now(),
        fav: existing ? this.all[existing].fav : false,
      };
      app.closeModal();
      app.persist();
      app.toast(`Saved the template "${esc(n)}"`);
    };
    card.querySelector("[data-x=ok]").onclick = ok;
    card.querySelector("[data-x=no]").onclick = () => app.closeModal();
    // a block body: an on… handler that returns false cancels the key, so nothing could be typed
    inp.onkeydown = (e) => {
      if (e.key === "Enter") ok();
    };
  }
  // A template replaces the chart's indicators (as on TradingView), each with a fresh id; one
  // built on another keeps pointing at its source.
  apply(tid) {
    const app = this.app,
      p = app.active,
      t = this.all[tid];
    if (!p || !t) return;
    if (app.settings.lockIndicators) return app.toast("Indicators are locked. Unlock them from the lock button on the left.");
    const map = new Map(),
      missing = [];
    const list = [];
    for (const x of structuredClone(t.indicators)) {
      if (!BY_ID[x.id]) {
        missing.push(x.id);
        continue;
      }
      const uid = newUid();
      map.set(x.uid, uid);
      list.push({ ...x, uid });
    }
    for (const x of list) {
      const src = String(x.params?.source || "");
      if (src.startsWith("ind:")) {
        const [, old, key] = src.split(":");
        x.params.source = map.has(old) ? `ind:${map.get(old)}:${key}` : "close";
      }
    }
    p.cfg.indicators = list;
    t.used = Date.now();
    if (t.symbol || t.tf) {
      if (t.symbol) p.cfg.symbol = t.symbol;
      if (t.tf) p.cfg.tf = t.tf;
      p.load();
    } else p.render(false);
    app.syncToolbar();
    app.persist();
    app.toast(`Applied "${esc(t.name)}"${missing.length ? `. ${missing.length} of its indicators aren't here any more` : ""}`);
  }
  openDialog() {
    const app = this.app;
    const card = app.modal("Indicator templates", `<div class="ss-box"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5l5 5"/></svg><input id="itQ" placeholder="Search" autocomplete="off"></div><div class="lt-list it-list"></div>`);
    card.classList.add("lt-card");
    const box = card.querySelector(".it-list"),
      q = card.querySelector("#itQ");
    const draw = () => {
      const s = q.value.trim().toLowerCase();
      const rows = Object.entries(this.all)
        .filter(([, t]) => !s || `${t.name} ${this.names(t)}`.toLowerCase().includes(s))
        .sort((a, b) => a[1].name.localeCompare(b[1].name));
      box.innerHTML =
        rows
          .map(([tid, t]) => `<div class="it-row big" data-use="${esc(tid)}"><button class="it-star${t.fav ? " fav" : ""}" data-star="${esc(tid)}" title="Favorite">${I.star}</button><div class="it-txt"><span>${esc(t.name)}</span><small>${esc(this.names(t))}${t.symbol || t.tf ? ` · ${esc([t.symbol && ticker(t.symbol), t.tf].filter(Boolean).join(", "))}` : ""}</small></div><button class="lt-del" data-del="${esc(tid)}" title="Delete template">${I.trash}</button></div>`)
          .join("") || '<div class="ix-empty">No templates yet. Put indicators on a chart, then Save indicator template.</div>';
    };
    q.oninput = draw;
    box.onclick = (e) => {
      const star = e.target.closest("[data-star]")?.dataset.star;
      if (star) {
        this.all[star].fav = !this.all[star].fav;
        app.persist();
        return draw();
      }
      const del = e.target.closest("[data-del]")?.dataset.del;
      if (del) {
        delete this.all[del];
        app.persist();
        return draw();
      }
      const use = e.target.closest("[data-use]")?.dataset.use;
      if (use) {
        app.closeModal();
        this.apply(use);
      }
    };
    draw();
    q.focus();
  }
}
