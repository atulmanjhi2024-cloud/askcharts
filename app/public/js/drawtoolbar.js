// The floating toolbar TradingView shows for a selected drawing: template, line colour, fill,
// text, width, line style, settings, alert, lock, delete and more. Each tool shows only the
// controls its drawing uses (TOOL_OPTIONS). Drag it by the grip; it remembers where it was put.
import { TOOL_BY_ID, TOOL_OPTIONS, colorOf, parseLink } from "./drawings.js";
import { esc } from "./api.js";

const svg = (body) => `<svg viewBox="0 0 24 24">${body}</svg>`;
const ICON = {
  grip: svg('<circle cx="9" cy="6" r="1.1"/><circle cx="15" cy="6" r="1.1"/><circle cx="9" cy="12" r="1.1"/><circle cx="15" cy="12" r="1.1"/><circle cx="9" cy="18" r="1.1"/><circle cx="15" cy="18" r="1.1"/>'),
  template: svg('<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><path d="M16.75 13.5v6.5M13.5 16.75H20"/>'),
  line: svg('<path d="M4.5 19.5l1-4L16 5l3 3L8.5 18.5zM14 7l3 3"/>'),
  fill: svg('<path d="M4.5 12.5l6.5-6.5 7 7-6.5 6.5zM11 6L8.5 3.5M4.5 12.5h13.5M19.5 15.5c.9 1.4 1.6 2.4 1.6 3.3a1.6 1.6 0 0 1-3.2 0c0-.9.7-1.9 1.6-3.3z"/>'),
  text: svg('<path d="M5 7V5h14v2M12 5v14M9.5 19h5"/>'),
  brush: svg('<path d="M3.5 18c2.2-7 3.3-10 5-10 1.8 0 .4 9.5 2.5 9.5S13.5 8 15.5 8s.6 8.5 2.5 8.5c.9 0 1.6-.8 2.5-2"/>'),
  settings: svg('<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"/><circle cx="12" cy="12" r="3"/>'),
  alert: svg('<circle cx="11" cy="13" r="6.5"/><path d="M11 9.5V13l2.2 1.6M4.5 5.2L7 3.2M17.5 5.2L15 3.2M19 16v6M16 19h6"/>'),
  lockOpen: svg('<rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 7.8-1.2M12 15v2"/>'),
  lockShut: svg('<rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11M12 15v2"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  more: svg('<circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/>'),
};
export const STYLES = [
  ["solid", "Solid", ""],
  ["dashed", "Dashed", "6 4"],
  ["dotted", "Dotted", "1.5 3"],
];
export const lineIcon = (dash, w = 2) => `<svg viewBox="0 0 28 24" class="dtb-line"><path d="M3 12h22" stroke-width="${w}" stroke-dasharray="${dash}"/></svg>`;

// TradingView's colour grid: greys, then ten hues from light to dark.
const HUES = ["#f23645", "#ff9800", "#ffeb3b", "#4caf50", "#089981", "#00bcd4", "#2962ff", "#673ab7", "#9c27b0", "#e91e63"];
const GREYS = ["#ffffff", "#d1d4dc", "#b2b5be", "#9598a1", "#787b86", "#5d606b", "#434651", "#2a2e39", "#131722", "#000000"];
export const rgbOf = (c) => {
  const s = String(c || "").trim();
  const m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const [r, g, b, a = 1] = m[1].split(",").map((x) => parseFloat(x));
    return { r, g, b, a };
  }
  let h = s.replace("#", "");
  if (h.length === 3) h = [...h].map((x) => x + x).join("");
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 1 };
};
export const hexOf = ({ r, g, b }) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
export const cssOf = ({ r, g, b, a }) => (a >= 1 ? hexOf({ r, g, b }) : `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${+a.toFixed(2)})`);
const mix = (hex, to, t) => {
  const p = rgbOf(hex), q = rgbOf(to);
  return hexOf({ r: p.r + (q.r - p.r) * t, g: p.g + (q.g - p.g) * t, b: p.b + (q.b - p.b) * t });
};
export const PALETTE = [GREYS, ...[0.8, 0.6, 0.4, 0.2].map((t) => HUES.map((h) => mix(h, "#ffffff", t))), HUES, ...[0.25, 0.5].map((t) => HUES.map((h) => mix(h, "#000000", t)))];
const WIDTHS = [1, 2, 3, 4];
const BRUSH_WIDTHS = [5, 10, 15, 20, 30, 40];
const FONT_SIZES = [10, 11, 12, 14, 16, 20, 24, 28, 32, 40];
const SIZES = [20, 28, 40, 56, 72, 96, 128];

