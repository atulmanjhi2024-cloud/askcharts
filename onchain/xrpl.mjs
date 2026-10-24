// The XRP Ledger collector for XRPL On chain. It follows validated ledgers on one server (its `ledger`
// stream says when one is in; the `ledger` command brings it whole) and keeps a row per ledger in
// data/xrpl.sqlite. Between new ledgers it fills in the past, newest first, at a gentle pace and only as
// far back as the server holds and XRPL_BACKFILL_DAYS asks; a ledger missed while disconnected is filled
// in the same way. With XRPL_HISTORY_URL set, the shared history goes first (history-sync.mjs): the hours it
// has come in whole, and only what it hasn't is filled ledger by ledger. Node only, no packages: the WebSocket
// and SQLite are built in.
//
//   node onchain/xrpl.mjs run              follow the ledger (the systemd service runs this)
//   node onchain/xrpl.mjs status           what's stored, and the collector's last status
//   node onchain/xrpl.mjs ledger IDX       one ledger, summed up (nothing saved)
//   node onchain/xrpl.mjs prune [DAYS]     drop ledgers older than DAYS (XRPL_KEEP_DAYS)
//   node onchain/xrpl.mjs relabel          exchange names on stored big payments, from the current list
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, saveLedger, missing, span, prune, relabel, writeStatus, STATUS_FILE } from "./db.mjs";
import { summarize, ranges, EXCHANGES } from "./xrpl-ledger.mjs";
import { syncHistory } from "./history-sync.mjs";

const num = (v, d) => (Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : d);
// Ripple's public server by default (xrplcluster.com's free allowance is less than a ledger with its
// transactions every few seconds: it can't keep up); point XRPL_SERVER at your own node to spare the public one.
const SERVER = process.env.XRPL_SERVER || "wss://s1.ripple.com";
const KEEP_DAYS = num(process.env.XRPL_KEEP_DAYS, 90);
const BACKFILL_DAYS = Math.min(num(process.env.XRPL_BACKFILL_DAYS, 1), KEEP_DAYS);
// A server on this computer or this network: your own node.
export function isLocal(url) {
  try {
    const h = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return h === "localhost" || h === "::1" || h.endsWith(".local") || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^f[cd][0-9a-f]{2}:/.test(h);
  } catch {
    return false;
  }
}
// ledgers a second while filling in: your own node takes 5; a public server shares itself out, so 2, and less
// while it says to slow down
const PACE = Math.max(0.2, num(process.env.XRPL_PACE, isLocal(SERVER) ? 5 : 2));
// shared history (data.askcharts.pro); empty: off, as on the machine that publishes it
const HISTORY_URL = (process.env.XRPL_HISTORY_URL || "").replace(/\/+$/, "");
const TIMEOUT = 30000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A server saying to slow down, and for how long (ms): xrplcluster.com's "rate limit: units quota (2000 per 10s)
// exhausted, retry in ~6357ms", rippled's slowDown and tooBusy. Null for any other error.
export function limitWait(e) {
  const msg = String(e?.message || "");
  if (!/rate.?limit|slow.?down|too.?busy/i.test(msg) && !["slowDown", "tooBusy"].includes(e?.code)) return null;
  const ms = /retry in ~?\s*(\d+)\s*ms/i.exec(msg),
    sec = /retry in ~?\s*(\d+(?:\.\d+)?)\s*s\b/i.exec(msg);
  return Math.min(60000, ms ? Number(ms[1]) : sec ? Number(sec[1]) * 1000 : 10000);
}
const now = () => Date.now() / 1000;
const iso = (t) => (t ? new Date(t * 1000).toISOString() : null);
const host = (u) => {
  try {
    return new URL(u).host;
  } catch {
    return "?";
  }
};

// One WebSocket: requests answered by id, stream messages to onEvent, closed for good on any error.
function connect(url, onEvent) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const waiting = new Map();
    let id = 0;
    const link = {
      open: false,
      request(cmd) {
        if (!link.open) return Promise.reject(new Error("Not connected"));
        const n = ++id;
        return new Promise((res, rej) => {
          const timer = setTimeout(() => {
            waiting.delete(n);
            rej(new Error(`${cmd.command}: no answer in ${TIMEOUT / 1000}s`));
            link.close();
          }, TIMEOUT);
          waiting.set(n, { res, rej, timer });
          ws.send(JSON.stringify({ ...cmd, id: n, api_version: 2 }));
        });
      },
      close() {
        link.open = false;
        try {
          ws.close();
        } catch {
          /* already closed */
        }
      },
    };
    const fail = (e) => {
      link.open = false;
      for (const w of waiting.values()) {
        clearTimeout(w.timer);
        w.rej(e);
      }
      waiting.clear();
      link.onclose?.(e);
    };
    ws.onopen = () => {
      link.open = true;
      resolve(link);
    };
    ws.onerror = (e) => reject(new Error(e.message || `Couldn't reach ${host(url)}`));
    // the reason, when the server gives one ("rate limit ..."), says what to do next
    ws.onclose = (e) => fail(new Error(`${host(url)} closed the connection${e?.reason ? `: ${e.reason}` : ""}`));
    ws.onmessage = (m) => {
      let d;
      try {
        d = JSON.parse(m.data);
      } catch {
        return;
      }
      const w = d.id != null && waiting.get(d.id);
      if (w) {
        waiting.delete(d.id);
        clearTimeout(w.timer);
        if (d.status === "success") w.res(d.result);
        else w.rej(Object.assign(new Error(d.error_message || d.error || "Request failed"), { code: d.error }));
      } else if (d.type) onEvent(d);
    };
  });
}

