// The bar store: one SQLite file of OHLCV bars, one row per series and bar open time (UTC seconds),
// each bar tagged with the source it came from. The importers in this folder are its only writers;
// the app opens it read only (quant-terminal/lib/history.js) and reads status.json beside it.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DATA = process.env.HISTORY_DATA || path.join(HERE, "data");
export const DB_FILE = path.join(DATA, "bars.sqlite");
export const STATUS_FILE = path.join(DATA, "status.json");
export const SETTINGS_FILE = path.join(DATA, "settings.json");
export const JOBS_DIR = path.join(DATA, "jobs");

// The store's layout, by version (PRAGMA user_version). A new version adds a step here; a store that's
// behind is brought up to date when it's opened, so it never needs a rebuild for a change of layout.
const MIGRATIONS = [
  // 1: series, sources, bars, state
  `CREATE TABLE IF NOT EXISTS series (
      id INTEGER PRIMARY KEY,
      exchange TEXT NOT NULL,       -- KRAKEN, BINANCE, ...
      symbol TEXT NOT NULL,         -- the exchange's own name for the pair (XBTUSD, XRPUSD)
      tf INTEGER NOT NULL,          -- bar length in seconds
      UNIQUE (exchange, symbol, tf)
    );
    CREATE TABLE IF NOT EXISTS sources (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS bars (
      series INTEGER NOT NULL,
      t INTEGER NOT NULL,           -- bar open time, UTC seconds
      o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL,
      v REAL NOT NULL,
      n INTEGER,                    -- trades in the bar, when the source says
      src INTEGER NOT NULL,         -- sources.id
      PRIMARY KEY (series, t)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS state (k TEXT PRIMARY KEY, v TEXT NOT NULL);`,
  // 2: no bars for minutes without trades. Kraken's OHLC endpoint fills them with flat, zero-volume
  // bars; its archives and its trades have none (nor TradingView's charts), so they go.
  `DELETE FROM bars WHERE v = 0 AND (n IS NULL OR n = 0) AND src = (SELECT id FROM sources WHERE name = 'kraken-ohlc');`,
];
export const SCHEMA = MIGRATIONS.length;

export function openDb(file = DB_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  let at = db.prepare("PRAGMA user_version").get().user_version;
  // a store made before versions were kept has the version 1 tables already
  if (at === 0 && db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'bars'").get()) {
    db.exec("PRAGMA user_version = 1");
    at = 1;
  }
  for (let v = at; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return db;
}

export function seriesId(db, exchange, symbol, tf) {
  db.prepare("INSERT OR IGNORE INTO series (exchange, symbol, tf) VALUES (?, ?, ?)").run(exchange, symbol, tf);
  return db.prepare("SELECT id FROM series WHERE exchange = ? AND symbol = ? AND tf = ?").get(exchange, symbol, tf).id;
}

export function sourceId(db, name) {
  db.prepare("INSERT OR IGNORE INTO sources (name) VALUES (?)").run(name);
  return db.prepare("SELECT id FROM sources WHERE name = ?").get(name).id;
}

// Bars in, replacing any with the same series and time (a later source corrects an earlier one).
export function upsertBars(db, series, src, rows) {
  if (!rows.length) return 0;
  const put = db.prepare(
    "INSERT INTO bars (series, t, o, h, l, c, v, n, src) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (series, t) DO UPDATE SET o = excluded.o, h = excluded.h, l = excluded.l, c = excluded.c, v = excluded.v, n = excluded.n, src = excluded.src",
  );
  db.exec("BEGIN");
  try {
    for (const r of rows) put.run(series, r.t, r.o, r.h, r.l, r.c, r.v, r.n ?? null, src);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return rows.length;
}

// A stretch's bars replaced outright: an interval with no trades has no bar, so stale ones must go.
export function replaceRange(db, series, src, from, to, rows) {
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM bars WHERE series = ? AND t >= ? AND t < ?").run(series, from, to);
    const put = db.prepare("INSERT INTO bars (series, t, o, h, l, c, v, n, src) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const r of rows) put.run(series, r.t, r.o, r.h, r.l, r.c, r.v, r.n ?? null, src);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export const lastTime = (db, series) => db.prepare("SELECT MAX(t) AS t FROM bars WHERE series = ?").get(series)?.t ?? null;
export const getState = (db, k) => db.prepare("SELECT v FROM state WHERE k = ?").get(k)?.v ?? null;
export const setState = (db, k, v) => db.prepare("INSERT INTO state (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v").run(k, String(v));

// Finer bars into coarser ones on UTC boundaries: first open, highest high, lowest low, last close,
// summed volume and trades. Only buckets that end at or before `upTo` (complete ones) come out. A flat
// zero-volume bar (Kraken's filler for a minute without trades) adds nothing: its price is the last
// close, not a trade in the bucket.
export function aggregate(rows, tf, upTo = Infinity) {
  const out = [];
  let cur = null;
  for (const r of rows) {
    if (!r.v && !r.n) continue;
    const t = Math.floor(r.t / tf) * tf;
    if (!cur || cur.t !== t) {
      if (cur) out.push(cur);
      cur = { t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v, n: r.n ?? 0 };
    } else {
      cur.h = Math.max(cur.h, r.h);
      cur.l = Math.min(cur.l, r.l);
      cur.c = r.c;
      cur.v += r.v;
      cur.n += r.n ?? 0;
    }
  }
  if (cur) out.push(cur);
  return out.filter((b) => b.t + tf <= upTo);
}

// JSON written whole or not at all (a reader never sees half a file).
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 1)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
