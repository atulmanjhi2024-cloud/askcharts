// AskCharts sign-in page: the passkey flows, then the decorative chart behind them.
(() => {
  const $ = (id) => document.getElementById(id);
  const W = window.SimpleWebAuthnBrowser;

  // ---------- screens ----------
  const views = [...document.querySelectorAll("[data-view]")];
  function show(name) {
    views.forEach((v) => {
      v.hidden = v.dataset.view !== name;
      if (!v.hidden) $("heading").textContent = v.dataset.title;
    });
  }
  function say(el, text) { el.textContent = text; el.hidden = !text; }
  function explain(err) {
    if (err && err.name === "NotAllowedError") return "That passkey didn't work, or it was cancelled.";
    if (err && err.name === "InvalidStateError") return "This device already has a passkey. Go back and sign in.";
    return (err && err.message) || "Something went wrong. Try again.";
  }
  async function post(path, body) {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body || {}),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || "Something went wrong. Try again."), { status: r.status });
    return data;
  }

  const email = $("email");
  try { email.value = localStorage.getItem("qt-email") || ""; } catch { /* storage off */ }
  const remember = (v) => { try { localStorage.setItem("qt-email", v); } catch { /* storage off */ } };

  const link = location.pathname.match(/^\/link\/([A-Za-z0-9_-]+)$/);
  show(link ? "enrol" : "email");
  if (!W || !W.browserSupportsWebAuthn()) {
    say($(link ? "enrol-fail" : "fail"), "This browser can't use passkeys. Try Safari, Chrome or Firefox.");
  }

  // Sign in: email, then the passkey prompt.
  $("signin").addEventListener("submit", async (e) => {
    e.preventDefault();
    const addr = email.value.trim();
    if (!addr) { email.focus(); return; }
    remember(addr);
    say($("fail"), "");
    try {
      const { options, challengeId } = await post("/auth/login/options", { email: addr });
      show("wait");
      const response = await W.startAuthentication({ optionsJSON: options });
      await post("/auth/login/verify", { challengeId, response });
      location.replace("/");
    } catch (err) {
      show("email");
      say($("fail"), explain(err));
    }
  });

  // From a one-time link (node gateway/link.mjs): create a passkey on this device.
  $("create").addEventListener("click", async () => {
    say($("enrol-fail"), "");
    $("create").disabled = true;
    try {
      const { options, challengeId } = await post("/auth/enrol/options", { token: link[1] });
      const response = await W.startRegistration({ optionsJSON: options });
      await post("/auth/enrol/verify", { challengeId, response });
      $("create").hidden = true;
      $("created").hidden = false;
      setTimeout(() => location.replace("/"), 900);
    } catch (err) {
      if (err.status === 410) { show("dead"); return; }
      say($("enrol-fail"), explain(err));
    } finally {
      $("create").disabled = false;
    }
  });

  // ---------- background chart: a seeded random walk, not market data ----------
  const cv = $("chart");
  const ctx = cv.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const css = getComputedStyle(document.documentElement);
  const C = (n) => css.getPropertyValue(n).trim();
  const col = {
    bg: C("--bg"), panel2: C("--panel-2"), line: C("--line"), grid: C("--grid"), text: C("--text"), muted: C("--muted"),
    accent: C("--accent"), gold: C("--gold"), up: C("--up"), down: C("--down"),
  };
  const MONO = '11px "Fragment Mono", ui-monospace, Menlo, monospace';

  let seed = (Date.now() / 86400e3) | 0; // a new chart each day
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const bars = [];
  let p = 184.2;
  function newBar(o) {
    const c = o + (rnd() - 0.485) * o * 0.022;
    return { o, c, h: Math.max(o, c) + rnd() * o * 0.008, l: Math.min(o, c) - rnd() * o * 0.008, v: 0.25 + rnd() };
  }
  for (let i = 0; i < 700; i++) { const b = newBar(p); bars.push(b); p = b.c; }
  const day0 = new Date(); day0.setHours(0, 0, 0, 0);
  let firstDay = new Date(day0.getTime() - (bars.length - 1) * 86400e3);

  function emaSeries(period) {
    const k = 2 / (period + 1), out = [];
    let e = bars[0].c;
    for (const b of bars) { e = b.c * k + e * (1 - k); out.push(e); }
    return out;
  }
  function niceStep(span, target) {
    const raw = span / target, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag;
  }
  const fmtDay = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  let mouse = null, reveal = reduce ? 1 : 0, revealStart = 0, queued = false;

  function draw() {
    queued = false;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const PS = w < 600 ? 56 : 68, TS = 26;
    const cw = w - PS, ch = h - TS;
    const step = w < 600 ? 8 : 11, body = Math.max(3, step - 4);
    const n = Math.min(bars.length, Math.floor(cw / step) - 6);
    if (n < 2) return;
    const off = bars.length - n;
    const vis = bars.slice(off);
    const e9 = emaSeries(9).slice(off), e21 = emaSeries(21).slice(off), e50 = emaSeries(50).slice(off);

    let lo = Infinity, hi = -Infinity;
    vis.forEach((b) => { lo = Math.min(lo, b.l); hi = Math.max(hi, b.h); });
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const top = ch * 0.06, bot = ch * 0.8;
    const y = (v) => bot - (v - lo) / (hi - lo) * (bot - top);
    const xOf = (i) => i * step + step / 2;

    // grid
    const pStep = niceStep(hi - lo, 7);
    ctx.lineWidth = 1; ctx.strokeStyle = col.grid;
    const ticks = [];
    for (let v = Math.ceil(lo / pStep) * pStep; v <= hi; v += pStep) {
      const yy = Math.round(y(v)) + 0.5;
      if (yy < 4 || yy > ch) continue;
      ticks.push([v, yy]); ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(cw, yy); ctx.stroke();
    }
    const timeTicks = [];
    for (let i = 0; i < n; i++) {
      if ((off + i) % 14 !== 0) continue;
      const xx = Math.round(xOf(i)) + 0.5; timeTicks.push([i, xx]);
      ctx.beginPath(); ctx.moveTo(xx, 0); ctx.lineTo(xx, ch); ctx.stroke();
    }

    const shown = Math.max(1, Math.floor(n * reveal));

    // volume
    for (let i = 0; i < shown; i++) {
      const b = vis[i]; ctx.fillStyle = b.c >= b.o ? col.up : col.down; ctx.globalAlpha = 0.16;
      const vh = b.v * ch * 0.13; ctx.fillRect(xOf(i) - body / 2, ch - vh, body, vh);
    }
    // candles
    ctx.globalAlpha = 0.6;
    for (let i = 0; i < shown; i++) {
      const b = vis[i], c = b.c >= b.o ? col.up : col.down, x = xOf(i);
      ctx.strokeStyle = c; ctx.fillStyle = c;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, y(b.h)); ctx.lineTo(Math.round(x) + 0.5, y(b.l)); ctx.stroke();
      const yt = y(Math.max(b.o, b.c)), yb = y(Math.min(b.o, b.c));
      ctx.fillRect(x - body / 2, yt, body, Math.max(1, yb - yt));
    }
    // moving averages
    const lineOf = (s, color, alpha) => {
      ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
      for (let i = 0; i < shown; i++) i ? ctx.lineTo(xOf(i), y(s[i])) : ctx.moveTo(xOf(i), y(s[i]));
      ctx.stroke();
    };
    lineOf(e50, col.gold, 0.55);
    lineOf(e21, col.accent, 0.8);
    // crossover signals (EMA 9 over or under EMA 21)
    const arrow = (x, yy, isUp) => {
      ctx.globalAlpha = 0.85; ctx.fillStyle = isUp ? col.up : col.down; ctx.beginPath();
      if (isUp) { ctx.moveTo(x, yy); ctx.lineTo(x - 5, yy + 8); ctx.lineTo(x + 5, yy + 8); }
      else { ctx.moveTo(x, yy); ctx.lineTo(x - 5, yy - 8); ctx.lineTo(x + 5, yy - 8); }
      ctx.closePath(); ctx.fill();
    };
    for (let i = 1; i < shown; i++) {
      const was = e9[i - 1] - e21[i - 1], now = e9[i] - e21[i];
      if (was <= 0 && now > 0) arrow(xOf(i), y(vis[i].l) + 10, true);
      if (was >= 0 && now < 0) arrow(xOf(i), y(vis[i].h) - 10, false);
    }
    ctx.globalAlpha = 1; ctx.lineWidth = 1;

    // price scale and time scale
    ctx.fillStyle = col.bg; ctx.fillRect(cw, 0, PS, h); ctx.fillRect(0, ch, w, TS);
    ctx.strokeStyle = col.line; ctx.beginPath(); ctx.moveTo(cw + 0.5, 0); ctx.lineTo(cw + 0.5, ch); ctx.moveTo(0, ch + 0.5); ctx.lineTo(w, ch + 0.5); ctx.stroke();
    ctx.font = MONO; ctx.textBaseline = "middle"; ctx.fillStyle = col.muted;
    const dec = pStep < 1 ? 2 : 0;
    ticks.forEach(([v, yy]) => ctx.fillText(v.toFixed(dec), cw + 8, yy));
    ctx.textAlign = "center";
    timeTicks.forEach(([i, xx]) => { if (xx > 24 && xx < cw - 24) ctx.fillText(fmtDay(new Date(firstDay.getTime() + (off + i) * 86400e3)), xx, ch + TS / 2); });
    ctx.textAlign = "left";

    const tagAt = (yy, text, bg, fg) => {
      ctx.fillStyle = bg; ctx.fillRect(cw + 1, yy - 9, PS - 1, 18);
      ctx.fillStyle = fg; ctx.font = MONO; ctx.textBaseline = "middle"; ctx.fillText(text, cw + 8, yy);
    };
    // last price line and tag
    if (reveal >= 1) {
      const last = vis[n - 1], lc = last.c >= last.o ? col.up : col.down, ly = Math.round(y(last.c)) + 0.5;
      ctx.strokeStyle = lc; ctx.setLineDash([2, 3]); ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(cw, ly); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      tagAt(ly, last.c.toFixed(2), lc, "#ffffff");
    }

    // crosshair
    if (mouse && mouse.x < cw && mouse.y < ch) {
      const i = Math.max(0, Math.min(n - 1, Math.floor(mouse.x / step)));
      const cx = Math.round(xOf(i)) + 0.5, cy = Math.round(mouse.y) + 0.5;
      ctx.strokeStyle = col.muted; ctx.setLineDash([4, 4]); ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, ch); ctx.moveTo(0, cy); ctx.lineTo(cw, cy); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      const price = lo + (bot - mouse.y) / (bot - top) * (hi - lo);
      tagAt(cy, price.toFixed(2), col.panel2, col.text);
      const label = fmtDay(new Date(firstDay.getTime() + (off + i) * 86400e3));
      ctx.font = MONO;
      const tw = ctx.measureText(label).width + 16;
      const tx = Math.max(0, Math.min(cw - tw, cx - tw / 2));
      ctx.fillStyle = col.panel2; ctx.fillRect(tx, ch + 1, tw, TS - 1);
      ctx.fillStyle = col.text; ctx.textAlign = "center"; ctx.fillText(label, tx + tw / 2, ch + TS / 2); ctx.textAlign = "left";
      // OHLC readout for the candle under the crosshair, bottom left
      const b = vis[i], up = b.c >= b.o;
      let x = 12;
      const yy = h - TS - 14;
      [["O", b.o], ["H", b.h], ["L", b.l], ["C", b.c]].forEach(([k, v]) => {
        ctx.fillStyle = col.muted; ctx.fillText(k, x, yy); x += ctx.measureText(k).width + 4;
        ctx.fillStyle = up ? col.up : col.down;
        const s = v.toFixed(2); ctx.fillText(s, x, yy); x += ctx.measureText(s).width + 10;
      });
    }
  }
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(draw); } };

  // live ticks: the last candle moves, a new one opens every few seconds
  let ticksOnBar = 0;
  function tick() {
    const b = bars[bars.length - 1];
    b.c += (rnd() - 0.5) * b.o * 0.004;
    b.h = Math.max(b.h, b.c); b.l = Math.min(b.l, b.c); b.v += rnd() * 0.05;
    if (++ticksOnBar >= 6) {
      ticksOnBar = 0;
      bars.push({ o: b.c, c: b.c, h: b.c, l: b.c, v: 0.15 });
      bars.shift();
      firstDay = new Date(firstDay.getTime() + 86400e3);
    }
    schedule();
  }

  addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") { mouse = { x: e.clientX, y: e.clientY }; schedule(); } });
  document.addEventListener("pointerleave", () => { mouse = null; schedule(); });
  addEventListener("resize", schedule);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);

  if (reduce) draw();
  else {
    const intro = (t) => {
      if (!revealStart) revealStart = t;
      reveal = Math.min(1, (t - revealStart) / 1200);
      draw();
      if (reveal < 1) requestAnimationFrame(intro);
      else setInterval(() => { if (!document.hidden) tick(); }, 900);
    };
    requestAnimationFrame(intro);
  }
})();