export class DrawToolbar {
  constructor(app) {
    this.app = app;
    this.el = document.createElement("div");
    this.el.className = "dtb hidden";
    document.body.appendChild(this.el);
    this.el.addEventListener("click", (e) => this.onClick(e));
    this.el.addEventListener("pointerdown", (e) => {
      if (e.target.closest("[data-act=grip]")) this.startDrag(e);
    });
    this.d = this.p = this.pop = null;
  }

  // Follows the selection: shown for a placed, visible, selected drawing on the active chart.
  sync() {
    const p = this.app.active,
      d = p?.drawings?.selected,
      ok = d && !p.drawings.temp && !d.hidden && p.drawings.items.includes(d) && this.app.panes.includes(p);
    if (!ok) {
      if (this.d) this.hide();
      return;
    }
    if (d !== this.d || p !== this.p) {
      this.closePopover();
      this.p = p;
      this.d = d;
      this.render();
      this.place();
    }
  }

  hide() {
    this.stopEditing();
    this.closePopover();
    this.el.classList.add("hidden");
    this.d = this.p = null;
  }

  opts() {
    return TOOL_OPTIONS[this.d.type] || {};
  }

  render() {
    const d = this.d,
      o = this.opts(),
      st = d.style || {},
      color = colorOf(d),
      locked = this.app.isLocked(d),
      off = locked ? " off" : "",
      fill = st.fill ? cssOf({ ...rgbOf(st.fill), a: st.fillAlpha ?? 0.2 }) : cssOf({ ...rgbOf(color), a: st.fillAlpha ?? 0.2 }),
      w = st.width || (d.type === "highlighter" ? 20 : 2),
      dash = STYLES.find(([k]) => k === (st.dash || "solid"))[2],
      canAlert = !!this.app.lineOperandFor?.(d);
    const b = (act, title, inner, cls = "") => `<button data-act="${act}" title="${title}" class="${cls}">${inner}</button>`;
    this.el.innerHTML =
      `<span class="dtb-grip" data-act="grip" title="Drag to move">${ICON.grip}</span>` +
      b("template", "Template", ICON.template) +
      (o.line ? b("line", "Line colour", `${ICON.line}<i class="dtb-bar" style="--c:${color}"></i>`, off) : "") +
      (o.fill ? b("fill", "Fill colour", `${ICON.fill}<i class="dtb-bar" style="--c:${fill}"></i>`, off) : "") +
      (o.text ? b("text", "Text", `${ICON.text}<i class="dtb-bar" style="--c:${st.textColor || color}"></i>`, off) : "") +
      (o.width ? b("width", "Line width", `${lineIcon("", 2)}<span>${w}px</span>`, `wide${off}`) : "") +
      (o.brush ? b("width", "Brush size", `${ICON.brush}<span>${w}px</span>`, `wide${off}`) : "") +
      (o.style ? b("style", "Line style", lineIcon(dash, 2), off) : "") +
      (o.size ? b("size", "Size", `<span>${st.size || 40}px</span>`, `wide${off}`) : "") +
      b("settings", "Settings", ICON.settings, off) +
      (canAlert ? b("alert", "Add alert", ICON.alert) : "") +
      b("lock", locked ? "Unlock" : "Lock", locked ? ICON.lockShut : ICON.lockOpen, locked ? "on" : "") +
      b("delete", "Remove", ICON.trash, off) +
      b("more", "More", ICON.more);
    this.el.classList.remove("hidden");
  }

  // Where the user last put it, else centred over the top of the chart; always kept on screen.
  place() {
    const saved = this.app.settings.drawToolbarPos,
      r = this.p.el.getBoundingClientRect(),
      w = this.el.offsetWidth,
      h = this.el.offsetHeight;
    let x = saved ? saved.x : r.left + (r.width - w) / 2,
      y = saved ? saved.y : r.top + 10;
    x = Math.max(4, Math.min(x, innerWidth - w - 4));
    y = Math.max(4, Math.min(y, innerHeight - h - 4));
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }

  startDrag(e) {
    e.preventDefault();
    const grip = e.target.closest("[data-act=grip]"),
      x0 = e.clientX - this.el.offsetLeft,
      y0 = e.clientY - this.el.offsetTop;
    this.closePopover();
    grip.setPointerCapture(e.pointerId);
    grip.onpointermove = (m) => {
      this.el.style.left = `${Math.max(4, Math.min(m.clientX - x0, innerWidth - this.el.offsetWidth - 4))}px`;
      this.el.style.top = `${Math.max(4, Math.min(m.clientY - y0, innerHeight - this.el.offsetHeight - 4))}px`;
    };
    grip.onpointerup = () => {
      grip.onpointermove = grip.onpointerup = null;
      this.app.settings.drawToolbarPos = { x: this.el.offsetLeft, y: this.el.offsetTop };
      this.app.persist();
    };
  }

  // Redraw and save after any change to the drawing.
  changed() {
    const p = this.p;
    p.drawings.update();
    this.app.saveDrawings(p.drawKey(), p.drawings.items);
    this.app.panels?.onObjectsChange?.();
    if (this.d) this.render();
  }

  style() {
    return (this.d.style ||= {});
  }

  onClick(e) {
    const btn = e.target.closest("button[data-act]");
    if (!btn || !this.d) return;
    const act = btn.dataset.act,
      d = this.d;
    if (btn.classList.contains("off")) return this.app.toast("Unlock the drawing to change it.");
    if (this.pop?.dataset.for === act) return this.closePopover();
    this.closePopover();
    if (act === "line") this.colorPopover(btn, colorOf(d), true, (c) => ((d.color = c), this.changed()));
    if (act === "fill") {
      const st = this.style();
      this.colorPopover(btn, cssOf({ ...rgbOf(st.fill || colorOf(d)), a: st.fillAlpha ?? 0.2 }), true, (c) => {
        const v = rgbOf(c);
        st.fill = hexOf(v);
        st.fillAlpha = v.a;
        this.changed();
      });
    }
    if (act === "text") this.textPopover(btn);
    if (act === "width") {
      const list = d.type === "highlighter" ? BRUSH_WIDTHS : WIDTHS,
        cur = this.style().width || (d.type === "highlighter" ? 20 : 2);
      this.listPopover(btn, list.map((w) => [w, `${lineIcon("", Math.min(w, 8))}<span>${w}px</span>`, w === cur]), (w) => ((this.style().width = w), this.changed()));
    }
    if (act === "style") {
      const cur = this.style().dash || "solid";
      this.listPopover(btn, STYLES.map(([k, label, dash]) => [k, `${lineIcon(dash)}<span>${label}</span>`, k === cur]), (k) => ((this.style().dash = k === "solid" ? undefined : k), this.changed()));
    }
    if (act === "size") {
      const cur = this.style().size || 40;
      this.listPopover(btn, SIZES.map((n) => [n, `<span>${n}px</span>`, n === cur]), (n) => ((this.style().size = n), this.changed()));
    }
    if (act === "settings") this.openSettings();
    if (act === "alert") this.app.alertOnSelectedDrawing();
    if (act === "lock") {
      if (this.app.settings.lockDrawings) return this.app.toast("All drawings are locked. Unlock them from the lock button on the left.");
      d.locked = !d.locked || undefined;
      this.changed();
    }
    if (act === "delete") this.remove();
    if (act === "template") this.templatePopover(btn);
    if (act === "more") this.morePopover(btn);
  }

  remove() {
    const p = this.p, d = this.d;
    if (this.app.isLocked(d)) return this.app.toast("Unlock the drawing to remove it.");
    p.drawings.items = p.drawings.items.filter((x) => x !== d);
    p.drawings.selected = null;
    this.changed();
  }

