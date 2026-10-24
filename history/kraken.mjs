// Kraken history for the bar store, as Kraken's own bars: bar open time in UTC seconds, no bar for an
// interval with no trades. The past comes from Kraken's bulk OHLCVT archives (each pair from its first
// trade to the archive's end date), the stretch since from the public Trades endpoint (built into 1m
// bars, which match Kraken's own candles exactly), and the OHLC endpoint keeps it current.
//
//   node history/kraken.mjs update [PAIR...] [--now]   from each series' last bar to now, then upkeep when
//                                                     due (hourly timer; --now runs even when Automatic is off)
//   node history/kraken.mjs jobs                       run what the Crypto data page asked for (data/jobs/)
//   node history/kraken.mjs add PAIR | remove PAIR     a coin in or out (archives, then trades and OHLC)
//   node history/kraken.mjs bulk [PAIR...] [--force]   import data/raw/kraken/Kraken_OHLCVT_*.zip
//   node history/kraken.mjs verify [PAIR...]           built-from-trades bars against Kraken's own
//   node history/kraken.mjs gaps [PAIR...]             hours whose 1m bars don't add up to Kraken's 1h bar; repairs recent ones
//   node history/kraken.mjs quarterly                  fetch and import Kraken's next quarterly archive, if it's out
//   node history/kraken.mjs status                     what's stored
//
// Pairs default to data/settings.json (made from config.json the first time). Kraken asks public callers
// to keep to about one request a second, per IP and per pair; the live charts share that, so every call
// here waits its turn. One writer at a time (data/kraken.lock). Everything the Crypto data page shows is
// in data/status.json.
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import readline from "node:readline";
import { pipeline } from "node:stream/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, seriesId, sourceId, upsertBars, replaceRange, lastTime, getState, setState, aggregate, writeJson, readJson, DATA, HERE, DB_FILE, STATUS_FILE, SETTINGS_FILE, JOBS_DIR, SCHEMA } from "./db.mjs";
// the store's other writers, run from here under the same lock: US stocks from Alpaca (Settings, Stock data)
// and Binance's coins (Settings, Crypto data)
import * as alpaca from "./alpaca.mjs";
import * as binance from "./binance.mjs";

const RAW = path.join(DATA, "raw", "kraken");
const API = "https://api.kraken.com/0/public";
// Kraken's archives (KRAKEN_FILES points the tests at a local copy)
const FILES = (process.env.KRAKEN_FILES || "https://assets.kraken.com/marketing/institutions").replace(/\/+$/, "");
const INTERVALS = [1, 5, 15, 60, 240, 720, 1440]; // minutes: what the archives hold
// what the OHLC endpoint serves: no 720 (12h), which is built from 4h bars instead
const API_INTERVALS = new Set([1, 5, 15, 60, 240, 1440]);
const PACE_MS = 1100;
const PAIR = /^[A-Z0-9]{2,20}$/;
const DAY = 86400;
const config = JSON.parse(fs.readFileSync(path.join(HERE, "config.json"), "utf8"));
const log = (...a) => console.log(new Date().toISOString().slice(0, 19), ...a);
const iso = (t = Date.now() / 1000) => new Date(t * 1000).toISOString();

// ---- settings: the coins, Automatic, the disk floor (the page changes them through jobs)
function settings() {
  const s = readJson(SETTINGS_FILE, null);
  if (s?.kraken?.pairs) return s;
  // config.json may start Automatic off (a fresh AskCharts downloads nothing big until asked)
  const made = { kraken: { pairs: [...config.kraken.pairs], automatic: config.kraken.automatic ?? true }, minFreeGB: config.minFreeGB ?? 20 };
  writeJson(SETTINGS_FILE, made);
  return made;
}
const saveSettings = (s) => writeJson(SETTINGS_FILE, s);

// ---- status.json: what the Crypto data page shows
function status(update) {
  const s = readJson(STATUS_FILE, {});
  update(s);
  s.updatedAt = iso();
  writeJson(STATUS_FILE, s);
}
const pairStatus = (s, pair) => (((s.kraken ||= {}).pairs ||= {})[pair] ||= {});
function noteJob(note) {
  status((s) => {
    (s.kraken ||= {}).job = note ? { ...note, pid: process.pid, at: iso() } : null;
  });
}

// ---- disk: imports stop before the store fills the disk
function diskCheck(needGB = 0) {
  const st = fs.statfsSync(DATA);
  const free = st.bavail * st.bsize;
  const floor = (settings().minFreeGB ?? 20) * 1e9;
  status((s) => {
    s.disk = { storeBytes: fs.existsSync(DB_FILE) ? fs.statSync(DB_FILE).size : 0, rawBytes: dirSize(RAW), freeBytes: free, minFreeGB: floor / 1e9 };
  });
  if (free - needGB * 1e9 < floor) throw new Error(`not enough disk space: ${(free / 1e9).toFixed(1)} GB free, keeping at least ${floor / 1e9} GB`);
}
function dirSize(dir) {
  try {
    return fs.readdirSync(dir).reduce((a, f) => a + fs.statSync(path.join(dir, f)).size, 0);
  } catch {
    return 0;
  }
}

