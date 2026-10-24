// Binance history for the bar store: a coin's spot bars from its first month on Binance, the same bars Binance's
// own charts and API give (minutes without trades included, as its live charts show them). The past comes from
// Binance's bulk files (data.binance.vision: a zip a month, then a zip a day for this month, each with its
// SHA-256 beside it), today from its market-data API. Binance's own 1m, 5m, 15m, 30m, 1h, 4h and 1d bars are
// stored; the app builds the rest from them as it does for live charts. Since 1 January 2025 the files give
// times in microseconds, before that in milliseconds.
//
// Run by history/kraken.mjs (the runner's hourly update and the Crypto data page's jobs), under its lock: one
// writer at a time. The files are small (a few MB a month), so each is read in memory with Node's own zlib:
// no unzip needed. Binance's main API refuses some countries (451); its market-data host doesn't.
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { seriesId, sourceId, upsertBars, lastTime, writeJson, readJson, STATUS_FILE, SETTINGS_FILE } from "./db.mjs";

const FILES = (process.env.BINANCE_FILES || "https://data.binance.vision").replace(/\/+$/, "");
const API = (process.env.BINANCE_API || "https://data-api.binance.vision").replace(/\/+$/, "");
export const PAIR = /^[A-Z0-9]{2,20}$/;
// Binance's interval names and their seconds: what's stored
export const TFS = { "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86400 };
const DAY = 86400;
// files fetched ahead while one is stored
const AHEAD = Number(process.env.BINANCE_AHEAD || 6);
const iso = (t) => new Date(t * 1000).toISOString();
const log = (...a) => console.log(new Date().toISOString().slice(0, 19), ...a);

// ---- settings and status (beside Kraken's in the same files)
export function settings() {
  const s = readJson(SETTINGS_FILE, {});
  return { pairs: [], automatic: false, ...(s.binance || {}) };
}
function saveSettings(b) {
  const s = readJson(SETTINGS_FILE, {});
  s.binance = b;
  writeJson(SETTINGS_FILE, s);
}
function status(update) {
  const s = readJson(STATUS_FILE, {});
  update((s.binance ||= {}));
  s.updatedAt = iso(Date.now() / 1000);
  writeJson(STATUS_FILE, s);
}
const note = (job) => status((b) => (b.job = job ? { ...job, pid: process.pid, at: iso(Date.now() / 1000) } : null));

// ---- a zip of one CSV, read in memory: the central directory says where its one file is and how it's packed
export function unzipOne(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("not a zip file");
  const cd = buf.readUInt32LE(end + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error("a zip without its directory");
  const method = buf.readUInt16LE(cd + 10),
    size = buf.readUInt32LE(cd + 20),
    local = buf.readUInt32LE(cd + 42);
  if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error("a damaged zip");
  const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
  const data = buf.subarray(start, start + size);
  if (method === 0) return data;
  if (method === 8) return inflateRawSync(data);
  throw new Error(`a zip packed in a way this can't read (${method})`);
}
// Binance's times: milliseconds before 2025, microseconds since
export const seconds = (t) => Math.floor(Number(t) / (Number(t) > 1e14 ? 1e6 : 1e3));
export function parseRows(csv) {
  const out = [];
  for (const line of String(csv).split(/\r?\n/)) {
    const f = line.split(",");
    if (f.length < 9 || !/^\d+$/.test(f[0])) continue; // a header line, or the end
    const r = { t: seconds(f[0]), o: +f[1], h: +f[2], l: +f[3], c: +f[4], v: +f[5], n: Number(f[8]) };
    if ([r.o, r.h, r.l, r.c, r.v].every(Number.isFinite)) out.push(r);
  }
  return out;
}

async function get(url, kind = "json") {
  for (let tries = 0; ; tries++) {
    let r;
    try {
      r = await fetch(url, { signal: AbortSignal.timeout(60000) });
    } catch (e) {
      if (tries < 3) continue;
      throw new Error(`Couldn't reach Binance: ${e.message}`);
    }
    if (r.status === 404) return null;
    if ((r.status === 429 || r.status === 418 || r.status >= 500) && tries < 3) {
      await new Promise((ok) => setTimeout(ok, (Number(r.headers.get("retry-after")) || 10) * 1000));
      continue;
    }
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      throw new Error(`Binance said ${r.status}${/"msg"/.test(body) ? `: ${JSON.parse(body).msg}` : ""}`);
    }
    return kind === "json" ? r.json() : Buffer.from(await r.arrayBuffer());
  }
}

// One bulk file's bars, checked against its SHA-256 first; null when Binance has no such file (yet).
async function fileBars(path) {
  const [zip, sums] = await Promise.all([get(`${FILES}/${path}`, "buffer"), get(`${FILES}/${path}.CHECKSUM`, "buffer")]);
  if (!zip) return null;
  const want = String(sums || "").trim().split(/\s+/)[0];
  const got = createHash("sha256").update(zip).digest("hex");
  if (want !== got) throw new Error(`${path.split("/").pop()} doesn't match Binance's checksum`);
  return parseRows(unzipOne(zip));
}

// The month a pair's trading began (Binance's first monthly bar).
// A pair Binance doesn't list (never did, like XDCUSDT, or not any more): a plain reason, marked so it isn't
// counted as a failed update.
const notListed = (pair) => Object.assign(new Error(`Binance doesn't list ${pair}`), { notListed: true });
const listed = async (pair, work) => {
  try {
    return await work();
  } catch (e) {
    throw /invalid symbol/i.test(e.message) ? notListed(pair) : e;
  }
};
export async function firstMonth(pair) {
  const rows = await listed(pair, () => get(`${API}/api/v3/klines?symbol=${pair}&interval=1M&startTime=0&limit=1`));
  if (!rows?.length) throw notListed(pair);
  return seconds(rows[0][0]);
}
const monthStart = (t) => {
  const d = new Date(t * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
};
const nextMonth = (t) => {
  const d = new Date(t * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
};
const ym = (t) => iso(t).slice(0, 7);
const ymd = (t) => iso(t).slice(0, 10);

// One interval of one pair, from `from` to now: whole months from the monthly files, this month's days from
// the daily ones, then today (and any day not filed yet) from the API, finished bars only.
async function fill(db, pair, name, from, now, srcFiles, srcApi) {
  const tf = TFS[name],
    series = seriesId(db, "BINANCE", pair, tf);
  let t = from,
    n = 0;
  const thisMonth = monthStart(now),
    today = Math.floor(now / DAY) * DAY;
  // the files a few at a time (the waiting is the download, not the store), stored in order. False when one
  // isn't filed (yet), with `t` at its start, so what follows comes another way.
  const files = async (starts, file, next) => {
    const fetchOne = (start) => {
      const p = fileBars(file(start));
      p.catch(() => {}); // a failure is thrown where it's awaited, in order
      return p;
    };
    const busy = starts.slice(0, AHEAD).map(fetchOne);
    for (let k = 0; k < starts.length; k++) {
      if (k + AHEAD < starts.length) busy.push(fetchOne(starts[k + AHEAD]));
      const rows = await busy[k];
      if (!rows) return false;
      n += upsertBars(db, series, srcFiles, rows.filter((r) => r.t >= t));
      t = next(starts[k]);
    }
    return true;
  };
  const months = [];
  for (let m = t; m < thisMonth; m = nextMonth(m)) months.push(m);
  // last month's file comes out in the month's first days: its days are filed, and they cover it
  await files(months, (m) => `data/spot/monthly/klines/${pair}/${name}/${pair}-${name}-${ym(m)}.zip`, nextMonth);
  const days = [];
  for (let d = t; d < today; d = Math.floor(d / DAY) * DAY + DAY) days.push(d);
  // a day not filed yet comes from the API
  await files(days, (d) => `data/spot/daily/klines/${pair}/${name}/${pair}-${name}-${ymd(d)}.zip`, (d) => Math.floor(d / DAY) * DAY + DAY);
  // the API: 1000 bars a call, finished bars only (a bar still forming comes next time)
  for (;;) {
    const rows = await get(`${API}/api/v3/klines?symbol=${pair}&interval=${name}&startTime=${t * 1000}&limit=1000`);
    const done = (rows || []).filter((k) => seconds(k[6]) < now).map((k) => ({ t: seconds(k[0]), o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], n: Number(k[8]) }));
    if (!done.length) break;
    n += upsertBars(db, series, srcApi, done);
    t = done.at(-1).t + tf;
    if (rows.length < 1000) break;
  }
  return n;
}

// One pair, each interval from its last stored bar (or the pair's first month).
export async function updatePair(db, pair, now = Date.now() / 1000) {
  const srcFiles = sourceId(db, "binance-files"),
    srcApi = sourceId(db, "binance-api");
  let first = null,
    minutes = 0;
  for (const name of Object.keys(TFS)) {
    const last = lastTime(db, seriesId(db, "BINANCE", pair, TFS[name]));
    const from = last != null ? last + TFS[name] : (first ??= await firstMonth(pair));
    if (name === "1m" && last == null) note({ kind: "binance", pair, note: `${pair} from ${ym(from)}` });
    const n = await listed(pair, () => fill(db, pair, name, from, Math.floor(now), srcFiles, srcApi));
    if (name === "1m") minutes = n;
  }
  const span = db.prepare("SELECT MIN(t) AS first, MAX(t) AS last, COUNT(*) AS n FROM bars WHERE series = ?").get(seriesId(db, "BINANCE", pair, 60));
  status((b) => ((b.pairs ||= {})[pair] = { first: span.first, last: span.last, bars: span.n, lastOk: iso(now) }));
  return minutes;
}

// The hourly update (or Update now): every pair in the list, one at a time.
export async function update(db, { now: forced = false } = {}) {
  const set = settings();
  if ((!set.automatic && !forced) || !set.pairs.length) return;
  const errors = [];
  for (const pair of set.pairs) {
    try {
      const n = await updatePair(db, pair);
      log(`${pair}: ${n} new minutes from Binance`);
    } catch (e) {
      // one Binance doesn't list (or stopped listing: its stored bars stay) says so; it isn't a failed update
      const kept = e.notListed && db.prepare("SELECT 1 FROM bars b JOIN series s ON s.id = b.series WHERE s.exchange = 'BINANCE' AND s.symbol = ? LIMIT 1").get(pair);
      const message = !e.notListed ? e.message : kept ? `${e.message} any more; its stored bars stay. Remove it to take it off the list.` : `${e.message}. Remove it to take it off the list.`;
      if (!e.notListed) errors.push(`${pair}: ${e.message}`);
      status((b) => (((b.pairs ||= {})[pair] ||= {}).error = { at: iso(Date.now() / 1000), message }));
    }
  }
  note(null);
  status((b) => {
    b.automatic = set.automatic;
    if (errors.length) {
      b.failures = (b.failures || 0) + 1;
      b.lastError = { at: iso(Date.now() / 1000), message: errors.join("; ") };
    } else {
      b.failures = 0;
      b.lastOk = iso(Date.now() / 1000);
    }
  });
  if (errors.length) throw new Error(errors.join("; "));
}

function forget(db, pair) {
  for (const { id } of db.prepare("SELECT id FROM series WHERE exchange = 'BINANCE' AND symbol = ?").all(pair)) db.prepare("DELETE FROM bars WHERE series = ?").run(id);
}

// A request from the Crypto data page (history/data/jobs, source "binance"); its words for the page.
export async function job(db, j) {
  const set = settings();
  const pairs = (list) => {
    const out = [...new Set((Array.isArray(list) ? list : [list]).map((x) => String(x || "").toUpperCase().trim()))];
    if (!out.length || !out.every((p) => PAIR.test(p))) throw new Error("pairs are Binance names like BTCUSDT");
    return out;
  };
  if (j.cmd === "start") {
    // each pair asked about first: one Binance doesn't list (a Kraken coin like XDC) is left out, and said
    const keep = [],
      out = [];
    for (const p of pairs(j.pairs))
      try {
        await firstMonth(p);
        keep.push(p);
      } catch (e) {
        if (!e.notListed) throw e;
        out.push(p);
      }
    status((b) => (b.notListed = out));
    if (!keep.length) throw new Error(`Binance doesn't list ${out.join(", ")}`);
    saveSettings({ ...set, pairs: keep, automatic: true });
    await update(db, { now: true });
    return out.length ? `downloaded; Binance doesn't list ${out.join(", ")}, so it's left out` : "downloaded";
  }
  if (j.cmd === "add") {
    const [pair] = pairs(j.pair);
    await firstMonth(pair); // a pair Binance doesn't have is refused before it goes on the list
    if (!set.pairs.includes(pair)) saveSettings({ ...set, pairs: [...set.pairs, pair] });
    await updatePair(db, pair);
    note(null);
    return `added ${pair}`;
  }
  if (j.cmd === "remove") {
    const [pair] = pairs(j.pair);
    saveSettings({ ...set, pairs: set.pairs.filter((p) => p !== pair) });
    forget(db, pair);
    status((b) => delete (b.pairs ||= {})[pair]);
    return `removed ${pair}`;
  }
  if (j.cmd === "update") {
    await update(db, { now: true });
    return "updated";
  }
  if (j.cmd === "automatic") {
    saveSettings({ ...set, automatic: !!j.on });
    status((b) => (b.automatic = !!j.on));
    return j.on ? "automatic on" : "automatic off";
  }
  throw new Error("not a job the Binance history knows");
}
