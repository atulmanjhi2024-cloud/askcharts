// XRPL On chain: the XRP Ledger store kept by onchain/ at the repo root (a row per validated ledger:
// transactions by family, Batch wrappers, failed ones, XRP moved, exchange flows, fees, new accounts,
// and the big payments). Only onchain/xrpl.mjs writes it; here it's opened read only and summed into
// buckets for the On chain indicators. Override the file with QT_ONCHAIN.
import { DatabaseSync } from "node:sqlite";
import fs, { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = process.env.QT_ONCHAIN || path.join(ROOT, "..", "onchain", "data", "xrpl.sqlite");
const STATUS = path.join(path.dirname(FILE), "xrpl-status.json");
// On or off, and which server (Settings, Market data): AskCharts' runner reads it and starts or stops
// the collector (onchain/xrpl.mjs).
const SETTINGS = path.join(path.dirname(FILE), "settings.json");
// Ripple's public server: xrplcluster.com's free allowance is less than a ledger with its transactions every
// few seconds, so following every ledger there falls behind
export const DEFAULT_SERVER = "wss://s1.ripple.com";
// the default before 0.1.16, which turning XRPL on wrote into the settings: read as no choice made
const OLD_DEFAULT = "wss://xrplcluster.com";
const serverOf = (s) => (s.server && s.server !== OLD_DEFAULT ? s.server : DEFAULT_SERVER);
// The columns summed per bucket, in the order each bucket's list carries them (after its start time
// and its number of ledgers), then the bucket's last ledger (its highest index).
export const XRPL_COLS = ["txs", "failed", "batch", "money", "markets", "nfts", "accounts", "other", "xrp", "pays", "ex_in", "ex_out", "fees", "created"];
// Trading on the ledger's own exchange (store layout 2, .project/xrpl-dex.md), summed the same way, then how
// many of the bucket's ledgers were counted (dex_n): rows stored before counting began are NULL and add
// nothing, so a bucket is counted, partly counted or not at all. A store without the columns yet (the
// collector hasn't run a version that adds them) reads NULL and 0.
export const DEX_COLS = ["dex_got", "dex_paid", "amm_got", "amm_paid", "dex_bridge", "dex_fills", "amm_swaps"];
// Then the first (lowest): ledger indexes run without breaks, so a jump between buckets is an outage.
const COLS_OUT = [...XRPL_COLS, ...DEX_COLS, "dex_n", "last", "first"];
const MAX_BUCKETS = 50000;
const MAX_WHALES = 3000;
const NO_DATA = "No XRP Ledger data yet. The XRPL collector (onchain/ in the AskCharts folder) fills it in.";

let db = null,
  openedAt = 0;
function store() {
  // a store that appears later (the collector's first run) is picked up within a minute
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

// Whether the store has the DEX columns, and the place of its first counted ledger (an index makes that
// instant), looked at again once a minute: the collector adds the columns when it updates.
let dex = null,
  dexAt = 0;
function dexOf(d) {
  if (dex && Date.now() - dexAt < 60000) return dex;
  dexAt = Date.now();
  const has = d.prepare("PRAGMA table_info(ledgers)").all().some((c) => c.name === "dex_got");
  dex = { has, first: has ? (d.prepare("SELECT MIN(t) AS t FROM ledgers WHERE dex_got IS NOT NULL").get().t ?? null) : null };
  return dex;
}

const bad = (message) => Object.assign(new Error(message), { status: 400 });
const int = (v, name) => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw bad(`${name} must be a whole number`);
  return n;
};

// The collector's own word (connected, how far behind, what's left to fill in, how many days it keeps, and
// the shared history it filled in from), when it has written one.
function collector() {
  try {
    const s = JSON.parse(fs.readFileSync(STATUS, "utf8"));
    const h = s.history;
    return {
      // the server it's on (its host), and why it last failed: the page says it in plain words
      server: s.server || null,
      connected: !!s.connected,
      connectedAt: s.connectedAt || null,
      lastError: s.lastError || null,
      lastErrorAt: s.lastErrorAt || null,
      limited: s.limited?.until ? { until: s.limited.until, message: s.limited.message || "" } : null,
      behind: s.behind ?? null,
      toFill: s.toFill ?? null,
      updated: s.updated || null,
      keepDays: s.settings?.keepDays ?? null,
      history: h ? { from: h.from || null, newest: h.newest ?? null, syncedAt: h.syncedAt || null, error: h.error || null } : null,
    };
  } catch {
    return null;
  }
}

// Ledgers from `from` to `to` (UTC seconds, by their place on the chart) summed in buckets of `step`
// seconds, and the big payments of `min` XRP and up. A bucket: [start, ledgers, ...XRPL_COLS].
export function xrpl(q = {}) {
  const from = int(q.from, "from"),
    to = int(q.to, "to"),
    step = int(q.step ?? 60, "step"),
    min = Number(q.min ?? 1000000);
  if (step < 1 || step > 86400) throw bad("step is 1 to 86400 seconds");
  if (to <= from) throw bad("to must be after from");
  const d = store();
  const base = { cols: COLS_OUT, step, collector: collector() };
  if (!d) return { ...base, buckets: [], whales: [], first: null, last: null, reason: NO_DATA };
  const span = d.prepare("SELECT MIN(t) AS first, MAX(t) AS last FROM ledgers").get();
  if (span.first == null) return { ...base, buckets: [], whales: [], first: null, last: null, reason: NO_DATA };
  const lo = Math.max(from, span.first - (span.first % step)),
    hi = Math.min(to, span.last + 1);
  if ((hi - lo) / step > MAX_BUCKETS) throw bad(`Too many buckets: pick a step of at least ${Math.ceil((hi - lo) / MAX_BUCKETS)} seconds`);
  const dx = dexOf(d);
  // every column named: a bare NULL or 0 would come back under that name, and a key like "0" sorts first
  const sums = [...XRPL_COLS.map((c) => `SUM(${c}) AS ${c}`), ...DEX_COLS.map((c) => (dx.has ? `SUM(${c})` : "NULL") + ` AS ${c}`), `${dx.has ? "COUNT(dex_got)" : "0"} AS dex_n`].join(", ");
  // SQLite's % works on whole numbers, so the bucket's start is whole however the step is bound
  const buckets = hi > lo ? d.prepare(`SELECT t - (t % ?) AS b, COUNT(*) AS n, ${sums}, MAX(idx) AS last, MIN(idx) AS first FROM ledgers WHERE t >= ? AND t < ? GROUP BY b ORDER BY b`).all(step, lo, hi).map((r) => Object.values(r)) : [];
  const whales =
    hi > lo && Number.isFinite(min)
      ? d
          .prepare("SELECT w.hash, l.t, w.idx, w.src, w.dst, w.tag, w.xrp, w.src_name AS srcName, w.dst_name AS dstName FROM whales w JOIN ledgers l ON l.idx = w.idx WHERE l.t >= ? AND l.t < ? AND w.xrp >= ? ORDER BY w.xrp DESC LIMIT ?")
          .all(lo, hi, Math.max(0, min), MAX_WHALES)
          .map((r) => ({ ...r }))
          .sort((a, b) => a.t - b.t)
      : [];
  return { ...base, buckets, whales, first: span.first, last: span.last, dexFirst: dx.first };
}

// Settings, Market data: whether the collector follows the ledger, from which server, whether it fills in from
// the shared history (on unless turned off), and how it's doing.
function saved() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
  } catch {
    return {}; // none yet: off
  }
}
export function settings() {
  const s = saved();
  const d = store();
  const span = d ? d.prepare("SELECT MIN(t) AS first, MAX(t) AS last, COUNT(*) AS n FROM ledgers").get() : null;
  return { enabled: s.enabled === true, server: serverOf(s), history: s.history !== false, collector: collector(), stored: span?.n ? { from: span.first, to: span.last, ledgers: span.n } : null };
}

export function saveSettings(body = {}) {
  const enabled = body.enabled === true,
    now = saved();
  // left out (the on/off switch, the history switch): kept as it was. A server is written only when one is
  // given, so turning XRPL on doesn't fix today's default in place.
  const server = body.server == null ? now.server || null : String(body.server).trim() || null;
  const history = typeof body.history === "boolean" ? body.history : now.history !== false;
  if (server && (server.length > 200 || !/^wss?:\/\/[^\s/]+(\/[^\s]*)?$/.test(server))) throw bad("The server is a WebSocket address, like wss://s1.ripple.com");
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  const tmp = `${SETTINGS}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ enabled, ...(server ? { server } : {}), history }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, SETTINGS);
  return settings();
}