// ---- calls to Kraken, one at a time and paced
let lastCall = 0;
async function kraken(endpoint, params) {
  const wait = lastCall + PACE_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const url = `${API}/${endpoint}?${new URLSearchParams(params)}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "AskCharts history (personal backtesting)" }, signal: AbortSignal.timeout(30000) });
      const j = await res.json();
      if (j.error?.length) throw new Error(j.error.join(", "));
      return j.result;
    } catch (e) {
      // "Too many requests" and network trouble: back off and try again, a few times; a wrong
      // request (EGeneral:Invalid arguments, EQuery:Unknown asset pair) won't get better
      if (attempt >= 5 || /^E(General:Invalid|Query:)/.test(e.message)) throw e;
      log(`kraken ${endpoint} ${params.pair}: ${e.message}; retrying`);
      await new Promise((r) => setTimeout(r, 5000 * attempt));
      lastCall = Date.now();
    }
  }
}

// ---- archives
// One archive row: timestamp,open,high,low,close,volume,trades (no header). Anything else is skipped.
export function parseRow(line) {
  const f = line.split(",");
  if (f.length !== 7) return null;
  const [t, o, h, l, c, v, n] = f.map(Number);
  if (![t, o, h, l, c, v, n].every(Number.isFinite) || !Number.isInteger(t) || t < 1e9 || t > 4e9) return null;
  return { t, o, h, l, c, v, n };
}

function archives() {
  const names = fs.existsSync(RAW) ? fs.readdirSync(RAW).filter((f) => /^Kraken_OHLCVT_(Full|\d{4}Q[1-4])\.zip$/.test(f)) : [];
  // the full history first, then the quarters in order, so later data replaces earlier
  return names.sort((a, b) => (a.includes("Full") ? -1 : b.includes("Full") ? 1 : a.localeCompare(b))).map((f) => path.join(RAW, f));
}
// Kraken's archives are zips: unzip reads them on a Mac and on Linux; Windows has no unzip, but its own
// tar (bsdtar) reads zips, large ones included
const ZIP =
  process.platform === "win32"
    ? { tool: "tar", list: (z) => ["-tf", z], read: (z, e) => ["-xOf", z, e], test: (z) => ["-tf", z] }
    : { tool: "unzip", list: (z) => ["-Z1", z], read: (z, e) => ["-p", z, e], test: (z) => ["-tqq", z] };
const zipMissing = (e) =>
  e.code === "ENOENT" ? Object.assign(new Error(`Kraken's history needs ${ZIP.tool} to read its archives. Install it (on Ubuntu or Debian: sudo apt install unzip) and try again.`), { code: "ENOENT" }) : e;
const zipRun = (args, opts) => {
  try {
    return execFileSync(ZIP.tool, args, opts);
  } catch (e) {
    throw zipMissing(e);
  }
};
const listing = (zip) => new Set(zipRun(ZIP.list(zip), { maxBuffer: 64 * 1024 * 1024 }).toString().split(/\r?\n/));

async function importEntry(db, zip, entry, series, src) {
  const proc = spawn(ZIP.tool, ZIP.read(zip, entry), { stdio: ["ignore", "pipe", "pipe"] });
  const failed = new Promise((_, reject) => proc.on("error", (e) => reject(zipMissing(e))));
  failed.catch(() => {});
  const lines = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
  let batch = [],
    rows = 0,
    bad = 0;
  for await (const line of lines) {
    if (!line) continue;
    const r = parseRow(line);
    if (!r) {
      bad++;
      continue;
    }
    batch.push(r);
    if (batch.length >= 50000) {
      rows += upsertBars(db, series, src, batch);
      batch = [];
    }
  }
  rows += upsertBars(db, series, src, batch);
  const code = await Promise.race([new Promise((r) => proc.on("close", r)), failed]);
  if (code !== 0) throw new Error(`${ZIP.tool} ${ZIP.read(path.basename(zip), entry).join(" ")} exited ${code}`);
  return { rows, bad };
}

async function bulk(db, pairs, force) {
  for (const zip of archives()) {
    const name = path.basename(zip, ".zip").replace("Kraken_OHLCVT_", "");
    let names = null;
    const src = sourceId(db, `kraken-archive-${name}`);
    for (const pair of pairs) {
      const key = `kraken:archive:${name}:${pair}`;
      if (!force && getState(db, key)) continue;
      diskCheck(1);
      names ||= listing(zip);
      let total = 0;
      for (const m of INTERVALS) {
        const entry = `${pair}_${m}.csv`;
        if (!names.has(entry)) continue;
        noteJob({ kind: "archive", pair, note: `${name}, ${m}m bars` });
        const { rows, bad } = await importEntry(db, zip, entry, seriesId(db, "KRAKEN", pair, m * 60), src);
        total += rows;
        if (bad) log(`${name} ${entry}: skipped ${bad} unreadable rows`);
      }
      setState(db, key, iso());
      log(`${name} ${pair}: ${total.toLocaleString()} bars`);
    }
    status((s) => {
      const a = new Set((s.kraken ||= {}).archives || []);
      a.add(name);
      s.kraken.archives = [...a].sort((x, y) => (x === "Full" ? -1 : y === "Full" ? 1 : x.localeCompare(y)));
    });
  }
}

// ---- trades into 1m bars: each trade { p: price, v: volume, time: seconds, id }
export function tradeBars(trades) {
  trades.sort((a, b) => a.id - b.id);
  const bars = new Map();
  for (const x of trades) {
    const t = Math.floor(x.time / 60) * 60;
    const b = bars.get(t);
    if (!b) bars.set(t, { t, o: x.p, h: x.p, l: x.p, c: x.p, v: x.v, n: 1 });
    else {
      b.h = Math.max(b.h, x.p);
      b.l = Math.min(b.l, x.p);
      b.c = x.p;
      b.v += x.v;
      b.n++;
    }
  }
  return [...bars.values()].sort((a, b) => a.t - b.t);
}
// Every trade from `from` up to (not including) `to`, UTC seconds.
async function tradesBetween(pair, from, to) {
  let since = String(BigInt(Math.floor(from)) * 1000000000n);
  const seen = new Set();
  const all = [];
  for (;;) {
    const r = await kraken("Trades", { pair, since, count: 1000 });
    const k = Object.keys(r).find((x) => x !== "last");
    const page = r[k] || [];
    for (const t of page) {
      const x = { p: Number(t[0]), v: Number(t[1]), time: Number(t[2]), id: Number(t[6]) };
      if (seen.has(x.id) || x.time < from || x.time >= to) continue;
      seen.add(x.id);
      all.push(x);
    }
    const latest = Number(page.at(-1)?.[2] ?? 0);
    if (!page.length || r.last === since || latest >= to) break;
    since = r.last;
  }
  return all;
}

// From the last stored 1m bar to now, from trades, flushed minute by minute so a long run keeps its work.
async function tradesTo1m(db, pair, from) {
  const series = seriesId(db, "KRAKEN", pair, 60),
    src = sourceId(db, "kraken-trades");
  const key = `kraken:trades:${pair}`;
  let since = getState(db, key);
  if (!since || Number(BigInt(since) / 1000000000n) < from) since = String(BigInt(from) * 1000000000n);
  const seen = new Set();
  let pending = [],
    pages = 0,
    stored = 0;
  const flush = (upTo) => {
    const done = pending.filter((x) => Math.floor(x.time / 60) * 60 + 60 <= upTo);
    pending = pending.filter((x) => Math.floor(x.time / 60) * 60 + 60 > upTo);
    stored += upsertBars(db, series, src, tradeBars(done));
  };
  for (;;) {
    const r = await kraken("Trades", { pair, since, count: 1000 });
    const k = Object.keys(r).find((x) => x !== "last");
    const rows = r[k] || [];
    pages++;
    for (const t of rows) {
      const id = Number(t[6]);
      if (seen.has(id)) continue;
      seen.add(id);
      pending.push({ p: Number(t[0]), v: Number(t[1]), time: Number(t[2]), id });
    }
    const latest = rows.length ? Number(rows.at(-1)[2]) : 0;
    if (rows.length && pending.length && Math.floor(latest / 60) * 60 > Math.floor(Math.min(...pending.map((x) => x.time)) / 60) * 60) {
      const minute = Math.floor(latest / 60) * 60;
      flush(minute);
      // resume from the start of the minute still open, so its bar is built from all its trades
      setState(db, key, String(BigInt(minute) * 1000000000n));
    }
    if (pages % 200 === 0) {
      log(`${pair} trades: ${pages} pages, at ${iso(latest).slice(0, 16)}`);
      noteJob({ kind: "trades", pair, note: `trades to ${iso(latest).slice(0, 16).replace("T", " ")}` });
    }
    if (!rows.length || r.last === since || latest > Date.now() / 1000 - 90) break;
    since = r.last;
  }
  flush(Math.floor(Date.now() / 1000 / 60) * 60);
  return { pages, stored };
}

// The OHLC endpoint's last 720 bars for one interval; its last row is the bar still open, left out, and
// so are its fillers for intervals without trades (flat, zero volume), which the archives don't have.
async function ohlc(db, pair, m) {
  const r = await kraken("OHLC", { pair, interval: m });
  const k = Object.keys(r).find((x) => x !== "last");
  const rows = (r[k] || [])
    .slice(0, -1)
    .map((x) => ({ t: x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[6], n: x[7] }))
    .filter((x) => x.v > 0 || x.n > 0);
  return upsertBars(db, seriesId(db, "KRAKEN", pair, m * 60), sourceId(db, "kraken-ohlc"), rows);
}

// Coarser intervals for a stretch, rebuilt from the stored 1m bars (complete buckets only).
function rebuildFrom1m(db, pair, intervals, from, to, srcName) {
  const one = seriesId(db, "KRAKEN", pair, 60);
  for (const m of intervals) {
    const tf = m * 60,
      a = Math.floor(from / tf) * tf,
      b = Math.ceil(to / tf) * tf;
    const rows = db.prepare("SELECT t, o, h, l, c, v, n FROM bars WHERE series = ? AND t >= ? AND t < ? ORDER BY t").all(one, a, b);
    replaceRange(db, seriesId(db, "KRAKEN", pair, tf), sourceId(db, srcName), a, b, aggregate(rows, tf, b));
  }
}

async function updatePair(db, pair, now) {
  const one = seriesId(db, "KRAKEN", pair, 60);
  const last1 = lastTime(db, one);
  if (last1 == null) throw new Error("nothing stored yet (add it first)");
  // 1m: inside the endpoint's 12 hours, one call; further back, the trades since
  if (now - last1 < 11 * 3600) await ohlc(db, pair, 1);
  else {
    noteJob({ kind: "trades", pair, note: `trades since ${iso(last1).slice(0, 16).replace("T", " ")}` });
    const r = await tradesTo1m(db, pair, last1 + 60);
    log(`${pair} 1m from trades: ${r.pages} pages, ${r.stored} bars`);
  }
  for (const m of INTERVALS.slice(1)) {
    const series = seriesId(db, "KRAKEN", pair, m * 60);
    const last = lastTime(db, series) ?? 0;
    if (!API_INTERVALS.has(m)) {
      // 12h: two 12h bars a day from the 4h bars (Kraken's 12h bars open at 00:00 and 12:00 UTC)
      const four = seriesId(db, "KRAKEN", pair, 240 * 60);
      const rows = db.prepare("SELECT t, o, h, l, c, v, n FROM bars WHERE series = ? AND t >= ? ORDER BY t").all(four, last + m * 60);
      upsertBars(db, series, sourceId(db, "kraken-built"), aggregate(rows, m * 60, lastTime(db, four) + 240 * 60));
      continue;
    }
    // the endpoint's 720 bars reach back far enough: Kraken's own bars
    if (now - last < m * 60 * 700) await ohlc(db, pair, m);
    else {
      // too far back for the endpoint: build them from the 1m bars, then Kraken's own for the newest 720
      const rows = db.prepare("SELECT t, o, h, l, c, v, n FROM bars WHERE series = ? AND t >= ? ORDER BY t").all(one, last + m * 60);
      upsertBars(db, series, sourceId(db, "kraken-trades"), aggregate(rows, m * 60, lastTime(db, one) + 60));
      await ohlc(db, pair, m);
    }
  }
}

function pairSummary(db, pair) {
  const one = db.prepare("SELECT id FROM series WHERE exchange = 'KRAKEN' AND symbol = ? AND tf = 60").get(pair)?.id;
  if (!one) return null;
  const r = db.prepare("SELECT COUNT(*) AS n, MIN(t) AS first, MAX(t) AS last FROM bars WHERE series = ?").get(one);
  const day = db.prepare("SELECT MIN(t) AS first FROM bars WHERE series = (SELECT id FROM series WHERE exchange = 'KRAKEN' AND symbol = ? AND tf = 86400)").get(pair);
  return { first: Math.min(r.first ?? Infinity, day?.first ?? Infinity), last1m: r.last, bars1m: r.n };
}

export const hasKrakenBars = (db) => !!db.prepare("SELECT 1 FROM bars b JOIN series s ON s.id = b.series WHERE s.exchange = 'KRAKEN' LIMIT 1").get();
async function update(db, pairs, { now: forced = false } = {}) {
  const set = settings();
  if (!set.kraken.automatic && !forced) {
    log("Automatic is off; nothing to do (Update now still works)");
    status((s) => ((s.kraken ||= {}).automatic = false));
    return;
  }
  // a store with no Kraken bars yet starts from Kraken's archive (the first download); stock bars don't count
  if (!hasKrakenBars(db)) {
    try {
      await fullArchive();
      await bulk(db, pairs, false);
    } catch (e) {
      status((s) => {
        const k = (s.kraken ||= {});
        k.lastRun = iso();
        k.failures = (k.failures || 0) + 1;
        k.lastError = { at: iso(), message: e.message, pairs: pairs.length };
      });
      log(`first download: ${e.message}`);
      process.exitCode = 1;
      return;
    }
  }
  const now = Math.floor(Date.now() / 1000);
  let failed = 0,
    lastError = null;
  for (const pair of pairs) {
    try {
      await updatePair(db, pair, now);
      status((s) => Object.assign(pairStatus(s, pair), pairSummary(db, pair), { lastOk: iso(), error: null }));
      log(`${pair}: up to date`);
    } catch (e) {
      failed++;
      lastError = `${pair}: ${e.message}`;
      status((s) => Object.assign(pairStatus(s, pair), { error: { at: iso(), message: e.message } }));
      log(lastError);
    }
  }
  status((s) => {
    const k = (s.kraken ||= {});
    k.automatic = set.kraken.automatic;
    k.lastRun = iso();
    if (failed) {
      k.failures = (k.failures || 0) + 1;
      k.lastError = { at: iso(), message: lastError, pairs: failed };
    } else {
      k.failures = 0;
      k.lastOk = iso();
    }
  });
  if (failed) process.exitCode = 1;
  // upkeep covers every coin, whichever ones this run updated (an Add coin updates only the new one)
  await upkeep(db, settings().kraken.pairs);
}

// ---- upkeep, when due: Kraken's next quarterly archive (daily), gaps (daily), accuracy check (weekly)
async function upkeep(db, pairs) {
  const due = (k, every) => Date.now() / 1000 - Number(getState(db, k) || 0) >= every;
  for (const [k, every, fn] of [
    ["kraken:upkeep:quarterly", DAY, () => quarterly(db, pairs)],
    ["kraken:upkeep:gaps", DAY, () => gaps(db, pairs)],
    ["kraken:upkeep:verify", 7 * DAY, () => verify(db, pairs)],
  ]) {
    if (!due(k, every)) continue;
    try {
      await fn();
    } catch (e) {
      log(`${k}: ${e.message}`);
    }
    setState(db, k, Math.floor(Date.now() / 1000));
  }
}

// Kraken posts each quarter's archive at its end (the 2026Q3 file appeared within 6 days). Once out,
// it's fetched, tested and imported: Kraken's own bars replace those built from trades for that quarter.
export const quarterAfter = (q) => {
  const [y, n] = q.split("Q").map(Number);
  return n === 4 ? `${y + 1}Q1` : `${y}Q${n + 1}`;
};
async function quarterly(db, pairs) {
  const have = fs.existsSync(RAW) ? fs.readdirSync(RAW).map((f) => /^Kraken_OHLCVT_(\d{4}Q[1-4])\.zip$/.exec(f)?.[1]).filter(Boolean) : [];
  // a store started from the Full archive alone: the quarters after the one it ends with
  const full = path.join(RAW, "Kraken_OHLCVT_Full.zip");
  const fq = fs.existsSync(full) ? fullQuarter(full) : null;
  if (fq) have.push(fq);
  have.sort();
  if (!have.length) return;
  const next = quarterAfter(have.at(-1));
  const name = `Kraken_OHLCVT_${next}.zip`;
  status((s) => Object.assign((s.kraken ||= {}), { nextQuarter: next, quarterCheckedAt: iso() }));
  const head = await fetch(`${FILES}/${name}`, { method: "HEAD", headers: { "user-agent": "curl/8.5.0" }, signal: AbortSignal.timeout(30000) });
  if (head.status !== 200) return log(`${name}: not out yet (${head.status})`);
  const size = Number(head.headers.get("content-length") || 0);
  diskCheck(size / 1e9 + 2);
  noteJob({ kind: "download", note: `${name}, ${(size / 1e6).toFixed(0)} MB` });
  const part = path.join(RAW, `${name}.part`);
  execFileSync("curl", ["-sS", "-f", "-A", "curl/8.5.0", "-C", "-", "--retry", "5", "-o", part, `${FILES}/${name}`], { stdio: "inherit" });
  // every file in it, CRC checked; a broken download never reaches the store
  zipRun(ZIP.test(part));
  if (!listing(part).has("MANIFEST.json")) throw new Error(`${name}: no MANIFEST.json, not Kraken's layout`);
  fs.renameSync(part, path.join(RAW, name));
  log(`${name}: downloaded and tested; importing`);
  await bulk(db, pairs, false);
}

// The last whole quarter in an archive, from Kraken's MANIFEST.json (coverage.end, "2026-09-30" is 2026Q3). An
// end partway through a quarter leaves that quarter to the quarterly file.
export function quarterEnding(end) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(end || "");
  if (!m) return null;
  const next = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + 1));
  const whole = next.getUTCDate() === 1 && next.getUTCMonth() % 3 === 0;
  const y = +m[1],
    q = Math.ceil(+m[2] / 3);
  return whole ? `${y}Q${q}` : q === 1 ? `${y - 1}Q4` : `${y}Q${q - 1}`;
}
function fullQuarter(zip) {
  try {
    return quarterEnding(JSON.parse(zipRun(ZIP.read(zip, "MANIFEST.json")).toString()).coverage?.end);
  } catch {
    return null;
  }
}

