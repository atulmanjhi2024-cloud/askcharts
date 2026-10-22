// The publishing side of shared XRPL history, for the one machine that collects around the clock. It reads
// the store (read only, beside the running collector) and writes chunks into a folder: one per complete
// hour, rolled into one per day once every hour of the day is out. A chunk is only
// written when no ledger is missing in it or at its edges, a written chunk is never changed, and every new
// one is read back and checked the way an install checks it. Then the manifest is signed. Deploying the
// folder is a separate step.
//
//   node onchain/publish.mjs keygen          make the signing key (once, on the publishing machine)
//   node onchain/publish.mjs run             publish what's complete and not out yet, sign the manifest
//   node onchain/publish.mjs revoke NAME     take a published chunk back (the next run puts it out anew)
//   node onchain/publish.mjs verify [DIR]    check a published folder the way an install would
//
// XRPL_PUBLISH_DIR (data/publish), XRPL_PUBLISH_DAYS (90: what the manifest lists), XRPL_PUBLISH_KEY
// (~/.config/askcharts/xrpl-history.key).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { DATA, DB_FILE } from "./db.mjs";
import { COLS, WHALE_COLS, RULES, PUBLIC_KEY, FORMAT, encodeChunk, decodeChunk, signManifest, readManifest, sha256 } from "./xrpl-history.mjs";

const num = (v, d) => (Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : d);
const HOUR = 3600,
  DAY = 86400;
const iso = (t) => new Date(t * 1000).toISOString();
// A chunk's stem says what it holds ("h/2026-10-20T14", "d/2026-10-20"); its name adds a revision when the stem
// was out before ("-r2"): a name, once used, is never used for other bytes (installs and caches keep them).
const hourStem = (h) => `h/${iso(h).slice(0, 13)}`;
const dayStem = (d) => `d/${iso(d).slice(0, 10)}`;
const stemOf = (name) => name.replace(/(-r\d+)?\.json\.br$/, "");
const readJson = (file, empty) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : empty);

