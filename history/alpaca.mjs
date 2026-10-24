// Alpaca stock history for the bar store: US stocks and ETFs, the regular session (09:30 to 16:00 New York) as
// stock charts show it, split adjusted as they are, since 2016. Alpaca's free plan gives the whole market's
// bars (the SIP feed, every exchange) for anything older than 15 minutes; the live feed on a free key (IEX) is
// a few percent of the trades, so these are the better bars and the chart keeps them where the two overlap.
//
// 1m bars come from Alpaca; 5m, 15m and 30m are built from them, on the same clock boundaries as Alpaca's own;
// 1h and 4h aren't stored, the app builds them from 30m as it does for live charts, so the two always match.
// 1D comes from Alpaca's daily bars, as live charts use. A stock split changes every older adjusted price:
// each update compares the last 30 stored daily closes with Alpaca's, and a steady ratio between them means
// a split since, so that symbol is downloaded again whole (a minute).
//
// Run by history/kraken.mjs (the runner's hourly update and the Stock data page's jobs), under its lock: one
// writer at a time. The key comes from the app's feeds.json (FEEDS_FILE), read at run time and never written
// anywhere. Alpaca allows 200 calls a minute on the free plan, shared with the live stock charts on the same
// key, so this keeps to 2 a second and waits a minute when told to slow down.
import { seriesId, sourceId, upsertBars, replaceRange, lastTime, aggregate, writeJson, readJson, STATUS_FILE, SETTINGS_FILE } from "./db.mjs";

const BASE = (process.env.ALPACA_DATA_BASE || "https://data.alpaca.markets").replace(/\/+$/, "");
export const SINCE = Date.UTC(2016, 0, 1) / 1000;
// the free plan's SIP bars stop 15 minutes back; a minute's room
export const END_GAP = 16 * 60;
const PACE_MS = Number(process.env.ALPACA_PACE_MS || 500);
const SLOW_MS = Number(process.env.ALPACA_SLOW_MS || 60000);
// tickers as Alpaca writes them: F, AAPL, BRK.B
export const SYMBOL = /^[A-Z][A-Z0-9.]{0,9}$/;
const BUILT = [300, 900, 1800];
const DAY = 86400;
const SRC = "alpaca-sip";
const iso = (t) => new Date(t * 1000).toISOString();
const log = (...a) => console.log(new Date().toISOString().slice(0, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- New York's session, as the app's lib/feeds.js has it (a test checks the two agree)
const nyOffset = new Map();
function nyOffsetHours(sec) {
  const day = Math.floor(sec / DAY);
  if (!nyOffset.has(day)) {
    const h = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        hourCycle: "h23",
      }).format(new Date((day * DAY + 12 * 3600) * 1000)),
    );
    nyOffset.set(day, 12 - h);
  }
  return nyOffset.get(day);
}
export function inUsSession(sec) {
  const local = (((sec - nyOffsetHours(sec) * 3600) % DAY) + DAY) % DAY;
  return local >= 34200 && local < 57600;
}

// ---- settings and status (beside Kraken's in the same files)
export function settings() {
  const s = readJson(SETTINGS_FILE, {});
  return { symbols: [], automatic: false, ...(s.alpaca || {}) };
}
function saveSettings(a) {
  const s = readJson(SETTINGS_FILE, {});
  s.alpaca = a;
  writeJson(SETTINGS_FILE, s);
}
function status(update) {
  const s = readJson(STATUS_FILE, {});
  update((s.alpaca ||= {}));
  s.updatedAt = iso(Date.now() / 1000);
  writeJson(STATUS_FILE, s);
}
const note = (job) => status((a) => (a.job = job ? { ...job, pid: process.pid, at: iso(Date.now() / 1000) } : null));

// ---- the key, from the app's feeds.json; never in a message
function key() {
  const a = process.env.FEEDS_FILE ? readJson(process.env.FEEDS_FILE, {})?.alpaca : null;
  if (!a?.keyId || !a?.secretKey) throw new Error("No Alpaca key: add it in Settings, Stock data");
  return a;
}
const clean = (m, k) => [k.keyId, k.secretKey].reduce((s, x) => (x ? s.split(x).join("…") : s), String(m));