  // ---------- popovers ----------
  openPopover(btn, html, act) {
    const pop = document.createElement("div");
    pop.className = "dtb-pop";
    pop.dataset.for = act;
    pop.innerHTML = html;
    document.body.appendChild(pop);
    const r = btn.getBoundingClientRect(),
      w = pop.offsetWidth,
      h = pop.offsetHeight;
    const below = r.bottom + 6 + h < innerHeight;
    pop.style.left = `${Math.max(4, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 4))}px`;
    pop.style.top = `${below ? r.bottom + 6 : Math.max(4, r.top - h - 6)}px`;
    this.pop = pop;
    this.onOutside = (e) => {
      if (!pop.contains(e.target) && !this.el.contains(e.target)) this.closePopover();
    };
    document.addEventListener("pointerdown", this.onOutside, true);
    return pop;
  }

  closePopover() {
    if (!this.pop) return false;
    this.pop.remove();
    this.pop = null;
    document.removeEventListener("pointerdown", this.onOutside, true);
    return true;
  }

  listPopover(btn, items, pick) {
    const pop = this.openPopover(btn, items.map(([k, html, on]) => `<button data-k="${k}" class="${on ? "on" : ""}">${html}</button>`).join(""), btn.dataset.act);
    pop.classList.add("dtb-list");
    pop.onclick = (e) => {
      const it = e.target.closest("[data-k]");
      if (!it) return;
      const k = it.dataset.k;
      this.closePopover();
      pick(/^\d+$/.test(k) ? Number(k) : k);
    };
  }

  // The colour grid, an opacity slider and a custom colour.
  colorPopover(btn, current, withOpacity, pick) {
    const cur = rgbOf(current),
      curHex = hexOf(cur);
    const grid = PALETTE.map((row) => `<div class="dtb-row">${row.map((c) => `<button data-c="${c}" class="dtb-sw${c === curHex ? " on" : ""}" style="--c:${c}" title="${c}"></button>`).join("")}</div>`).join("");
    const pop = this.openPopover(
      btn,
      `${grid}<div class="dtb-custom"><label title="Custom colour"><input type="color" value="${curHex}"> Custom</label>${withOpacity ? `<label class="dtb-op">Opacity <input type="range" min="0" max="100" value="${Math.round(cur.a * 100)}"><b>${Math.round(cur.a * 100)}%</b></label>` : ""}</div>`,
      btn.dataset.act,
    );
    pop.classList.add("dtb-colors");
    let hex = curHex,
      a = cur.a;
    const apply = () => pick(cssOf({ ...rgbOf(hex), a }));
    pop.onclick = (e) => {
      const sw = e.target.closest("[data-c]");
      if (!sw) return;
      hex = sw.dataset.c;
      pop.querySelectorAll(".dtb-sw").forEach((x) => x.classList.toggle("on", x === sw));
      apply();
    };
    pop.querySelector("input[type=color]").oninput = (e) => {
      hex = e.target.value;
      apply();
    };
    const range = pop.querySelector("input[type=range]");
    if (range)
      range.oninput = (e) => {
        a = Number(e.target.value) / 100;
        pop.querySelector(".dtb-op b").textContent = `${e.target.value}%`;
        apply();
      };
  }

  textPopover(btn) {
    const d = this.d,
      st = this.style();
    const pop = this.openPopover(
      btn,
      `${d.type === "table" ? "" : `<textarea class="in dtb-text" rows="3" placeholder="Add text">${esc(d.text || "")}</textarea>`}<div class="dtb-custom"><label>Colour <input type="color" value="${hexOf(rgbOf(st.textColor || colorOf(d)))}"></label><label>Size <select class="in">${FONT_SIZES.map((n) => `<option ${n === (st.fontSize || (d.type === "arrowmarker" ? 16 : 14)) ? "selected" : ""}>${n}</option>`).join("")}</select></label></div>`,
      "text",
    );
    const ta = pop.querySelector("textarea");
    if (ta)
      ta.oninput = () => {
        d.text = ta.value || undefined;
        this.changed();
      };
    pop.querySelector("input[type=color]").oninput = (e) => {
      st.textColor = e.target.value;
      this.changed();
    };
    pop.querySelector("select").onchange = (e) => {
      st.fontSize = Number(e.target.value);
      this.changed();
    };
    ta?.focus();
  }

