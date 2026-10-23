// The XRP Ledger store: one SQLite file, one row per validated ledger, plus the big payments one by one.
// The collector (xrpl.mjs) is its only writer; the app opens it read only (quant-terminal/lib/onchain.js).
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { place, windowOf, DEX_COLS } from "./xrpl-ledger.mjs";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DATA = process.env.ONCHAIN_DATA || path.join(HERE, "data");
export const DB_FILE = path.join(DATA, "xrpl.sqlite");
export const STATUS_FILE = path.join(DATA, "xrpl-status.json");

// The store's layout, by version (PRAGMA user_version), as in history/db.mjs.
const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS ledgers (
      idx INTEGER PRIMARY KEY,      -- ledger index
      close INTEGER NOT NULL,       -- the ledger's close time, UTC seconds, as the network rounded it
      res INTEGER NOT NULL,         -- that rounding, seconds (10 normally)
      t INTEGER NOT NULL,           -- where it goes on a chart: spread evenly within its rounded window
      seen INTEGER,                 -- when the collector saw it validated, UTC seconds (null: filled in later)
      txs INTEGER NOT NULL,         -- every transaction, Batch wrappers included
      failed INTEGER NOT NULL,      -- applied with a tec result: fee taken, nothing done (wrappers apart)
      batch INTEGER NOT NULL,       -- Batch wrappers (their applied inner transactions count by type)
      money INTEGER NOT NULL,       -- successful, by family
      markets INTEGER NOT NULL,
      nfts INTEGER NOT NULL,
      accounts INTEGER NOT NULL,
      other INTEGER NOT NULL,
      xrp REAL NOT NULL,            -- XRP delivered by successful Payments between two different accounts
      pays INTEGER NOT NULL,        -- how many of those Payments
      ex_in REAL NOT NULL,          -- of that XRP: into known exchange wallets from outside them
      ex_out REAL NOT NULL,         -- out of known exchange wallets to outside them
      fees INTEGER NOT NULL,        -- fees burned, drops
      created INTEGER NOT NULL      -- new accounts
    );
    CREATE INDEX IF NOT EXISTS ledgers_t ON ledgers (t);
    CREATE INDEX IF NOT EXISTS ledgers_close ON ledgers (close);
    CREATE TABLE IF NOT EXISTS whales (
      hash TEXT PRIMARY KEY,
      idx INTEGER NOT NULL,         -- ledgers.idx
      src TEXT NOT NULL,
      dst TEXT NOT NULL,
      tag INTEGER,                  -- destination tag (an exchange's customer, usually)
      xrp REAL NOT NULL,
      src_name TEXT,                -- known exchange wallets, by name (relabel applies a newer list)
      dst_name TEXT
    );
    CREATE INDEX IF NOT EXISTS whales_idx ON whales (idx);
    CREATE TABLE IF NOT EXISTS state (k TEXT PRIMARY KEY, v TEXT NOT NULL);`,
  // 2: trading on the ledger's own exchange (.project/xrpl-dex.md; xrpl-ledger.mjs counts it). NULL on the rows
  // stored before: not counted, which isn't the same as no trading.
  `ALTER TABLE ledgers ADD COLUMN dex_got REAL;     -- XRP takers received from offers and pools
    ALTER TABLE ledgers ADD COLUMN dex_paid REAL;   -- XRP takers paid to them
    ALTER TABLE ledgers ADD COLUMN amm_got REAL;    -- of those, through AMM pools
    ALTER TABLE ledgers ADD COLUMN amm_paid REAL;
    ALTER TABLE ledgers ADD COLUMN dex_bridge REAL; -- XRP that only bridged two tokens
    ALTER TABLE ledgers ADD COLUMN dex_fills INTEGER; -- offers filled
    ALTER TABLE ledgers ADD COLUMN amm_swaps INTEGER; -- transactions that swapped with a pool
    -- where counting began, at once (the app asks): the rows that are counted, by place on the chart
    CREATE INDEX IF NOT EXISTS ledgers_dex_t ON ledgers (t) WHERE dex_got IS NOT NULL;`,
];
export const SCHEMA = MIGRATIONS.length;
const COLS = ["idx", "close", "res", "t", "seen", "txs", "failed", "batch", "money", "markets", "nfts", "accounts", "other", "xrp", "pays", "ex_in", "ex_out", "fees", "created", ...DEX_COLS];

export function openDb(file = DB_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  const at = db.prepare("PRAGMA user_version").get().user_version;
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

// One ledger in (again, if it's there already), then its rounded window's ledgers placed afresh, since
// a new neighbour in the window moves them all.
export function saveLedger(db, { row, whales }) {
  const ins = db.prepare(`INSERT OR REPLACE INTO ledgers (${COLS.join(", ")}) VALUES (${COLS.map(() => "?").join(", ")})`);
  const insW = db.prepare("INSERT OR REPLACE INTO whales (hash, idx, src, dst, tag, xrp, src_name, dst_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  db.exec("BEGIN");
  try {
    const keepSeen = row.seen ?? db.prepare("SELECT seen FROM ledgers WHERE idx = ?").get(row.idx)?.seen ?? null;
    // a row without the DEX columns (summed before they existed) leaves them NULL; the rest are NOT NULL
    ins.run(...COLS.map((c) => (c === "t" ? row.close : c === "seen" ? keepSeen : (row[c] ?? null))));
    for (const w of whales) insW.run(w.hash, w.idx, w.src, w.dst, w.tag, w.xrp, w.src_name, w.dst_name);
    replace(db, windowOf(row), row.res);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function replace(db, b, res) {
  const rows = db.prepare("SELECT idx, close, res FROM ledgers WHERE close >= ? AND close < ? ORDER BY idx").all(b, b + res);
  const ts = place(rows.filter((r) => windowOf(r) === b));
  const upd = db.prepare("UPDATE ledgers SET t = ? WHERE idx = ?");
  rows.filter((r) => windowOf(r) === b).forEach((r, k) => upd.run(ts[k], r.idx));
}

// Shared history: a published chunk's rows (xrpl-history.mjs decodeChunk) in without overwriting, so the
// store's own rows win. The 10 second windows that got new rows are placed again, which comes out exactly as
// on the publishing machine. Big payments come in with their ledgers only. Returns the runs of ledgers that
// went in ([first, last] each), so a revoked chunk's rows can be taken out again.
export function importChunk(db, ledgers, whales) {
  const ins = db.prepare(`INSERT OR IGNORE INTO ledgers (${COLS.join(", ")}) VALUES (${COLS.map(() => "?").join(", ")})`);
  const insW = db.prepare("INSERT OR IGNORE INTO whales (hash, idx, src, dst, tag, xrp, src_name, dst_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const runs = [],
    windows = new Map();
  db.exec("BEGIN");
  try {
    for (const r of ledgers) {
      // a row without the DEX columns (the shared history's first format) leaves them NULL: not counted
      if (!ins.run(...COLS.map((c) => (c === "t" ? r.close : c === "seen" ? null : (r[c] ?? null)))).changes) continue;
      const run = runs.at(-1);
      if (run && run[1] === r.idx - 1) run[1] = r.idx;
      else runs.push([r.idx, r.idx]);
      windows.set(windowOf(r), r.res);
    }
    for (const w of whales) if (runs.some(([a, b]) => w.idx >= a && w.idx <= b)) insW.run(w.hash, w.idx, w.src, w.dst, w.tag, w.xrp, w.src_name, w.dst_name);
    for (const [b, res] of windows) replace(db, b, res);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return runs;
}

// Shared history format 2: DEX numbers into rows this store already has but didn't count (the collector was
// older, or the row came from format 1), never over numbers it has. Returns the runs filled ([first, last]), so a
// revoked chunk's numbers can be taken out again.
export function fillDex(db, ledgers) {
  const set = DEX_COLS.map((c) => `${c} = ?`).join(", ");
  const upd = db.prepare(`UPDATE ledgers SET ${set} WHERE idx = ? AND dex_got IS NULL`);
  const runs = [];
  db.exec("BEGIN");
  try {
    for (const r of ledgers) {
      if (r.dex_got == null || !upd.run(...DEX_COLS.map((c) => r[c]), r.idx).changes) continue;
      const run = runs.at(-1);
      if (run && run[1] === r.idx - 1) run[1] = r.idx;
      else runs.push([r.idx, r.idx]);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return runs;
}

// A revoked chunk's DEX numbers out of the rows it filled (first to last): back to not counted.
export function clearDex(db, first, last) {
  return db.prepare(`UPDATE ledgers SET ${DEX_COLS.map((c) => `${c} = NULL`).join(", ")} WHERE idx BETWEEN ? AND ?`).run(first, last).changes;
}

// Ledgers first to last (inclusive) out, with their big payments: a revoked chunk's imported rows.
export function dropLedgers(db, first, last) {
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM whales WHERE idx BETWEEN ? AND ?").run(first, last);
    const n = Number(db.prepare("DELETE FROM ledgers WHERE idx BETWEEN ? AND ?").run(first, last).changes);
    db.exec("COMMIT");
    return n;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// Small values the collector keeps between runs (the state table).
export const getState = (db, k) => db.prepare("SELECT v FROM state WHERE k = ?").get(k)?.v ?? null;
export const setState = (db, k, v) => db.prepare("INSERT OR REPLACE INTO state (k, v) VALUES (?, ?)").run(k, v);

// Indexes missing between lo and hi (inclusive), newest first, at most `limit`.
export function missing(db, lo, hi, limit = 1000) {
  const out = [];
  if (hi < lo) return out;
  // the stored ledgers in the span, newest first; every hole between neighbours is missing
  const have = db.prepare("SELECT idx FROM ledgers WHERE idx BETWEEN ? AND ? ORDER BY idx DESC").iterate(lo, hi);
  let above = hi + 1;
  for (const { idx } of have) {
    for (let i = above - 1; i > idx && out.length < limit; i--) out.push(i);
    if (out.length >= limit) return out;
    above = idx;
  }
  for (let i = above - 1; i >= lo && out.length < limit; i--) out.push(i);
  return out;
}

export function span(db) {
  const r = db.prepare("SELECT MIN(idx) AS first, MAX(idx) AS last, COUNT(*) AS n, MIN(t) AS t0, MAX(t) AS t1 FROM ledgers").get();
  return { first: r.first, last: r.last, count: r.n, from: r.t0, to: r.t1 };
}

// Older than `days`, gone (the whales with them).
export function prune(db, days, now = Date.now() / 1000) {
  const cut = Math.floor(now - days * 86400);
  const top = db.prepare("SELECT MAX(idx) AS i FROM ledgers WHERE close < ?").get(cut)?.i;
  if (top == null) return 0;
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM whales WHERE idx <= ?").run(top);
    const n = db.prepare("DELETE FROM ledgers WHERE idx <= ?").run(top).changes;
    db.exec("COMMIT");
    return Number(n);
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// The exchange names on stored big payments, from the list in xrpl-ledger.mjs (after it changes).
export function relabel(db, exchanges) {
  const upd = db.prepare("UPDATE whales SET src_name = ?, dst_name = ? WHERE hash = ?");
  let n = 0;
  db.exec("BEGIN");
  for (const w of db.prepare("SELECT hash, src, dst FROM whales").all()) n += Number(upd.run(exchanges[w.src] || null, exchanges[w.dst] || null, w.hash).changes);
  db.exec("COMMIT");
  return n;
}

// status.json: written whole, then renamed over the old one.
export function writeStatus(s, file = STATUS_FILE) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
