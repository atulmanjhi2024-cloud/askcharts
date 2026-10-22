// The lines, labels, boxes, linefills and tables a Pine script drew, painted on the chart canvas as a
// series primitive. They arrive as plain values (drawingsOut in lib/pine.js): x as a bar index, which
// is the chart's logical index (future ones too), y as a price, colours as CSS. Text is drawn with
// fillText, never as HTML, so a script's text can't become markup.

const FONT = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";
// Maps, not objects: a style or size a script names can only find these entries.
const PX = new Map(Object.entries({ tiny: 8, small: 10, auto: 11, normal: 12, large: 15, huge: 20 }));
const px = (s) => PX.get(s) ?? 12;
const DASH = new Map(Object.entries({ dashed: [6, 4], dotted: [2, 3] }));
const dash = (s) => DASH.get(s) || [];
const ok = (...v) => v.every((x) => x != null && Number.isFinite(x));

export class PineDrawings {
  // objects: the Style tab's GRAPHIC OBJECTS (line, label, box, linefill, table: false hides that kind)
  constructor(pane, drawings, objects = {}) {
    this.pane = pane;
    this.d = drawings;
    this.objects = objects || {};
    this._view = {
      zOrder: () => "top",
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

  // A bar index to x. The library places whole logical positions, so a fraction (a bar_time
  // between bars) is placed between its neighbours.
  x(i) {
    if (i == null) return null;
    const ts = this.pane.chart.timeScale(),
      f = Math.floor(i),
      x0 = ts.logicalToCoordinate(f);
    if (x0 == null || f === i) return x0;
    const x1 = ts.logicalToCoordinate(f + 1);
    return x1 == null ? x0 : x0 + (x1 - x0) * (i - f);
  }
  y(p) {
    return p == null ? null : this.series?.priceToCoordinate(p) ?? null;
  }

  draw(ctx, size) {
    if (!this.series) return;
    const d = this.d;
    // each drawing on its own: one that can't be drawn is skipped, the chart keeps painting
    const each = (list, fn) => {
      for (const item of list) {
        ctx.save();
        try {
          fn.call(this, ctx, size, item);
        } catch {
          /* skip it */
        } finally {
          ctx.restore();
        }
      }
    };
    const on = (kind) => this.objects[kind] !== false;
    if (on("linefill")) each(d.linefills, this.linefill);
    if (on("box")) each(d.boxes, this.box);
    if (on("line")) each(d.lines, this.line);
    if (on("label")) each(d.labels, (c, s, l) => this.label(c, l));
    if (on("table")) each(d.tables, this.table);
  }

  // A line's two ends on screen, carried past the pane's edge when it extends.
  seg(l, size) {
    const x1 = this.x(l.x1),
      x2 = this.x(l.x2),
      y1 = this.y(l.y1),
      y2 = this.y(l.y2);
    if (!ok(x1, x2, y1, y2)) return null;
    let a = [x1, y1],
      b = [x2, y2];
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (l.extend !== "none" && len > 0) {
      const far = (size.width + size.height) * 3,
        ux = (x2 - x1) / len,
        uy = (y2 - y1) / len;
      if (l.extend === "right" || l.extend === "both") b = [x2 + ux * far, y2 + uy * far];
      if (l.extend === "left" || l.extend === "both") a = [x1 - ux * far, y1 - uy * far];
    }
    return [a, b];
  }

  line(ctx, size, l) {
    if (!l.color) return; // color na: not stroked, though a linefill may still use the line
    const s = this.seg(l, size);
    if (!s) return;
    ctx.strokeStyle = l.color;
    ctx.lineWidth = l.width;
    ctx.lineCap = l.style === "dotted" ? "round" : "butt";
    ctx.setLineDash(dash(l.style));
    ctx.beginPath();
    ctx.moveTo(...s[0]);
    ctx.lineTo(...s[1]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (l.style === "arrow_right" || l.style === "arrow_both") arrowHead(ctx, s[0], s[1], l.color, l.width);
    if (l.style === "arrow_left" || l.style === "arrow_both") arrowHead(ctx, s[1], s[0], l.color, l.width);
  }

  linefill(ctx, size, f) {
    if (!f.color) return;
    const a = this.seg(f.a, size),
      b = this.seg(f.b, size);
    if (!a || !b) return;
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.moveTo(...a[0]);
    ctx.lineTo(...a[1]);
    ctx.lineTo(...b[1]);
    ctx.lineTo(...b[0]);
    ctx.closePath();
    ctx.fill();
  }

  box(ctx, size, b) {
    let x1 = this.x(b.left),
      x2 = this.x(b.right);
    const y1 = this.y(b.top),
      y2 = this.y(b.bottom);
    if (!ok(x1, x2, y1, y2)) return;
    if (x1 > x2) [x1, x2] = [x2, x1];
    if (b.extend === "left" || b.extend === "both") x1 = -10;
    if (b.extend === "right" || b.extend === "both") x2 = size.width + 10;
    const top = Math.min(y1, y2),
      h = Math.abs(y2 - y1),
      w = x2 - x1;
    if (b.bg) {
      ctx.fillStyle = b.bg;
      ctx.fillRect(x1, top, w, h);
    }
    if (b.border && b.borderWidth > 0) {
      ctx.strokeStyle = b.border;
      ctx.lineWidth = b.borderWidth;
      ctx.setLineDash(dash(b.borderStyle));
      ctx.strokeRect(x1, top, w, h);
      ctx.setLineDash([]);
    }
    if (b.text && b.textColor) {
      const fs = px(b.textSize);
      ctx.font = `${fs}px ${FONT}`;
      ctx.fillStyle = b.textColor;
      const lines = b.text.split("\n"),
        lh = fs * 1.25;
      ctx.textAlign = b.halign === "left" ? "left" : b.halign === "right" ? "right" : "center";
      ctx.textBaseline = "middle";
      const tx = b.halign === "left" ? x1 + 4 : b.halign === "right" ? x2 - 4 : x1 + w / 2;
      const block = lines.length * lh,
        ty = b.valign === "top" ? top + 4 + lh / 2 : b.valign === "bottom" ? top + h - 4 - block + lh / 2 : top + h / 2 - block / 2 + lh / 2;
      lines.forEach((t, k) => ctx.fillText(t, tx, ty + k * lh));
    }
  }

  // TradingView's label shapes: label_down sits above its point with the pointer down to it,
  // label_up below pointing up, label_left to the right of its point pointing left, and so on.
  label(ctx, l) {
    const x = this.x(l.x),
      y = this.y(l.y);
    if (!ok(x, y)) return;
    const fs = px(l.size);
    ctx.font = `${fs}px ${FONT}`;
    const lines = l.text ? l.text.split("\n") : [];
    const lh = Math.round(fs * 1.3),
      padX = Math.round(fs * 0.55),
      padY = Math.round(fs * 0.3),
      ptr = Math.max(4, Math.round(fs * 0.45));
    const tw = lines.length ? Math.max(...lines.map((t) => ctx.measureText(t).width)) : 0;
    const w = Math.ceil(tw + padX * 2),
      h = lines.length ? lines.length * lh + padY * 2 : 0;
    const st = l.style;
    let bx = x - w / 2,
      by = y - h / 2,
      tip = null;
    if (st === "label_down") {
      by = y - ptr - h;
      tip = [[x - ptr, by + h], [x + ptr, by + h], [x, y]];
    } else if (st === "label_up") {
      by = y + ptr;
      tip = [[x - ptr, by], [x + ptr, by], [x, y]];
    } else if (st === "label_left") {
      bx = x + ptr;
      tip = [[bx, y - ptr], [bx, y + ptr], [x, y]];
    } else if (st === "label_right") {
      bx = x - ptr - w;
      tip = [[bx + w, y - ptr], [bx + w, y + ptr], [x, y]];
    } else if (st === "label_lower_left") [bx, by] = [x, y];
    else if (st === "label_lower_right") [bx, by] = [x - w, y];
    else if (st === "label_upper_left") [bx, by] = [x, y - h];
    else if (st === "label_upper_right") [bx, by] = [x - w, y - h];
    else if (st !== "label_center" && st !== "none" && st !== "text_outline") {
      // a shape at the point, its text beside it
      const r = Math.max(3, fs * 0.45),
        down = ["triangledown", "arrowdown"].includes(st);
      if (l.color) shape(ctx, st, x, y, r, l.color);
      if (lines.length && l.textcolor) {
        ctx.fillStyle = l.textcolor;
        ctx.textAlign = "center";
        ctx.textBaseline = down ? "bottom" : "top";
        lines.forEach((t, k) => ctx.fillText(t, x, down ? y - r - 3 - (lines.length - 1 - k) * lh : y + r + 3 + k * lh));
      }
      return;
    }
    if (h && l.color && st !== "none" && st !== "text_outline") {
      ctx.fillStyle = l.color;
      ctx.beginPath();
      ctx.roundRect(bx, by, w, h, 3);
      ctx.fill();
      if (tip) {
        ctx.beginPath();
        ctx.moveTo(...tip[0]);
        ctx.lineTo(...tip[1]);
        ctx.lineTo(...tip[2]);
        ctx.closePath();
        ctx.fill();
      }
    }
    if (!lines.length || !l.textcolor) return;
    ctx.fillStyle = l.textcolor;
    ctx.textBaseline = "middle";
    ctx.textAlign = l.textalign === "left" ? "left" : l.textalign === "right" ? "right" : "center";
    const tx = l.textalign === "left" ? bx + padX : l.textalign === "right" ? bx + w - padX : bx + w / 2;
    lines.forEach((t, k) => ctx.fillText(t, tx, by + padY + lh / 2 + k * lh));
  }

  // A table at one of nine places in the pane: columns as wide as their widest cell, rows as tall
  // as their tallest; rows and columns with no cells take no room, as on TradingView.
  table(ctx, size, t) {
    const padX = 6,
      padY = 3,
      merged = new Set();
    for (const m of t.merges)
      for (let c = Math.max(0, m.c0); c <= Math.min(m.c1, t.columns - 1); c++)
        for (let r = Math.max(0, m.r0); r <= Math.min(m.r1, t.rows - 1); r++) if (c !== m.c0 || r !== m.r0) merged.add(`${c},${r}`);
    const cells = t.cells.filter((c) => !merged.has(`${c.col},${c.row}`));
    const colW = new Array(t.columns).fill(0),
      rowH = new Array(t.rows).fill(0);
    const measure = (c) => {
      const fs = px(c.size);
      ctx.font = `${fs}px ${FONT}`;
      const lines = c.text ? c.text.split("\n") : [];
      const w = c.width > 0 ? (size.width * c.width) / 100 : lines.length ? Math.max(...lines.map((s) => ctx.measureText(s).width)) + padX * 2 : padX * 2;
      const h = c.height > 0 ? (size.height * c.height) / 100 : lines.length ? lines.length * fs * 1.3 + padY * 2 : fs * 0.4 + padY * 2;
      return { fs, lines, w, h };
    };
    const sized = cells.map((c) => ({ c, ...measure(c) }));
    for (const s of sized) {
      const span = t.merges.find((m) => m.c0 === s.c.col && m.r0 === s.c.row);
      if (!span || span.c1 === span.c0) colW[s.c.col] = Math.max(colW[s.c.col], s.w);
      if (!span || span.r1 === span.r0) rowH[s.c.row] = Math.max(rowH[s.c.row], s.h);
    }
    const bw = t.border ? t.borderWidth : 0,
      fw = t.frame ? t.frameWidth : 0;
    const W = colW.reduce((a, v) => a + v, 0) + bw * Math.max(0, colW.filter(Boolean).length - 1),
      H = rowH.reduce((a, v) => a + v, 0) + bw * Math.max(0, rowH.filter(Boolean).length - 1);
    if (!W || !H) return;
    const m = 8 + fw,
      pos = t.position;
    const x0 = pos.endsWith("left") ? m : pos.endsWith("center") ? (size.width - W) / 2 : size.width - W - m;
    const y0 = pos.startsWith("top") ? m : pos.startsWith("middle") ? (size.height - H) / 2 : size.height - H - m;
    const colX = [],
      rowY = [];
    colW.reduce((x, w, k) => ((colX[k] = x), x + w + (w ? bw : 0)), x0);
    rowH.reduce((y, h, k) => ((rowY[k] = y), y + h + (h ? bw : 0)), y0);
    if (t.bg) {
      ctx.fillStyle = t.bg;
      ctx.fillRect(x0, y0, W, H);
    }
    if (t.border && bw) {
      ctx.fillStyle = t.border;
      ctx.fillRect(x0, y0, W, H); // cells cover it, leaving the gaps between them as the border
    }
    for (const s of sized) {
      const span = t.merges.find((mm) => mm.c0 === s.c.col && mm.r0 === s.c.row);
      const c1 = span ? span.c1 : s.c.col,
        r1 = span ? span.r1 : s.c.row;
      const x = colX[s.c.col],
        y = rowY[s.c.row];
      const w = colX[c1] + colW[c1] - x,
        h = rowY[r1] + rowH[r1] - y;
      if (!w || !h) continue;
      const bg = s.c.bg || (t.border && bw ? t.bg : null);
      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(x, y, w, h);
      }
      if (!s.lines.length || !s.c.color) continue;
      ctx.font = `${s.fs}px ${FONT}`;
      ctx.fillStyle = s.c.color;
      ctx.textBaseline = "middle";
      ctx.textAlign = s.c.halign === "left" ? "left" : s.c.halign === "right" ? "right" : "center";
      const tx = s.c.halign === "left" ? x + padX : s.c.halign === "right" ? x + w - padX : x + w / 2;
      const lh = s.fs * 1.3,
        block = s.lines.length * lh;
      const ty = s.c.valign === "top" ? y + padY + lh / 2 : s.c.valign === "bottom" ? y + h - padY - block + lh / 2 : y + h / 2 - block / 2 + lh / 2;
      s.lines.forEach((line, k) => ctx.fillText(line, tx, ty + k * lh));
    }
    if (t.frame && fw) {
      ctx.strokeStyle = t.frame;
      ctx.lineWidth = fw;
      ctx.strokeRect(x0 - fw / 2, y0 - fw / 2, W + fw, H + fw);
    }
  }
}

function arrowHead(ctx, from, to, color, width) {
  const a = Math.atan2(to[1] - from[1], to[0] - from[0]),
    s = 6 + width * 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(...to);
  ctx.lineTo(to[0] - s * Math.cos(a - 0.45), to[1] - s * Math.sin(a - 0.45));
  ctx.lineTo(to[0] - s * Math.cos(a + 0.45), to[1] - s * Math.sin(a + 0.45));
  ctx.closePath();
  ctx.fill();
}

function shape(ctx, st, x, y, r, color) {
  ctx.fillStyle = ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (st === "circle") ctx.arc(x, y, r, 0, Math.PI * 2);
  else if (st === "square") ctx.rect(x - r, y - r, r * 2, r * 2);
  else if (st === "diamond") {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
  } else if (st === "triangleup" || st === "arrowup") {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.lineTo(x - r, y + r);
  } else if (st === "triangledown" || st === "arrowdown") {
    ctx.moveTo(x, y + r);
    ctx.lineTo(x + r, y - r);
    ctx.lineTo(x - r, y - r);
  } else if (st === "flag") {
    ctx.moveTo(x - r, y + r);
    ctx.lineTo(x - r, y - r);
    ctx.lineTo(x + r, y - r / 2);
    ctx.lineTo(x - r, y);
  } else {
    // xcross and cross: strokes
    const d = st === "cross" ? [[x - r, y, x + r, y], [x, y - r, x, y + r]] : [[x - r, y - r, x + r, y + r], [x - r, y + r, x + r, y - r]];
    for (const [a, b, c, e] of d) {
      ctx.moveTo(a, b);
      ctx.lineTo(c, e);
    }
    ctx.stroke();
    return;
  }
  ctx.closePath();
  ctx.fill();
}