async function fetchLedger(link, idx) {
  const r = await link.request({ command: "ledger", ledger_index: idx, transactions: true, expand: true });
  if (!r.validated) throw Object.assign(new Error(`Ledger ${idx} isn't validated yet`), { code: "notValidated" });
  return r.ledger;
}

// Follow until the connection drops. st is the status, kept between connections. sync: the shared history,
// run before the ledger by ledger fill (new ledgers keep coming in meanwhile).
export async function follow(db, st, sync) {
  // live: new ledgers as the stream announces them; wake: ends a wait when one comes (or the history is in)
  const c = { live: [], wake: () => {} };
  c.link = await connect(SERVER, (m) => {
    if (m.type !== "ledgerClosed") return;
    c.live.push(m.ledger_index);
    st.latest = m.ledger_index;
    st.available = ranges(m.validated_ledgers);
    c.wake();
  });
  c.closed = new Promise((r) => (c.link.onclose = r));
  try {
    return await following(db, st, sync, c);
  } finally {
    // however this connection ends, it's closed: a new one is never opened beside it
    c.link.close();
  }
}
async function following(db, st, sync, c) {
  const { link, live, closed } = c;
  const waitWake = () => new Promise((r) => (c.wake = r));
  const sub = await link.request({ command: "subscribe", streams: ["ledger"] });
  st.connected = true;
  st.connectedAt = iso(now());
  st.latest = sub.ledger_index;
  st.available = ranges(sub.validated_ledgers);
  // how far back to fill: a first guess from the ledger rate, put right by the first ledger older than
  // the cutoff (from there on down nothing more is needed)
  let floor = st.latest - Math.ceil((BACKFILL_DAYS * 86400) / 3.5);
  const skip = new Set();
  let todo = [];
  const plan = () => {
    const out = [];
    for (const [a, b] of [...st.available].reverse()) {
      const lo = Math.max(a, floor),
        hi = Math.min(b, st.latest);
      for (const i of missing(db, lo, hi, 400 - out.length)) if (!skip.has(i)) out.push(i);
      if (out.length >= 400) break;
    }
    return out;
  };
  // true when the ledger is done with (saved, or not on this server); false when the server said to wait
  const save = async (idx, seen) => {
    try {
      const sum = summarize(await fetchLedger(link, idx), { seen });
      saveLedger(db, sum);
      st.saved++;
      if (sum.row.close < now() - BACKFILL_DAYS * 86400 && seen == null) {
        floor = Math.max(floor, idx + 1);
        todo = todo.filter((i) => i >= floor);
      }
      return true;
    } catch (e) {
      if (!link.open) throw e;
      // the server doesn't have it (or not yet): leave it for this connection
      if (e.code === "lgrNotFound" || e.code === "notValidated") {
        skip.add(idx);
        return true;
      }
      const ms = limitWait(e);
      if (ms == null) throw e;
      // asked to slow down: wait as long as it says, fill in at half the pace, and stay connected
      st.pace = Math.max(0.2, st.pace / 2);
      st.paceAt = now();
      st.lastError = e.message;
      st.lastErrorAt = iso(now());
      st.limited = { until: iso(now() + ms / 1000), message: e.message };
      status(db, st, floor);
      await Promise.race([sleep(ms + 250), closed]);
      st.limited = null;
      return false;
    }
  };
  let lastStatus = 0;
  let ready = !sync;
  if (sync)
    sync().finally(() => {
      ready = true;
      c.wake();
    });
  while (link.open) {
    if (live.length) {
      if (await save(live[0], Math.round(now()))) live.shift();
    } else if (!ready) await Promise.race([waitWake(), sleep(5000), closed]);
    else {
      if (!todo.length) todo = plan();
      if (todo.length) {
        const idx = todo[0];
        if ((await save(idx, null)) && todo[0] === idx) todo.shift();
        await sleep(1000 / st.pace);
      } else await Promise.race([waitWake(), sleep(5000), closed]);
    }
    // a quiet minute after a slow down: a quarter faster, up to the usual pace
    if (st.pace < PACE && now() - st.paceAt > 60) {
      st.pace = Math.min(PACE, st.pace * 1.25);
      st.paceAt = now();
    }
    if (now() - lastStatus > 10) {
      lastStatus = now();
      status(db, st, floor);
    }
    if (now() - st.prunedAt > 3600) {
      st.pruned += prune(db, KEEP_DAYS);
      st.prunedAt = now();
    }
  }
  throw (await closed) || new Error("Connection closed");
}

