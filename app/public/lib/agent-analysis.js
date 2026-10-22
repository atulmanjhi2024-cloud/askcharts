// Plain-number helpers for AskCharts AI's read tools: a bar summary, swing highs and lows, the last
// completed swing and support and resistance. No page needed, so a server door can use them too.
// Bars are {time (UTC seconds), open, high, low, close, volume}.

export const iso = (sec) => (Number.isFinite(sec) ? new Date(sec * 1000).toISOString().slice(0, 16).replace("T", " ") : null);
export const round = (v) => (Number.isFinite(v) ? Number(v.toPrecision(7)) : null);

// "2026-10-19", "2026-10-19 14:30", "2026-10-19T14:30Z": UTC seconds, or NaN.
export function parseWhen(s) {
  const t = String(s ?? "").trim();
  if (!t) return NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(t);
  if (!m) return NaN;
  if (m[7] && m[7] !== "Z") return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4] || "00"}:${m[5] || "00"}:${m[6] || "00"}${m[7]}`) / 1000;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) / 1000;
}

// The bar at or just before a time (bars in time order).
export function barIndexAt(bars, t) {
  let lo = 0,
    hi = bars.length - 1;
  if (hi < 0 || t < bars[0].time) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bars[mid].time <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function summary(bars) {
  if (!bars.length) return null;
  let hi = -Infinity,
    lo = Infinity,
    range = 0;
  for (const b of bars) {
    hi = Math.max(hi, b.high);
    lo = Math.min(lo, b.low);
    range += b.high - b.low;
  }
  const first = bars[0],
    last = bars.at(-1);
  return {
    bars: bars.length,
    from: iso(first.time),
    to: iso(last.time),
    high: round(hi),
    low: round(lo),
    lastClose: round(last.close),
    changePct: round(((last.close - first.open) / first.open) * 100),
    averageRange: round(range / bars.length),
  };
}

// Swing points: a bar whose high (low) is the highest (lowest) of `k` bars either side.
export function swings(bars, k = 5) {
  const out = [];
  for (let i = k; i < bars.length - k; i++) {
    let isHigh = true,
      isLow = true;
    for (let j = i - k; j <= i + k && (isHigh || isLow); j++) {
      if (j === i) continue;
      if (bars[j].high > bars[i].high || (bars[j].high === bars[i].high && j < i)) isHigh = false;
      if (bars[j].low < bars[i].low || (bars[j].low === bars[i].low && j < i)) isLow = false;
    }
    if (isHigh) out.push({ kind: "high", i, time: bars[i].time, price: bars[i].high });
    if (isLow) out.push({ kind: "low", i, time: bars[i].time, price: bars[i].low });
  }
  return out;
}

// Swings, the last completed swing (the last high and low in turn, latest last) and levels: swing
// prices within half an average range of each other merge into one level, counted by touches.
export function levels(bars, { strength = 5, lookback = 300 } = {}) {
  const part = bars.slice(-lookback);
  if (part.length < strength * 2 + 3) return { note: "Not enough bars for swings." };
  const offset = bars.length - part.length;
  const sw = swings(part, strength);
  const avg = part.reduce((a, b) => a + (b.high - b.low), 0) / part.length;
  const anchor = (s) => ({ time: iso(s.time), price: round(s.price), bars_ago: bars.length - 1 - (s.i + offset), at: s.kind });
  // alternate high and low, keeping the more extreme of two in a row
  const alt = [];
  for (const s of sw) {
    const prev = alt.at(-1);
    if (prev && prev.kind === s.kind) {
      if ((s.kind === "high" && s.price >= prev.price) || (s.kind === "low" && s.price <= prev.price)) alt[alt.length - 1] = s;
    } else alt.push(s);
  }
  const lastSwing = alt.length >= 2 ? { from: anchor(alt.at(-2)), to: anchor(alt.at(-1)), direction: alt.at(-1).kind === "high" ? "up" : "down" } : null;
  const groups = [];
  for (const s of [...sw].sort((a, b) => a.price - b.price)) {
    const g = groups.at(-1);
    if (g && s.price - g.prices.at(-1) <= avg * 0.5) {
      g.prices.push(s.price);
      g.last = Math.max(g.last, s.time);
    } else groups.push({ prices: [s.price], last: s.time });
  }
  const price = part.at(-1).close;
  const lv = groups.map((g) => ({ price: round(g.prices.reduce((a, b) => a + b, 0) / g.prices.length), touches: g.prices.length, last: iso(g.last) }));
  const near = (arr) => arr.sort((a, b) => Math.abs(a.price - price) - Math.abs(b.price - price)).slice(0, 4);
  return {
    price: round(price),
    swingHighs: sw.filter((s) => s.kind === "high").slice(-6).map(anchor),
    swingLows: sw.filter((s) => s.kind === "low").slice(-6).map(anchor),
    lastSwing,
    resistance: near(lv.filter((l) => l.price > price)),
    support: near(lv.filter((l) => l.price <= price)),
  };
}