  templatePopover(btn) {
    const d = this.d,
      name = TOOL_BY_ID[d.type]?.label || d.type,
      saved = !!this.app.settings.drawDefaults?.[d.type];
    const pop = this.openPopover(
      btn,
      `<button data-k="save">Save as default for ${esc(name)}</button><button data-k="apply"${saved ? "" : " disabled"}>Apply saved default</button><button data-k="reset">Reset to TradingView's look</button>${saved ? '<button data-k="forget">Forget saved default</button>' : ""}`,
      "template",
    );
    pop.classList.add("dtb-list", "dtb-menu");
    pop.onclick = (e) => {
      const k = e.target.closest("[data-k]")?.dataset.k;
      if (!k) return;
      this.closePopover();
      const defs = (this.app.settings.drawDefaults ||= {});
      if (k === "save") {
        defs[d.type] = structuredClone({ ...(d.color ? { color: d.color } : {}), ...(d.style ? { style: d.style } : {}) });
        this.app.persist();
        return this.app.toast(`New ${esc(name)} drawings will look like this.`);
      }
      if (k === "forget") {
        delete defs[d.type];
        this.app.persist();
        return this.app.toast(`${esc(name)} is back to TradingView's look for new drawings.`);
      }
      if (this.app.isLocked(d)) return this.app.toast("Unlock the drawing to change it.");
      delete d.color;
      delete d.style;
      if (k === "apply") Object.assign(d, this.app.drawingDefaults(d.type));
      this.changed();
    };
  }

  morePopover(btn) {
    const d = this.d;
    const pop = this.openPopover(
      btn,
      (d.type === "table" ? '<button data-k="row">Add row</button><button data-k="col">Add column</button><button data-k="unrow">Remove last row</button><button data-k="uncol">Remove last column</button><hr>' : "") +
        (d.type === "post" || d.type === "idea" ? '<button data-k="open">Open link</button><button data-k="link">Edit link</button><hr>' : "") +
        (d.type === "image" ? '<button data-k="pic">Replace picture</button><hr>' : "") +
        '<button data-k="clone">Clone</button><button data-k="front">Bring to front</button><button data-k="back">Send to back</button><button data-k="hide">Hide</button><hr><button data-k="remove" class="down">Remove</button>',
      "more",
    );
    pop.classList.add("dtb-list", "dtb-menu");
    pop.onclick = (e) => {
      const k = e.target.closest("[data-k]")?.dataset.k;
      if (!k) return;
      this.closePopover();
      const p = this.p,
        items = p.drawings.items;
      if (k === "clone") {
        // A copy a few bars to the right, selected so it can be changed straight away.
        const step = p.step || 60,
          copy = { ...structuredClone(d), id: `${d.id}-${Date.now().toString(36)}`, locked: undefined, points: d.points.map((q) => ({ ...q, time: q.time + 5 * step })) };
        items.push(copy);
        p.drawings.selected = copy;
      }
      if (k === "front" || k === "back") {
        const rest = items.filter((x) => x !== d);
        p.drawings.items = k === "front" ? [...rest, d] : [d, ...rest];
      }
      if (k === "hide") {
        d.hidden = true;
        p.drawings.selected = null;
        this.app.toast("Hidden. Show it again from the Object tree.");
      }
      if (k === "remove") return this.remove();
      if (k === "open") return d.url && window.open(d.url, "_blank", "noopener");
      if (k === "link") return this.linkDialog(p, d);
      if (k === "pic") return this.chooseImage(p, d);
      if (["row", "col", "unrow", "uncol"].includes(k)) {
        if (this.app.isLocked(d)) return this.app.toast("Unlock the drawing to change it.");
        const t = (d.table ||= { rows: 3, cols: 3, cells: [] });
        if (k === "row") t.rows++;
        if (k === "col") t.cols++;
        if (k === "unrow" && t.rows > 1) t.rows--;
        if (k === "uncol" && t.cols > 1) t.cols--;
      }
      this.changed();
    };
  }

  // After placing: text tools start typing, Image asks for a picture, Post and Idea for a link.
  afterPlace(p, d) {
    if (TOOL_BY_ID[d.type]?.editOnPlace) this.editInline(p, d);
    else if (d.type === "image") this.chooseImage(p, d);
    else if (d.type === "post" || d.type === "idea") this.linkDialog(p, d);
  }