// write beside, then rename: a reader (or a deploy) never sees half a file
function put(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

// The ledgers whose (network) close time is in [a, b), when none is missing: no hole inside, the ledger before
// the first one is stored (so nothing is missing at the start) and so is the one after the last (so the span
// is over and nothing is still to come at its end). Null otherwise.
function complete(db, a, b) {
  const r = db.prepare("SELECT MIN(idx) AS first, MAX(idx) AS last, COUNT(*) AS n FROM ledgers WHERE close >= ? AND close < ?").get(a, b);
  if (!r.n || r.n !== r.last - r.first + 1) return null;
  const has = db.prepare("SELECT 1 FROM ledgers WHERE idx = ?");
  if (!has.get(r.first - 1) || !has.get(r.last + 1)) return null;
  return { first: r.first, last: r.last };
}

function rowsOf(db, first, last) {
  const ledgers = db.prepare(`SELECT ${COLS.join(", ")} FROM ledgers WHERE idx BETWEEN ? AND ? ORDER BY idx`).all(first, last).map((r) => COLS.map((c) => r[c]));
  const whales = db.prepare(`SELECT ${WHALE_COLS.join(", ")} FROM whales WHERE idx BETWEEN ? AND ? ORDER BY idx, hash`).all(first, last).map((r) => WHALE_COLS.map((c) => r[c]));
  return { ledgers, whales };
}

// Write one chunk (never over a different one already out), read it back as an install would, and return its
// manifest entry.
function writeChunk(db, dir, name, first, last) {
  const { ledgers, whales } = rowsOf(db, first, last);
  const buf = encodeChunk(ledgers, whales);
  const file = path.join(dir, name);
  if (fs.existsSync(file)) throw new Error(`${name} is out already; a published chunk never changes`);
  const entry = { name, first, last, ledgers: ledgers.length, from: ledgers[0][1], to: ledgers.at(-1)[1], sha256: sha256(buf), bytes: buf.length, rules: RULES };
  const back = decodeChunk(buf, entry);
  const sum = (rows, k) => rows.reduce((s, r) => s + r[k], 0);
  if (back.ledgers.length !== ledgers.length || sum(back.ledgers.map((o) => COLS.map((c) => o[c])), 3) !== sum(ledgers, 3) || back.whales.length !== whales.length)
    throw new Error(`${name}: read back differently`);
  put(file, buf);
  return entry;
}

// One pass: every complete hour in the window that isn't out (as an hour or in its day), then each day whose 24
// hours are all out rolled into one, then the manifest. Returns what it did.
export function publish({ db, dir, key, days = 90, now = Date.now() / 1000 }) {
  const out = path.join(dir, "xrpl");
  // what's out (the manifest entries, kept beside the chunks so they needn't be read again), every name ever
  // used, and the revoked names
  const index = readJson(path.join(out, "index.json"), {});
  const used = new Set(readJson(path.join(out, "names.json"), Object.keys(index)));
  const revoked = readJson(path.join(out, "revoked.json"), []);
  for (const e of Object.values(index))
    if (!fs.existsSync(path.join(out, e.name)) || sha256(fs.readFileSync(path.join(out, e.name))) !== e.sha256) throw new Error(`${e.name} has changed or gone since it was published`);
  const current = (stem) => Object.values(index).find((e) => stemOf(e.name) === stem);
  const fresh = (stem) => {
    let n = 1;
    while (used.has(n === 1 ? `${stem}.json.br` : `${stem}-r${n}.json.br`)) n++;
    return n === 1 ? `${stem}.json.br` : `${stem}-r${n}.json.br`;
  };
  const write = (stem, first, last) => {
    const name = fresh(stem);
    index[name] = writeChunk(db, out, name, first, last);
    used.add(name);
    return name;
  };
  const span = db.prepare("SELECT MIN(close) AS a, MAX(close) AS b FROM ledgers").get();
  const done = { hours: [], days: [], incomplete: [] };
  if (span.a != null) {
    const from = Math.max(span.a - (span.a % HOUR), Math.floor((now - days * DAY) / HOUR) * HOUR);
    for (let h = from; h + HOUR <= span.b; h += HOUR) {
      if (current(hourStem(h)) || current(dayStem(h - (h % DAY)))) continue;
      const c = complete(db, h, h + HOUR);
      if (!c) {
        done.incomplete.push(iso(h).slice(0, 13));
        continue;
      }
      done.hours.push(write(hourStem(h), c.first, c.last));
    }
    // a day whose every hour is out becomes one chunk, and its hours go (the NAS keeps them)
    const daysOut = new Set(Object.keys(index).filter((n) => n.startsWith("h/")).map((n) => n.slice(2, 12)));
    for (const d of daysOut) {
      const day = Date.parse(`${d}T00:00:00Z`) / 1000;
      const hours = Array.from({ length: 24 }, (_, k) => current(hourStem(day + k * HOUR)));
      if (!hours.every(Boolean)) continue;
      // the hours run on from each other: together they're the whole day
      if (hours.some((e, k) => k && e.first !== hours[k - 1].last + 1)) continue;
      done.days.push(write(dayStem(day), hours[0].first, hours[23].last));
      for (const e of hours) {
        fs.rmSync(path.join(out, e.name));
        delete index[e.name];
      }
    }
  }
  put(path.join(out, "index.json"), `${JSON.stringify(index, null, 1)}\n`);
  put(path.join(out, "names.json"), `${JSON.stringify([...used].sort(), null, 1)}\n`);
  // the manifest lists the window; older chunks stay in the folder (the archive) but aren't offered
  const chunks = Object.values(index)
    .filter((e) => e.to >= now - days * DAY)
    .sort((x, y) => x.first - y.first);
  const { body, sig } = signManifest({ format: FORMAT, chain: "xrpl", updated: iso(Math.floor(now)), days, rules: RULES, chunks, revoked }, key);
  put(path.join(out, "manifest.json"), body);
  put(path.join(out, "manifest.json.sig"), sig);
  return { ...done, chunks: chunks.length, bytes: chunks.reduce((s, e) => s + e.bytes, 0) };
}

// Take a published chunk back (it turned out wrong): out of the manifest, onto its revoked list, so installs
// drop the rows it brought them. A day takes its hours with it: an install that ran through the day imported it
// hour by hour. The next run puts the span out again under new names. The files stay (the archive).
export function revoke(dir, name) {
  const out = path.join(dir, "xrpl");
  const index = readJson(path.join(out, "index.json"), {});
  if (!index[name]) throw new Error(`${name} isn't a published chunk`);
  const revoked = readJson(path.join(out, "revoked.json"), []);
  const used = readJson(path.join(out, "names.json"), []);
  const hours = name.startsWith("d/") ? used.filter((n) => n.startsWith(`h/${stemOf(name).slice(2)}T`)) : [];
  delete index[name];
  put(path.join(out, "index.json"), `${JSON.stringify(index, null, 1)}\n`);
  put(path.join(out, "revoked.json"), `${JSON.stringify([...new Set([...revoked, name, ...hours])], null, 1)}\n`);
}

// A published folder, checked the way an install checks a download: the signature, then every chunk.
export function verify(dir, publicKey = PUBLIC_KEY) {
  const out = path.join(dir, "xrpl");
  const m = readManifest(fs.readFileSync(path.join(out, "manifest.json")), fs.readFileSync(path.join(out, "manifest.json.sig"), "utf8"), publicKey);
  let ledgers = 0,
    whales = 0;
  for (const e of m.chunks) {
    const c = decodeChunk(fs.readFileSync(path.join(out, e.name)), e);
    ledgers += c.ledgers.length;
    whales += c.whales.length;
  }
  return { updated: m.updated, chunks: m.chunks.length, ledgers, whales, first: m.chunks[0]?.name || null, last: m.chunks.at(-1)?.name || null };
}

const KEY_FILE = process.env.XRPL_PUBLISH_KEY || path.join(os.homedir(), ".config", "askcharts", "xrpl-history.key");
const DIR = process.env.XRPL_PUBLISH_DIR || path.join(DATA, "publish");

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "keygen") {
    if (fs.existsSync(KEY_FILE)) throw new Error(`${KEY_FILE} exists already; a new key would orphan every install's copy of the old one`);
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true, mode: 0o700 });
    fs.writeFileSync(KEY_FILE, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
    console.log(`Private key: ${KEY_FILE} (0600; back it up, it never leaves this machine)\nPublic key, for PUBLIC_KEY in onchain/xrpl-history.mjs:\n${publicKey.export({ type: "spki", format: "pem" })}`);
    return;
  }
  if (cmd === "run") {
    const key = crypto.createPrivateKey(fs.readFileSync(KEY_FILE));
    const db = new DatabaseSync(DB_FILE, { readOnly: true });
    const r = publish({ db, dir: DIR, key, days: num(process.env.XRPL_PUBLISH_DAYS, 90) });
    const status = { updated: new Date().toISOString(), ...r, incomplete: r.incomplete.slice(-48) };
    put(path.join(DATA, "publish-status.json"), `${JSON.stringify(status, null, 1)}\n`);
    console.log(JSON.stringify({ ...status, hours: r.hours.length, days: r.days, incomplete: r.incomplete.length }));
    return;
  }
  if (cmd === "verify") return console.log(JSON.stringify(verify(arg || DIR)));
  if (cmd === "revoke") {
    revoke(DIR, arg);
    return console.log(`${arg} revoked; the next run puts its ledgers out under a new name`);
  }
  console.log("Usage: node onchain/publish.mjs keygen | run | revoke NAME | verify [DIR]");
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]))
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