function status(db, st, floor) {
  const s = span(db);
  const lo = floor != null && st.available.length ? Math.max(floor, st.available[0][0]) : null;
  const want = lo != null && st.latest ? st.latest - lo + 1 : null;
  const have = lo != null ? db.prepare("SELECT COUNT(*) AS n FROM ledgers WHERE idx BETWEEN ? AND ?").get(lo, st.latest).n : null;
  writeStatus({
    server: host(SERVER),
    connected: st.connected,
    connectedAt: st.connectedAt,
    latest: st.latest,
    behind: st.latest && s.last ? st.latest - s.last : null,
    toFill: want != null ? Math.max(0, want - have) : null,
    stored: { first: s.first, last: s.last, count: s.count, from: iso(s.from), to: iso(s.to) },
    settings: { backfillDays: BACKFILL_DAYS, keepDays: KEEP_DAYS, pace: PACE },
    // the fill-in pace now (lower while a public server says to slow down), and that wait while it lasts
    pace: st.pace,
    limited: st.limited || null,
    history: st.history,
    saved: st.saved,
    pruned: st.pruned,
    errors: st.errors,
    lastError: st.lastError,
    lastErrorAt: st.lastErrorAt,
    updated: iso(now()),
  });
}

export const newStatus = () => ({ connected: false, latest: null, available: [], saved: 0, pruned: 0, prunedAt: 0, errors: 0, lastError: null, history: null, pace: PACE, paceAt: 0, limited: null });

async function run() {
  const db = openDb();
  db.exec("PRAGMA busy_timeout = 5000");
  const st = newStatus();
  // the shared history: one sync at a time, on each connection and then hourly
  let syncing = null;
  const sync = !HISTORY_URL
    ? null
    : () =>
        (syncing ||= syncHistory({ db, url: HISTORY_URL, keepDays: KEEP_DAYS, log: (m) => console.error(`${iso(now())} shared history: ${m}`) })
          .then((r) => (st.history = { from: host(HISTORY_URL), ...r, syncedAt: iso(now()), error: null }))
          .catch((e) => {
            st.history = { ...st.history, from: host(HISTORY_URL), syncedAt: iso(now()), error: e.message };
            console.error(`${iso(now())} shared history: ${e.message}`);
          })
          .finally(() => (syncing = null)));
  if (sync) setInterval(sync, 3600e3);
  let wait = 2;
  let stopping = false;
  for (const sig of ["SIGTERM", "SIGINT"])
    process.on(sig, () => {
      stopping = true;
      st.connected = false;
      status(db, st, null);
      process.exit(0);
    });
  while (!stopping) {
    const t0 = now();
    try {
      await follow(db, st, sync);
    } catch (e) {
      st.errors++;
      st.lastError = e.message;
      st.lastErrorAt = iso(now());
      console.error(`${iso(now())} ${e.message}`);
    }
    st.connected = false;
    status(db, st, null);
    // a connection that lasted a while starts the waiting over; a server that said how long to wait gets that
    if (now() - t0 > 120) wait = 2;
    await sleep(Math.max(wait * 1000, limitWait({ message: st.lastError }) ?? 0));
    wait = Math.min(60, wait * 2);
  }
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "run") return run();
  if (cmd === "status") {
    const db = openDb();
    console.log(JSON.stringify({ stored: span(db), status: fs.existsSync(STATUS_FILE) ? JSON.parse(fs.readFileSync(STATUS_FILE, "utf8")) : null }, null, 2));
    return;
  }
  if (cmd === "ledger") {
    const link = await connect(SERVER, () => {});
    try {
      console.log(JSON.stringify(summarize(await fetchLedger(link, Number(arg))), null, 2));
    } finally {
      link.close();
    }
    return;
  }
  if (cmd === "prune") return console.log(`${prune(openDb(), num(arg, KEEP_DAYS))} ledgers removed`);
  if (cmd === "relabel") return console.log(`${relabel(openDb(), EXCHANGES)} big payments labelled again`);
  console.log("Usage: node onchain/xrpl.mjs run | status | ledger IDX | prune [DAYS] | relabel");
  process.exitCode = 1;
}

// only when run, not when imported; the path compare works on Windows too
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  // started by AskCharts' runner: stop with it, even if it's killed outright
  if (process.send) process.on("disconnect", () => process.exit(0));
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