  // Double-click: a table cell, the picture, the link, the text, or else the settings.
  openForDoubleClick(x, y) {
    const d = this.d, p = this.p;
    if (!d || this.app.isLocked(d)) return;
    if (d.type === "table") return this.editCell(p, d, x, y);
    if (d.type === "image") return this.chooseImage(p, d);
    if (d.type === "post" || d.type === "idea") return this.linkDialog(p, d);
    if (this.opts().text) this.editInline(p, d);
    else this.openSettings();
  }

  editCell(p, d, x, y) {
    const t = p.drawings.tableAt.get(d);
    if (!t) return;
    const c = Math.floor((x - t.x0) / t.cw), r = Math.floor((y - t.y0) / t.ch);
    if (r < 0 || c < 0 || r >= t.rows || c >= t.cols) return;
    this.editInline(p, d, { r, c, value: d.table?.cells?.[r]?.[c] || "", at: { x: t.x0 + c * t.cw + 9, y: t.y0 + r * t.ch + t.ch / 2, align: "left", fs: t.fs, color: t.color } });
  }

  saveAndRedraw(p) {
    p.drawings.update();
    this.app.saveDrawings(p.drawKey(), p.drawings.items);
    if (this.d) this.render();
  }

  // A picture from a file, shrunk to at most 900 pixels a side and kept with the chart (shown at
  // up to 448 pixels).
  chooseImage(p, d) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const bmp = await createImageBitmap(file),
          k = Math.min(1, 900 / Math.max(bmp.width, bmp.height)),
          cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(bmp.width * k));
        cv.height = Math.max(1, Math.round(bmp.height * k));
        cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
        let url = cv.toDataURL("image/webp", 0.85);
        if (!url.startsWith("data:image/webp")) url = cv.toDataURL("image/jpeg", 0.85);
        const show = Math.min(1, 448 / cv.width, 448 / cv.height);
        d.image = url;
        d.imgSize = { w: Math.round(cv.width * show), h: Math.round(cv.height * show) };
        this.saveAndRedraw(p);
      } catch {
        this.app.toast("That file couldn't be read as a picture.", "err");
      }
    };
    input.click();
  }

  // Post: an X post link (its date comes from the link) and optional text. Idea: a link and title.
  linkDialog(p, d) {
    const post = d.type === "post";
    const card = this.app.modal(
      post ? "X post" : "Idea",
      `<label class="dtb-field dtb-col"><span>Link</span><input class="in" data-f="url" placeholder="${post ? "https://x.com/user/status/…" : "https://…"}" value="${esc(d.url || "")}"></label><label class="dtb-field dtb-col"><span>${post ? "Post text (optional)" : "Title"}</span><textarea class="in" data-f="text" rows="3">${esc(d.text || "")}</textarea></label>`,
      { foot: '<button class="btn" data-x="cancel">Cancel</button><button class="btn primary" data-x="ok">Ok</button>' },
    );
    const url = card.querySelector("[data-f=url]");
    url.focus();
    card.querySelector("[data-x=cancel]").onclick = () => this.app.closeModal();
    card.querySelector("[data-x=ok]").onclick = () => {
      let link = url.value.trim();
      if (link && !/^https?:\/\//i.test(link)) link = `https://${link}`;
      d.url = link || undefined;
      d.text = card.querySelector("[data-f=text]").value.trim() || undefined;
      // TradingView pins a post to when it was posted; do that when it's on the loaded chart
      const t = post ? parseLink(link).time : null,
        bars = p.bars || [];
      if (t && bars.length && t >= bars[0].time && t <= bars.at(-1).time) d.points[0].time = t;
      this.app.closeModal();
      this.saveAndRedraw(p);
    };
  }

  // Type a drawing's text right where it's drawn, as on TradingView. Enter adds a line; Esc,
  // Ctrl/Cmd + Enter or a click elsewhere finishes.
  editInline(p, d, cell) {
    this.stopEditing();
    const at = (cell ? cell.at : p.drawings.textSpot(d)) || { x: p.drawings.x(d.points[0].time), y: p.drawings.y(d.points[0].price), align: "left", fs: 14 },
      fs = at.fs || 14,
      ta = document.createElement("textarea");
    ta.className = "dtb-inline";
    ta.value = cell ? cell.value : d.text || "";
    ta.placeholder = "Add text";
    ta.spellcheck = false;
    ta.style.font = `${fs}px -apple-system, Segoe UI, Roboto, sans-serif`;
    ta.style.lineHeight = `${fs * 1.25}px`;
    ta.style.color = at.color || d.style?.textColor || colorOf(d);
    p.el.appendChild(ta);
    const meter = document.createElement("canvas").getContext("2d");
    meter.font = ta.style.font;
    const fit = () => {
      const w = Math.max(60, ...(ta.value || "Add text").split("\n").map((l) => meter.measureText(l).width)) + 14;
      ta.style.width = `${w}px`;
      ta.style.height = "auto";
      ta.style.height = `${ta.scrollHeight}px`;
      ta.style.left = `${p.plotLeft + (at.align === "center" ? at.x - w / 2 : at.align === "right" ? at.x - w + 7 : at.x - 7)}px`;
      ta.style.top = `${at.y - (fs * 1.25) / 2 - 3}px`;
    };
    if (cell) p.drawings.editingCell = { d, r: cell.r, c: cell.c };
    else p.drawings.editing = d;
    p.drawings.update();
    this.editing = { p, d, ta, cell };
    ta.oninput = () => {
      if (!cell) d.text = ta.value || undefined;
      fit();
    };
    ta.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        this.stopEditing();
      }
    };
    ta.onblur = () => this.stopEditing();
    fit();
    ta.focus();
    ta.select();
  }

  stopEditing() {
    const ed = this.editing;
    if (!ed) return false;
    this.editing = null;
    ed.ta.onblur = null;
    const text = ed.ta.value.replace(/\s+$/, "");
    ed.ta.remove();
    const dl = ed.p.drawings;
    if (ed.cell) {
      const t = (ed.d.table ||= { rows: 3, cols: 3, cells: [] });
      (t.cells[ed.cell.r] ||= [])[ed.cell.c] = text;
      dl.editingCell = null;
    } else {
      ed.d.text = text || undefined;
      dl.editing = null;
      // a Text drawing left empty is removed, as on TradingView
      if (ed.d.type === "text" && !ed.d.text) {
        dl.items = dl.items.filter((x) => x !== ed.d);
        if (dl.selected === ed.d) dl.selected = null;
      }
    }
    dl.update();
    this.app.saveDrawings(ed.p.drawKey(), ed.p.drawings.items);
    if (this.d === ed.d) this.render();
    return true;
  }

  // ---------- settings dialog ----------
  // Style, Text and Coordinates. Coordinates is where a placed drawing's points can be moved.
  openSettings() {
    const d = this.d,
      p = this.p;
    if (!d) return;
    const o = this.opts(),
      st = d.style || {},
      color = rgbOf(colorOf(d)),
      name = TOOL_BY_ID[d.type]?.label || d.type,
      // times in the chart's own terms (its time zone, as the crosshair shows them)
      local = (t) => {
        const x = new Date(p.toChart(t) * 1000), z = (n) => String(n).padStart(2, "0");
        return `${x.getUTCFullYear()}-${z(x.getUTCMonth() + 1)}-${z(x.getUTCDate())}T${z(x.getUTCHours())}:${z(x.getUTCMinutes())}:${z(x.getUTCSeconds())}`;
      };
    const row = (label, ctrl) => `<label class="dtb-field"><span>${label}</span>${ctrl}</label>`;
    const style = [
      o.line ? row("Line colour", `<input type="color" data-f="color" value="${hexOf(color)}">`) : "",
      o.width || o.brush ? row(o.brush ? "Brush size" : "Width", `<select class="in" data-f="width">${(o.brush ? BRUSH_WIDTHS : WIDTHS).map((w) => `<option ${w === (st.width || (o.brush ? 20 : 2)) ? "selected" : ""}>${w}</option>`).join("")}</select>`) : "",
      o.style ? row("Line style", `<select class="in" data-f="dash">${STYLES.map(([k, label]) => `<option value="${k}" ${k === (st.dash || "solid") ? "selected" : ""}>${label}</option>`).join("")}</select>`) : "",
      o.fill ? row("Fill", `<input type="color" data-f="fill" value="${hexOf(rgbOf(st.fill || colorOf(d)))}"> <input type="range" data-f="fillAlpha" min="0" max="100" value="${Math.round((st.fillAlpha ?? 0.2) * 100)}">`) : "",
    ].join("");
    const text = o.text
      ? `<textarea class="in" data-f="text" rows="3" placeholder="Add text">${esc(d.text || "")}</textarea>${row("Text colour", `<input type="color" data-f="textColor" value="${hexOf(rgbOf(st.textColor || colorOf(d)))}">`)}${row("Size", `<select class="in" data-f="fontSize">${FONT_SIZES.map((n) => `<option ${n === (st.fontSize || 14) ? "selected" : ""}>${n}</option>`).join("")}</select>`)}`
      : "";
    const coords = d.points
      .map((q, i) => `<div class="dtb-coord"><b>#${i + 1}</b>${row("Price", `<input class="in" type="number" step="any" data-p="${i}" data-k="price" value="${+q.price.toPrecision(10)}">`)}${row("Time", `<input class="in" type="datetime-local" step="1" data-p="${i}" data-k="time" value="${local(q.time)}">`)}</div>`)
      .join("");
    const tabs = [["style", "Style", style || '<p class="hint-text">This tool keeps TradingView\'s colours.</p>'], ...(text ? [["text", "Text", text]] : []), ["coords", "Coordinates", coords]];
    const card = this.app.modal(
      name,
      `<div class="seg dtb-tabs">${tabs.map(([k, label], i) => `<button data-tab="${k}" class="${i ? "" : "on"}">${label}</button>`).join("")}</div>${tabs.map(([k, , html], i) => `<div class="dtb-tab" data-pane="${k}" ${i ? "hidden" : ""}>${html}</div>`).join("")}`,
      { foot: '<button class="btn" data-x="cancel">Cancel</button><button class="btn primary" data-x="ok">Ok</button>' },
    );
    card.querySelector(".dtb-tabs").onclick = (e) => {
      const t = e.target.closest("[data-tab]")?.dataset.tab;
      if (!t) return;
      card.querySelectorAll(".dtb-tabs button").forEach((x) => x.classList.toggle("on", x.dataset.tab === t));
      card.querySelectorAll(".dtb-tab").forEach((x) => (x.hidden = x.dataset.pane !== t));
    };
    card.querySelector("[data-x=cancel]").onclick = () => this.app.closeModal();
    card.querySelector("[data-x=ok]").onclick = () => {
      const val = (f) => card.querySelector(`[data-f=${f}]`)?.value;
      const s2 = (d.style ||= {});
      if (val("color")) d.color = d.type === "highlighter" ? cssOf({ ...rgbOf(val("color")), a: rgbOf(colorOf(d)).a }) : val("color");
      if (val("width")) s2.width = Number(val("width"));
      if (val("dash")) s2.dash = val("dash") === "solid" ? undefined : val("dash");
      if (val("fill")) {
        s2.fill = val("fill");
        s2.fillAlpha = Number(val("fillAlpha")) / 100;
      }
      if (o.text) {
        d.text = val("text") || undefined;
        s2.textColor = val("textColor");
        s2.fontSize = Number(val("fontSize"));
      }
      for (const inp of card.querySelectorAll("[data-p]")) {
        const q = d.points[Number(inp.dataset.p)];
        if (inp.dataset.k === "price" && Number.isFinite(parseFloat(inp.value))) q.price = parseFloat(inp.value);
        if (inp.dataset.k === "time" && inp.value) {
          const t = Math.round(p.fromChart(Date.parse(`${inp.value}Z`) / 1000));
          if (Number.isFinite(t)) q.time = t;
        }
      }
      this.app.closeModal();
      if (this.p === p && this.d === d) this.changed();
      else {
        p.drawings.update();
        this.app.saveDrawings(p.drawKey(), p.drawings.items);
      }
    };
  }
}
