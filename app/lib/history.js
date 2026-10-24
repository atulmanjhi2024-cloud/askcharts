// The market history store kept by history/ at the repo root: years of an exchange's own bars in one
// SQLite file (Kraken's from its archives, its trades and its OHLC endpoint). Only history/'s importers
// write it; here it's opened read only, so charts and deep backtests reach past what an exchange's free
// API returns (Kraken's 720 bars). Override the file with QT_HISTORY.
//
// Beside it: status.json (what the importer last did, for Settings, Market data), settings.json (the
// coins, Automatic) and jobs/, where the Market data page leaves requests for the importer to run.
import { DatabaseSync } from "node:sqlite";
import fs, { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseTf, resample } from "../public/lib/series.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = process.env.QT_HISTORY || path.join(ROOT, "..", "history", "data", "bars.sqlite");
const DIR = path.dirname(FILE);
// Before the importer's first run there's no settings.json: Automatic is then what the importer would
// start with, from its config.json (off in a fresh AskCharts, so nothing big downloads by itself)
const configAutomatic = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "..", "history", "config.json"), "utf8")).kraken?.automatic ?? true;
  } catch {
    return true;
  }
};
const STATUS = path.join(DIR, "status.json"),
  SETTINGS = path.join(DIR, "settings.json"),
  JOBS = path.join(DIR, "jobs");
// how many bars a chart or a deep backtest may get from the store (an exchange's API: 20,000 at most)
export const MAX_BARS = 200000;

let db = null,
  openedAt = 0,
  lists = new Map();
function store() {
  // a store that appears later (the first import) is picked up within a minute
  if (db || Date.now() - openedAt < 60000) return db;
  openedAt = Date.now();
  if (!existsSync(FILE)) return null;
  try {
    db = new DatabaseSync(FILE, { readOnly: true });
  } catch {
    db = null;
  }
  return db;
}

// Kraken's archives name BTC XBT and DOGE XDG; charts use the common names.
const ALIASES = { KRAKEN: [[/^BTC/, "XBT"], [/^DOGE/, "XDG"]] };
// The stored intervals (seconds) for a chart symbol, and the name they're stored under.
function storedFor(exchange, ticker) {
  const d = store();
  if (!d) return null;
  const key = `${exchange}:${ticker}`;
  const hit = lists.get(key);
  if (hit && Date.now() - hit.at < 60000) return hit.v;
  const names = [ticker, ...(ALIASES[exchange] || []).filter(([re]) => re.test(ticker)).map(([re, to]) => ticker.replace(re, to))];
  let v = null;
  for (const symbol of names) {
    const rows = d.prepare("SELECT id, tf FROM series WHERE exchange = ? AND symbol = ? AND EXISTS (SELECT 1 FROM bars WHERE series = series.id) ORDER BY tf").all(exchange, symbol);
    if (rows.length) {
      v = { symbol, series: rows };
      break;
    }
  }
  lists.set(key, { at: Date.now(), v });
  return v;
}

export const covers = (exchange, ticker) => !!storedFor(exchange, ticker);

// ---------- Settings, Market data: download a coin's stored bars as CSV ----------
// 5,000 bars a page (one short read each), the CSV import's own columns, at the finest interval kept
// (Kraken's archives: 1 minute), so the file a coin's Download button gives can be imported back.
const EXPORT_PAGE = 5000;
export function exportSeries(exchange, ticker, { page = EXPORT_PAGE } = {}) {
  const s = storedFor(exchange, ticker);
  if (!s) return null;
  const series = s.series[0]; // storedFor orders series by tf ascending: this is the finest one stored
  return {
    symbol: s.symbol,
    tfSeconds: series.tf,
    *rows() {
      const d = store();
      let after = -Infinity;
      for (;;) {
        const chunk = d
          .prepare("SELECT t, o, h, l, c, v FROM bars WHERE series = ? AND t > ? ORDER BY t LIMIT ?")
          .all(series.id, after, page);
        if (!chunk.length) return;
        yield chunk;
        after = chunk[chunk.length - 1].t;
      }
    },
  };
}