// ---- the first download: Kraken's Full archive (every pair from its first trade to the end of the last
// quarter, about 10 GB) in the parts Kraken posts. Each part resumes where it stopped and is checked against
// Kraken's own SHA-256; the parts are joined one by one, each going once it's in (so the disk holds about the
// archive and one part), and every file in the zip is tested before it's used. Only for a store with no bars
// yet: one that has bars never downloads it again, whether or not its archives are still there.
const UA = { "user-agent": "curl/8.5.0" };
// the download's own processes (curl, the zip test) go when the importer does
const helpers = new Set();
process.on("exit", () => {
  for (const c of helpers) c.kill();
});
const gbs = (b) => (b / 1e9).toFixed(1);
const sizeOf = (f) => (fs.existsSync(f) ? fs.statSync(f).size : 0);
async function headSize(url) {
  const r = await fetch(url, { method: "HEAD", headers: UA, signal: AbortSignal.timeout(30000) });
  const n = Number(r.headers.get("content-length") || 0);
  if (r.status !== 200 || !(n > 0)) throw new Error(`${path.basename(url)}: Kraken answered ${r.status}`);
  return n;
}
function curl(url, file, tick) {
  return new Promise((resolve, reject) => {
    const c = spawn("curl", ["-sS", "-f", "-A", "curl/8.5.0", "-C", "-", "--retry", "5", "-o", file, url], { stdio: ["ignore", "ignore", "pipe"] });
    helpers.add(c);
    let err = "";
    c.stderr.on("data", (b) => (err += b));
    const t = setInterval(tick, 2000);
    const end = () => {
      clearInterval(t);
      helpers.delete(c);
    };
    c.on("error", (e) => {
      end();
      reject(e.code === "ENOENT" ? new Error("Kraken's history needs curl to download its archive") : e);
    });
    c.on("close", (code) => {
      end();
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(file)}: ${err.trim() || `curl stopped (${code})`}`));
    });
  });
}
// every file in a zip tested, without holding the importer up (a stop while testing 10 GB works at once)
function zipTest(zip) {
  return new Promise((resolve, reject) => {
    const c = spawn(ZIP.tool, ZIP.test(zip), { stdio: ["ignore", "ignore", "pipe"] });
    helpers.add(c);
    let err = "";
    c.stderr.on("data", (b) => (err += b));
    c.on("error", (e) => {
      helpers.delete(c);
      reject(zipMissing(e));
    });
    c.on("close", (code) => {
      helpers.delete(c);
      if (code === 0) resolve();
      else reject(new Error(err.trim().split(/\r?\n/).pop() || `${ZIP.tool} found a damaged file (${code})`));
    });
  });
}
function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    fs.createReadStream(file)
      .on("data", (b) => h.update(b))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}
export async function fullArchive() {
  const name = "Kraken_OHLCVT_Full.zip",
    zip = path.join(RAW, name);
  if (fs.existsSync(zip)) return false;
  fs.mkdirSync(RAW, { recursive: true });
  noteJob({ kind: "download", note: "Kraken's archive: asking Kraken for it" });
  const r = await fetch(`${FILES}/OHLCVT_Full_PARTS_SHA256SUMS.txt`, { headers: UA, signal: AbortSignal.timeout(30000) });
  if (r.status !== 200) throw new Error(`Kraken's archive: its checksums didn't come (${r.status})`);
  const parts = (await r.text())
    .split(/\r?\n/)
    .map((l) => /^([0-9a-f]{64})\s+\*?(Kraken_OHLCVT_Full\.zip\.part\d+)$/i.exec(l.trim()))
    .filter(Boolean)
    .map((m) => ({ sum: m[1].toLowerCase(), name: m[2], file: path.join(RAW, m[2]) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!parts.length) throw new Error("Kraken's archive: its checksums name no parts");
  for (const p of parts) p.size = await headSize(`${FILES}/${p.name}`);
  const total = parts.reduce((t, p) => t + p.size, 0),
    have = parts.reduce((t, p) => t + Math.min(sizeOf(p.file), p.size), 0);
  // joined whole last time and stopped while being tested: test it again rather than download it again
  const joining = `${zip}.joining`;
  if (sizeOf(joining) === total) return testAndKeep(joining, zip, name, total);
  // what's still to come, and a part's room while joining, above the floor
  diskCheck((total - have + Math.max(...parts.map((p) => p.size))) / 1e9 + 2);
  let done = 0;
  for (const [i, p] of parts.entries()) {
    const label = `Kraken's archive, part ${i + 1} of ${parts.length}`;
    if (sizeOf(p.file) > p.size) fs.rmSync(p.file);
    const tick = () => noteJob({ kind: "download", note: `${label}, ${gbs(done + sizeOf(p.file))} of ${gbs(total)} GB` });
    tick();
    if (sizeOf(p.file) < p.size) await curl(`${FILES}/${p.name}`, p.file, tick);
    noteJob({ kind: "download", note: `${label}, checking it` });
    if ((await sha256(p.file)) !== p.sum) {
      fs.rmSync(p.file);
      throw new Error(`${p.name} didn't match Kraken's checksum; it downloads again on the next try`);
    }
    done += p.size;
  }
  fs.rmSync(joining, { force: true });
  for (const [i, p] of parts.entries()) {
    noteJob({ kind: "download", note: `Kraken's archive, joining part ${i + 1} of ${parts.length}` });
    await pipeline(fs.createReadStream(p.file), fs.createWriteStream(joining, { flags: "a" }));
    fs.rmSync(p.file);
  }
  return testAndKeep(joining, zip, name, total);
}
async function testAndKeep(joining, zip, name, total) {
  noteJob({ kind: "download", note: "Kraken's archive, testing every file in it" });
  try {
    await zipTest(joining);
    if (!listing(joining).has("MANIFEST.json")) throw new Error("no MANIFEST.json, not Kraken's layout");
  } catch (e) {
    // every part matched Kraken's checksum, so the data is right and this computer's zip tool is what failed:
    // the joined file stays and is tested again next time rather than downloaded again
    throw new Error(`Kraken's archive came in whole (every part matched Kraken's checksum), but ${ZIP.tool} here couldn't read it: ${e.message}. It's tested again on the next try; to download it again instead, delete ${path.basename(joining)} from history/raw/kraken in the data folder`);
  }
  fs.renameSync(joining, zip);
  log(`${name}: ${gbs(total)} GB, every part matched Kraken's checksum and every file tested`);
  return true;
}

// Hours whose 1m bars don't add up to Kraken's own 1h bar (trade counts differ). Recent ones (90 days)
// are rebuilt from Kraken's trades; older ones are only counted (they'd be the archive's own quirks).
// Hours from `from` to `to` whose 1m trade counts don't add up to the 1h bar's.
export function mismatchedHours(db, pair, from, to) {
  const one = db.prepare("SELECT id FROM series WHERE exchange = 'KRAKEN' AND symbol = ? AND tf = 60").get(pair)?.id;
  const hour = db.prepare("SELECT id FROM series WHERE exchange = 'KRAKEN' AND symbol = ? AND tf = 3600").get(pair)?.id;
  if (!one || !hour) return null;
  return db
    .prepare(
      `SELECT h.t AS t, h.n AS want, (SELECT COALESCE(SUM(m.n), 0) FROM bars m WHERE m.series = ? AND m.t >= h.t AND m.t < h.t + 3600) AS got
       FROM bars h WHERE h.series = ? AND h.t >= ? AND h.t < ? AND h.n IS NOT NULL`,
    )
    .all(one, hour, from, to)
    .filter((r) => r.want !== r.got);
}
async function gaps(db, pairs, { days = 30 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  for (const pair of pairs) {
    try {
      await gapsPair(db, pair, now, days);
    } catch (e) {
      // one coin's trouble (Kraken busy) doesn't stop the scan of the rest
      status((s) => (pairStatus(s, pair).gaps = { at: iso(), days, error: e.message }));
      log(`${pair} gaps: ${e.message}`);
    }
  }
}
async function gapsPair(db, pair, now, days) {
  const one = db.prepare("SELECT id FROM series WHERE exchange = 'KRAKEN' AND symbol = ? AND tf = 60").get(pair)?.id;
  const from = now - days * DAY,
    to = Math.floor((now - 2 * 3600) / 3600) * 3600; // the newest hours can still be changing
  const bad = mismatchedHours(db, pair, from, to);
  if (!bad) return;
  let fixed = 0;
  // at most two days of hours a run, so a bad stretch is mended over a few days, not in one burst
  for (const r of bad.filter((x) => x.t >= now - 90 * DAY).slice(0, 48)) {
    noteJob({ kind: "repair", pair, note: `${iso(r.t).slice(0, 13).replace("T", " ")}:00` });
    const bars = tradeBars(await tradesBetween(pair, r.t, r.t + 3600));
    if (bars.reduce((a, b) => a + b.n, 0) !== r.want) continue; // Kraken's trades don't add up either: leave it
    replaceRange(db, one, sourceId(db, "kraken-trades"), r.t, r.t + 3600, bars);
    rebuildFrom1m(db, pair, [5, 15], r.t, r.t + 3600, "kraken-trades");
    fixed++;
  }
  status((s) => (pairStatus(s, pair).gaps = { at: iso(), days, hoursChecked: Math.round((to - from) / 3600), mismatched: bad.length, repaired: fixed }));
  log(`${pair} gaps: ${bad.length} of ${Math.round((to - from) / 3600)} hours off, ${fixed} repaired`);
}

// Two checks per coin: the stored 1m bars rebuilt into 15m against Kraken's own 15m (last 7 days), and a
// recent two hours rebuilt from Kraken's trades against the stored 1m. Both should be identical.
async function verify(db, pairs) {
  const eq = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
  const same = (x, y) => eq(x.o, y.o) && eq(x.h, y.h) && eq(x.l, y.l) && eq(x.c, y.c) && Math.abs(x.v - y.v) < 1e-6 && (x.n ?? 0) === (y.n ?? 0);
  const now = Math.floor(Date.now() / 1000);
  for (const pair of pairs) {
    try {
      await verifyPair(db, pair, now, same);
    } catch (e) {
      status((s) => (pairStatus(s, pair).verify = { at: iso(), ok: false, error: e.message }));
      log(`${pair} verify: ${e.message}`);
    }
  }
}
async function verifyPair(db, pair, now, same) {
  const id = (tf) => db.prepare("SELECT id FROM series WHERE exchange = 'KRAKEN' AND symbol = ? AND tf = ?").get(pair, tf)?.id;
  if (!id(60) || !id(900)) return;
  noteJob({ kind: "verify", pair });
  const until = Math.floor((now - 2 * 3600) / 900) * 900,
    since = until - 7 * DAY;
  const ones = db.prepare("SELECT t, o, h, l, c, v, n FROM bars WHERE series = ? AND t >= ? AND t < ? ORDER BY t").all(id(60), since, until);
  const built = new Map(aggregate(ones, 900, until).map((b) => [b.t, b]));
  const own = db.prepare("SELECT t, o, h, l, c, v, n FROM bars WHERE series = ? AND t >= ? AND t < ? ORDER BY t").all(id(900), since, until);
  const a = { compared: 0, identical: 0 };
  for (const k of own) {
    const b = built.get(k.t);
    if (!b) continue;
    a.compared++;
    if (same(k, b)) a.identical++;
  }
  const t0 = Math.floor((now - 3 * 3600) / 3600) * 3600;
  const fromTrades = tradeBars(await tradesBetween(pair, t0, t0 + 2 * 3600));
  const stored = new Map(
    db
      .prepare("SELECT t, o, h, l, c, v, n FROM bars WHERE series = ? AND t >= ? AND t < ? AND (v > 0 OR n > 0)")
      .all(id(60), t0, t0 + 2 * 3600)
      .map((r) => [r.t, r]),
  );
  const b = { compared: fromTrades.length, identical: fromTrades.filter((x) => stored.has(x.t) && same(stored.get(x.t), x)).length, stored: stored.size };
  const ok = a.compared > 0 && a.identical === a.compared && b.identical === b.compared && b.stored === b.compared;
  status((s) => (pairStatus(s, pair).verify = { at: iso(), ok, fifteen: a, trades: b }));
  log(`${pair} verify: 15m ${a.identical}/${a.compared}, trades ${b.identical}/${b.compared} (stored ${b.stored})${ok ? "" : " MISMATCH"}`);
}

// ---- coins in and out
async function addPair(db, pair) {
  let zips = archives();
  // a fresh store: the coin's history starts with Kraken's archive (the first download)
  if (!zips.length && (await fullArchive())) zips = archives();
  if (!zips.length) throw new Error("Kraken's archives aren't downloaded (see history/README.md)");
  // a coin listed after the Full archive's end is only in the quarters after it
  if (!zips.some((z) => listing(z).has(`${pair}_1.csv`))) throw new Error(`${pair} isn't in Kraken's archives (Kraken's own names: XBTUSD, XDGUSD)`);
  const set = settings();
  if (!set.kraken.pairs.includes(pair)) {
    set.kraken.pairs.push(pair);
    saveSettings(set);
  }
  await bulk(db, [pair], true);
  await update(db, [pair], { now: true });
}
// ---- the store gets smaller after a coin goes: SQLite keeps freed pages in the file for reuse, so it only
// shrinks when VACUUM rewrites it. That needs about twice the store free for a moment (the copy, then a
// WAL as big again) and takes a minute or so on a few GB; the app keeps reading meanwhile. Only worth it
// when a good amount was freed.
const SHRINK_MIN = 100e6;
const storeBytes = () => ["", "-wal"].reduce((t, x) => t + (fs.existsSync(DB_FILE + x) ? fs.statSync(DB_FILE + x).size : 0), 0);
const gb = (b) => `${(b / 1e9).toFixed(b < 1e10 ? 2 : 1)} GB`;
export function shrink(db, { min = SHRINK_MIN, pair } = {}) {
  const page = db.prepare("PRAGMA page_size").get().page_size,
    freed = page * db.prepare("PRAGMA freelist_count").get().freelist_count;
  if (freed < min) return null;
  const before = storeBytes();
  try {
    diskCheck((2 * before) / 1e9);
  } catch (e) {
    log(`the store keeps its size: ${e.message}`);
    return { before, skipped: e.message };
  }
  noteJob({ pair, kind: "shrink", note: `shrinking the store (${gb(before)})` });
  db.exec("VACUUM");
  // the WAL holds the rewritten store until a checkpoint copies it back; truncated, the file is the size
  db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
  const after = storeBytes();
  log(`the store went from ${gb(before)} to ${gb(after)}`);
  return { before, after };
}

// A coin out: its bars, its series and its place in the settings, then the store shrinks. Returns what
// the Crypto data page reports.
export function removePair(db, pair) {
  const ids = db.prepare("SELECT id FROM series WHERE exchange = 'KRAKEN' AND symbol = ?").all(pair).map((r) => r.id);
  db.exec("BEGIN");
  try {
    for (const id of ids) db.prepare("DELETE FROM bars WHERE series = ?").run(id);
    db.prepare("DELETE FROM series WHERE exchange = 'KRAKEN' AND symbol = ?").run(pair);
    db.prepare("DELETE FROM state WHERE k LIKE ? OR k = ?").run(`kraken:archive:%:${pair}`, `kraken:trades:${pair}`);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  const set = settings();
  set.kraken.pairs = set.kraken.pairs.filter((p) => p !== pair);
  saveSettings(set);
  status((s) => delete ((s.kraken ||= {}).pairs ||= {})[pair]);
  log(`${pair}: removed`);
  const r = shrink(db, { pair });
  if (!r) return "removed";
  return r.skipped ? `removed; the store keeps its size (${r.skipped})` : `removed; the store went from ${gb(r.before)} to ${gb(r.after)}`;
}

// ---- jobs from the Crypto data page: data/jobs/<time>-<id>.json, each taken off the queue before it runs
// (so a failing job can't loop) and its result kept in status.json
const JOBS = new Set(["update", "add", "remove", "verify", "gaps", "automatic"]);
export async function jobs(db) {
  for (;;) {
    const all = fs.existsSync(JOBS_DIR) ? fs.readdirSync(JOBS_DIR) : [];
    // anything else in the folder would keep the path unit firing: it goes
    for (const f of all.filter((f) => !/^[\w.-]+\.json$/.test(f))) fs.rmSync(path.join(JOBS_DIR, f), { recursive: true, force: true });
    const files = all.filter((f) => /^[\w.-]+\.json$/.test(f)).sort();
    if (!files.length) break;
    const file = path.join(JOBS_DIR, files[0]);
    const job = readJson(file, null);
    fs.rmSync(file, { force: true });
    // the stock history's and Binance's requests, with their own names and results
    const other = { alpaca, binance }[job?.source];
    if (other) {
      let ok = true,
        message;
      try {
        log(`${job.source} job ${job.cmd}${job.symbol || job.pair ? ` ${job.symbol || job.pair}` : ""}`);
        message = await other.job(db, job);
      } catch (e) {
        ok = false;
        message = e.message;
        log(`${job.source} job ${job.cmd}: ${e.message}`);
      }
      status((s) => ((s[job.source] ||= {}).lastJob = { cmd: job.cmd, symbol: job.symbol, pair: job.pair, at: iso(), ok, message }));
      continue;
    }
    let ok = true,
      message = "done";
    try {
      if (!job || !JOBS.has(job.cmd)) throw new Error("not a job this importer knows");
      if (["add", "remove"].includes(job.cmd) && !PAIR.test(String(job.pair || ""))) throw new Error("pairs are Kraken names like XBTUSD");
      log(`job ${job.cmd}${job.pair ? ` ${job.pair}` : ""}`);
      if (job.cmd === "update") await update(db, settings().kraken.pairs, { now: true });
      else if (job.cmd === "add") await addPair(db, job.pair);
      else if (job.cmd === "remove") message = removePair(db, job.pair);
      else if (job.cmd === "verify") await verify(db, settings().kraken.pairs);
      else if (job.cmd === "gaps") await gaps(db, settings().kraken.pairs);
      else if (job.cmd === "automatic") {
        const set = settings();
        set.kraken.automatic = !!job.on;
        saveSettings(set);
        status((s) => ((s.kraken ||= {}).automatic = set.kraken.automatic));
      }
    } catch (e) {
      ok = false;
      message = e.message;
      log(`job ${job?.cmd}: ${e.message}`);
    }
    status((s) => ((s.kraken ||= {}).lastJob = { cmd: job?.cmd, pair: job?.pair, at: iso(), ok, message }));
  }
}

function printStatus(db) {
  const rows = db.prepare("SELECT s.exchange, s.symbol, s.tf, COUNT(*) AS n, MIN(b.t) AS first, MAX(b.t) AS last FROM series s JOIN bars b ON b.series = s.id GROUP BY s.id ORDER BY s.exchange, s.symbol, s.tf").all();
  const day = (t) => iso(t).slice(0, 16).replace("T", " ");
  for (const r of rows) console.log(`${r.exchange}:${r.symbol} ${String(r.tf / 60).padStart(5)}m ${String(r.n).padStart(9)} bars  ${day(r.first)} to ${day(r.last)}`);
}

// ---- one writer at a time
const LOCK = path.join(DATA, "kraken.lock");
async function lock(wait) {
  fs.mkdirSync(DATA, { recursive: true });
  for (const started = Date.now(); ; ) {
    try {
      fs.writeFileSync(LOCK, String(process.pid), { flag: "wx" });
      break;
    } catch {
      const pid = Number(fs.readFileSync(LOCK, "utf8"));
      let alive = false;
      try {
        process.kill(pid, 0);
        alive = true;
      } catch {
        /* gone: the lock is stale */
      }
      if (!alive) {
        fs.rmSync(LOCK, { force: true });
        continue;
      }
      if (!wait || Date.now() - started > 4 * 3600e3) return false;
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
  process.on("exit", () => {
    try {
      if (fs.readFileSync(LOCK, "utf8") === String(process.pid)) fs.unlinkSync(LOCK);
    } catch {
      /* already gone */
    }
  });
  return true;
}

// ---- command line (only when run, not when the tests import the helpers above). The path compare
// works on Windows too (C:\... against file:///C:/...).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  // started by AskCharts' runner: stop with it, even if it's killed outright. A 'disconnect' listener
  // keeps the channel, and so this process, alive after the work is done, and the runner starts no new
  // run (hourly, or a Crypto data request) while this one is alive: the channel is unref'd.
  if (process.send) {
    process.on("disconnect", () => process.exit(0));
    process.channel?.unref();
  }
  // stopped outright (the runner's SIGTERM, Ctrl+C): exit properly, so a download's curl goes too
  for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => process.exit(1));
  const [cmd, ...rest] = process.argv.slice(2);
  const flags = new Set(rest.filter((x) => x.startsWith("--")));
  const named = rest.filter((x) => !x.startsWith("--"));
  if (!named.every((p) => PAIR.test(p))) throw new Error("pairs are Kraken names like XBTUSD");
  const writes = ["bulk", "update", "jobs", "add", "remove", "verify", "gaps", "quarterly"];
  if (!writes.includes(cmd) && cmd !== "status") {
    console.log("usage: node history/kraken.mjs update|jobs|add|remove|bulk|verify|gaps|quarterly|status [PAIR...] [--now] [--force]");
    process.exit(2);
  }
  // jobs from the page wait for a running import; the hourly run and the rest step aside
  if (writes.includes(cmd) && !(await lock(cmd === "jobs"))) {
    log("another import is running; this one stops");
    process.exit(0);
  }
  const db = openDb();
  const chosen = named.length ? named : settings().kraken.pairs;
  try {
    if (writes.includes(cmd)) status((s) => (s.schema = SCHEMA));
    if (cmd === "bulk") await bulk(db, chosen, flags.has("--force"));
    else if (cmd === "update") {
      await update(db, chosen, { now: flags.has("--now") });
      // the stock history and Binance's too, each on its own Automatic (nothing to do while it's off)
      if (!named.length)
        for (const [name, other] of [["stocks", alpaca], ["Binance", binance]])
          await other.update(db, { now: flags.has("--now") }).catch((e) => {
            log(`${name}: ${e.message}`);
            process.exitCode = 1;
          });
    }
    else if (cmd === "jobs") await jobs(db);
    else if (cmd === "add") await addPair(db, named[0]);
    else if (cmd === "remove") removePair(db, named[0]);
    else if (cmd === "verify") await verify(db, chosen);
    else if (cmd === "gaps") await gaps(db, chosen);
    else if (cmd === "quarterly") await quarterly(db, chosen);
    else printStatus(db);
    if (writes.includes(cmd)) diskCheck();
  } finally {
    if (writes.includes(cmd)) noteJob(null);
    db.close();
  }
}