let lastCall = 0;
async function call(path, params, k) {
  for (let tries = 0; ; tries++) {
    const wait = lastCall + PACE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    let r;
    try {
      r = await fetch(`${BASE}${path}?${new URLSearchParams(params)}`, {
        headers: { "APCA-API-KEY-ID": k.keyId, "APCA-API-SECRET-KEY": k.secretKey },
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      throw new Error(clean(`Couldn't reach Alpaca: ${e.message}`, k));
    }
    if (r.status === 429 && tries < 5) {
      log(`Alpaca says slow down; waiting ${SLOW_MS / 1000} s`);
      await sleep(SLOW_MS);
      continue;
    }
    const body = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403) throw new Error(clean(`Alpaca didn't accept the key (${body.message || r.status})`, k));
    if (!r.ok) throw new Error(clean(`Alpaca said ${r.status}: ${body.message || r.statusText}`, k));
    return body;
  }
}

// Every page of one symbol's bars between two times, handed over a page at a time.
async function pages(sym, timeframe, from, to, k, each) {
  let token = null,
    n = 0;
  do {
    const q = { symbols: sym, timeframe, start: iso(from), end: iso(to), limit: "10000", feed: "sip", adjustment: "split", sort: "asc" };
    if (token) q.page_token = token;
    const j = await call("/v2/stocks/bars", q, k);
    n += each((j.bars?.[sym] || []).map((b) => ({ t: Math.floor(Date.parse(b.t) / 1000), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, n: b.n ?? null })));
    token = j.next_page_token || null;
  } while (token);
  return n;
}

// Daily bars carry the trading date as UTC midnight, like every other source in the app.
const dayOf = (sec) => Math.floor(sec / DAY) * DAY;

// A split since the last download: the store's daily closes against Alpaca's (split adjusted as of today)
// for the same days. A steady ratio away from 1 (every day off by the same factor) is a split; a day or two off
// is a correction, not a split.
export function splitSince(stored, fresh) {
  const now = new Map(fresh.map((b) => [b.t, b.c]));
  const ratios = stored.filter((b) => now.has(b.t) && b.c > 0).map((b) => now.get(b.t) / b.c);
  if (ratios.length < 3) return null;
  const mid = [...ratios].sort((a, b) => a - b)[Math.floor(ratios.length / 2)];
  if (Math.abs(mid - 1) < 0.02) return null;
  return ratios.every((r) => Math.abs(r / mid - 1) < 0.01) ? mid : null;
}

function forget(db, sym) {
  const ids = db.prepare("SELECT id FROM series WHERE exchange = 'US' AND symbol = ?").all(sym).map((r) => r.id);
  for (const id of ids) db.prepare("DELETE FROM bars WHERE series = ?").run(id);
  return ids.length;
}

// One symbol from its last stored minute (or 2016) to 16 minutes ago.
export async function updateSymbol(db, sym, k, now = Date.now() / 1000) {
  const src = sourceId(db, SRC);
  const dayS = seriesId(db, "US", sym, DAY);
  // daily first: the last 30 days, which also tells whether a split happened since
  const lastDay = lastTime(db, dayS);
  const to = Math.floor(now - END_GAP);
  const fresh = [];
  await pages(sym, "1Day", lastDay == null ? SINCE : Math.max(SINCE, lastDay - 30 * DAY), to, k, (rows) => fresh.push(...rows.map((b) => ({ ...b, t: dayOf(b.t) }))));
  if (lastDay != null) {
    const stored = db.prepare("SELECT t, c FROM bars WHERE series = ? AND t >= ? ORDER BY t").all(dayS, lastDay - 30 * DAY);
    const split = splitSince(stored, fresh);
    if (split) {
      log(`${sym}: prices moved by ${split.toFixed(4)} since the last download (a split): downloading it again`);
      forget(db, sym);
      return updateSymbol(db, sym, k, now);
    }
  }
  upsertBars(db, dayS, src, fresh);
  // minutes: the regular session only, as stock charts show
  const one = seriesId(db, "US", sym, 60);
  const last = lastTime(db, one);
  const from = last == null ? SINCE : last + 60;
  let n = 0;
  if (to - from >= 60) {
    note({ kind: "alpaca", symbol: sym, note: `${sym} from ${iso(from).slice(0, 10)}` });
    n = await pages(sym, "1Min", from, to, k, (rows) => upsertBars(db, one, src, rows.filter((b) => inUsSession(b.t))));
    // 5m, 15m and 30m for the stretch, from the stored minutes (complete buckets only), a month at a time
    for (const tf of BUILT) {
      const series = seriesId(db, "US", sym, tf);
      for (let a = Math.floor(from / tf) * tf; a < to; a += 30 * DAY) {
        const b = Math.min(a + 30 * DAY, to);
        const rows = db.prepare("SELECT t, o, h, l, c, v, n FROM bars WHERE series = ? AND t >= ? AND t < ? ORDER BY t").all(one, a, b);
        replaceRange(db, series, src, a, b, aggregate(rows, tf, b));
      }
    }
  }
  const span = db.prepare("SELECT MIN(t) AS first, MAX(t) AS last, COUNT(*) AS n FROM bars WHERE series = ?").get(one);
  status((a) => ((a.symbols ||= {})[sym] = { first: span.first, last: span.last, bars: span.n, lastOk: iso(now) }));
  return n;
}

// The hourly update (or Update now): every symbol in the list, one at a time.
export async function update(db, { now: forced = false } = {}) {
  const set = settings();
  if ((!set.automatic && !forced) || !set.symbols.length) return;
  let k;
  try {
    k = key();
  } catch (e) {
    status((a) => ((a.failures = (a.failures || 0) + 1), (a.lastError = { at: iso(Date.now() / 1000), message: e.message })));
    throw e;
  }
  const errors = [];
  for (const sym of set.symbols) {
    try {
      const n = await updateSymbol(db, sym, k);
      log(`${sym}: ${n} new minutes`);
    } catch (e) {
      errors.push(`${sym}: ${e.message}`);
      status((a) => (((a.symbols ||= {})[sym] ||= {}).error = { at: iso(Date.now() / 1000), message: e.message }));
    }
  }
  note(null);
  status((a) => {
    a.automatic = set.automatic;
    if (errors.length) {
      a.failures = (a.failures || 0) + 1;
      a.lastError = { at: iso(Date.now() / 1000), message: errors.join("; ") };
    } else {
      a.failures = 0;
      a.lastOk = iso(Date.now() / 1000);
    }
  });
  if (errors.length) throw new Error(errors.join("; "));
}

// A request from the Stock data page (history/data/jobs, source "alpaca"); its words for the page.
export async function job(db, j) {
  const set = settings();
  const syms = (list) => {
    const out = [...new Set((Array.isArray(list) ? list : [list]).map((x) => String(x || "").toUpperCase().trim()))];
    if (!out.length || !out.every((s) => SYMBOL.test(s))) throw new Error("tickers are like AAPL, F or BRK.B");
    return out;
  };
  if (j.cmd === "start") {
    // the first download: the symbols the page offers (my watchlists' US stocks), Automatic on
    saveSettings({ ...set, symbols: syms(j.symbols), automatic: true });
    await update(db, { now: true });
    return "downloaded";
  }
  if (j.cmd === "add") {
    const [sym] = syms(j.symbol);
    if (!set.symbols.includes(sym)) saveSettings({ ...set, symbols: [...set.symbols, sym] });
    await updateSymbol(db, sym, key());
    note(null);
    return `added ${sym}`;
  }
  if (j.cmd === "remove") {
    const [sym] = syms(j.symbol);
    saveSettings({ ...set, symbols: set.symbols.filter((s) => s !== sym) });
    forget(db, sym);
    status((a) => delete (a.symbols ||= {})[sym]);
    return `removed ${sym}`;
  }
  if (j.cmd === "update") {
    await update(db, { now: true });
    return "updated";
  }
  if (j.cmd === "automatic") {
    saveSettings({ ...set, automatic: !!j.on });
    status((a) => (a.automatic = !!j.on));
    return j.on ? "automatic on" : "automatic off";
  }
  throw new Error("not a job the stock history knows");
}