// The last `limit` bars of `tf` from the store: stored as they are, or built from the largest stored
// interval that divides it (30m from 15m, 1W from 1D). Null when the store doesn't have the symbol.
export function bars(exchange, ticker, tf, limit) {
  const s = storedFor(exchange, ticker);
  if (!s) return null;
  const sec = parseTf(tf).seconds;
  const base = [...s.series].reverse().find((x) => x.tf <= sec && (sec % x.tf === 0 || x.tf === 86400));
  if (!base) return null;
  const per = Math.max(1, Math.ceil(sec / base.tf));
  const raw = store()
    .prepare("SELECT t, o, h, l, c, v, src FROM bars WHERE series = ? ORDER BY t DESC LIMIT ?")
    .all(base.id, Math.min(limit * per + per, MAX_BARS * 31))
    .reverse();
  const rows = raw.map((r) => ({ time: r.t, open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v }));
  const out = (base.tf === sec ? rows : resample(rows, tf)).slice(-limit);
  // where the bars on the chart came from (an archive, Kraken's trades, its OHLC feed), oldest first
  const names = sourceNames(),
    from = out[0]?.time ?? Infinity,
    spans = new Map();
  for (const r of raw) {
    if (r.t < from) continue;
    const x = spans.get(r.src);
    if (x) x.to = r.t;
    else spans.set(r.src, { name: names.get(r.src) || "unknown", from: r.t, to: r.t });
  }
  const sources = [...spans.values()].sort((a, b) => a.from - b.from);
  return { symbol: s.symbol, candles: out, first: rows[0]?.time ?? null, last: rows.at(-1)?.time ?? null, sources };
}
let names = { at: 0, v: new Map() };
function sourceNames() {
  if (Date.now() - names.at > 60000) names = { at: Date.now(), v: new Map(store().prepare("SELECT id, name FROM sources").all().map((r) => [r.id, r.name])) };
  return names.v;
}

// ---------- Settings, Market data ----------
const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};
function queued() {
  try {
    return fs
      .readdirSync(JOBS)
      .filter((f) => /^[\w.-]+\.json$/.test(f))
      .sort()
      .map((f) => readJson(path.join(JOBS, f), null))
      .filter(Boolean)
      .map((j) => ({ cmd: j.cmd, pair: j.pair, on: j.on, at: j.at }));
  } catch {
    return [];
  }
}

// A copy that reads another copy's store (my dev reads prod's) must not queue jobs for that store's
// importer: they would run there. QT_HISTORY_JOBS=off makes Market data read only.
const jobsOff = () => process.env.QT_HISTORY_JOBS === "off";

// Everything the Market data page shows: the importer's status.json, the settings, the waiting requests.
export function status() {
  const st = readJson(STATUS, {}),
    set = readJson(SETTINGS, null);
  const k = st.kraken || {};
  // a job whose importer has gone (a crash, a restart of the box) isn't running any more
  if (k.job && !(k.job.pid && alive(k.job.pid))) k.job = null;
  return {
    available: existsSync(FILE),
    updatedAt: st.updatedAt ?? null,
    schema: st.schema ?? null,
    disk: st.disk ?? null,
    kraken: { ...k, pairs: k.pairs || {}, coins: set?.kraken?.pairs ?? Object.keys(k.pairs || {}), automatic: set?.kraken?.automatic ?? k.automatic ?? configAutomatic() },
    queued: queued(),
    jobs: !jobsOff(),
  };
}

// The history line in /api/health, for the app's notices: failures in a row, and whether the store has
// stopped updating while Automatic is on.
export function health() {
  const st = readJson(STATUS, null);
  if (!st?.kraken) return null;
  const k = st.kraken,
    set = readJson(SETTINGS, null);
  const automatic = set?.kraken?.automatic ?? k.automatic ?? configAutomatic();
  const since = k.lastOk || k.lastRun || null;
  // a long job (an Add coin, a repair) holds the importer, and the hourly runs step aside meanwhile
  const busy = !!(k.job?.pid && alive(k.job.pid));
  return {
    failures: k.failures || 0,
    lastError: k.lastError || null,
    since,
    stale: automatic && !busy && !!since && Date.now() - Date.parse(since) > 3 * 3600e3,
  };
}

// A request from the page, for history/kraken.mjs jobs (AskCharts' runner starts it when jobs/ isn't
// empty). Only these commands, only plain Kraken pair names; written whole, then moved into the folder.
const JOB_CMDS = new Set(["update", "add", "remove", "verify", "gaps", "automatic"]);
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
export function requestJob(body) {
  if (jobsOff()) throw Object.assign(new Error("This copy reads the history store read only. Its actions run on the copy that keeps the store."), { status: 403 });
  const cmd = String(body?.cmd || "");
  if (!JOB_CMDS.has(cmd)) throw bad("Not a Market data action");
  const job = { cmd, at: new Date().toISOString() };
  if (cmd === "add" || cmd === "remove") {
    job.pair = String(body.pair || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{2,20}$/.test(job.pair)) throw bad("Use Kraken's name for the pair, like XBTUSD");
  }
  if (cmd === "automatic") job.on = body.on === true;
  const waiting = queued();
  if (waiting.length >= 20) throw Object.assign(new Error("Twenty requests are already waiting"), { status: 429 });
  // the same request twice is one (Automatic: the newer choice wins, so it's always written)
  if (cmd !== "automatic" && waiting.some((w) => w.cmd === cmd && w.pair === job.pair)) return { ok: true, queued: waiting };
  fs.mkdirSync(JOBS, { recursive: true, mode: 0o700 });
  const name = `${Date.now()}-${randomUUID().slice(0, 8)}.json`,
    tmp = path.join(DIR, `.job-${name}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(job), { mode: 0o600 });
  fs.renameSync(tmp, path.join(JOBS, name));
  return { ok: true, queued: queued() };
}
