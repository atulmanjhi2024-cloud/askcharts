// Offline tests of shared XRPL history: publishing (complete hours only, days rolled up, nothing published
// changes) and the checks an install runs on a download. node --test onchain/test/history.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { openDb, saveLedger, getState, prune } from "../db.mjs";
import { publish, verify, revoke } from "../publish.mjs";
import { syncHistory } from "../history-sync.mjs";
import { COLS, WHALE_COLS, FORMATS, encodeChunk, decodeChunk, signManifest, readManifest, sha256 } from "../xrpl-history.mjs";
import { DEX_COLS } from "../xrpl-ledger.mjs";

const keys = crypto.generateKeyPairSync("ed25519");
const pub = keys.publicKey.export({ type: "spki", format: "pem" });
const H = Date.UTC(2026, 9, 20, 0) / 1000; // a day start (UTC), so also an hour start
const BINANCE = "rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh";
const B = "rBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const hash = (n) => crypto.createHash("sha256").update(String(n)).digest("hex").toUpperCase();
// a ledger whose counts add up the way the collector counts them
const row = (idx, close) => ({ idx, close, res: 10, seen: null, txs: 10, failed: 1, batch: 2, money: 3, markets: 2, nfts: 1, accounts: 1, other: 0, xrp: 1500.5, pays: 2, ex_in: 100, ex_out: 50.25, fees: 120, created: 0 });
const whale = (idx) => ({ hash: hash(idx), idx, src: BINANCE, dst: B, tag: 7, xrp: 2e6, src_name: "Binance", dst_name: null });

// a store with a ledger every 10 seconds from a to b (one big payment an hour), less the ones in skip. A ledger's
// index comes from its time, as on the real ledger, so two stores agree on which ledger is which
const T0 = H - 30;
const fill = (db, a, b, skip = new Set()) => {
  for (let t = a, idx = 1000 + (a - T0) / 10; t < b; t += 10, idx++) if (!skip.has(idx)) saveLedger(db, { row: row(idx, t), whales: (t - T0) % 3600 === 0 ? [whale(idx)] : [] });
};
function store(a, b, skip = new Set()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xrpl-hist-"));
  const db = openDb(path.join(dir, "xrpl.sqlite"));
  fill(db, a, b, skip);
  return { db, dir, out: path.join(dir, "publish") };
}
// as plain objects (node:sqlite rows have no prototype)
const rowsIn = (db, a, b) => db.prepare(`SELECT ${COLS.join(", ")} FROM ledgers WHERE close >= ? AND close < ? ORDER BY idx`).all(a, b).map((r) => ({ ...r }));

test("publishes complete hours only, never one with a hole, and signs the manifest", () => {
  // from 30 seconds before H to 3 hours and 30 seconds after; one ledger missing in the second hour
  const holeIdx = 1000 + 3 + 360 + 50;
  const s = store(H - 30, H + 3 * 3600 + 30, new Set([holeIdx]));
  const r = publish({ db: s.db, dir: s.out, key: keys.privateKey, now: H + 4 * 3600 });
  assert.deepEqual(r.hours, ["h/2026-10-20T00.json.br", "h/2026-10-20T02.json.br"]);
  // the hour before H started mid-hour, the second one has the hole, the last one is still going
  assert.deepEqual(r.incomplete, ["2026-10-19T23", "2026-10-20T01"]);
  const v = verify(s.out, pub);
  assert.equal(v.chunks, 2);
  assert.equal(v.ledgers, 720);
  assert.equal(v.whales, 2);
  // a chunk holds the store's rows exactly (less t and seen)
  const e = JSON.parse(fs.readFileSync(path.join(s.out, "xrpl", "manifest.json")));
  const c = decodeChunk(fs.readFileSync(path.join(s.out, "xrpl", e.chunks[0].name)), e.chunks[0]);
  assert.deepEqual(c.ledgers, rowsIn(s.db, H, H + 3600));
  assert.equal(e.chunks[0].first, 1003);
  assert.equal(e.chunks[0].last, 1003 + 359);
  // the wrong key, or a changed byte, and the manifest is refused
  const body = fs.readFileSync(path.join(s.out, "xrpl", "manifest.json")),
    sig = fs.readFileSync(path.join(s.out, "xrpl", "manifest.json.sig"), "utf8");
  assert.throws(() => readManifest(body, sig, crypto.generateKeyPairSync("ed25519").publicKey), /signature/);
  assert.throws(() => readManifest(Buffer.from(body.toString().replace('"days": 90', '"days": 91')), sig, pub), /signature/);
  fs.rmSync(s.dir, { recursive: true });
});

test("rolls a whole day into one chunk, lists only the window, and a second run changes nothing", () => {
  const s = store(H - 30, H + 86400 + 3600 + 30);
  const now = H + 86400 + 2 * 3600;
  const r = publish({ db: s.db, dir: s.out, key: keys.privateKey, now });
  assert.deepEqual(r.days, ["d/2026-10-20.json.br"]);
  const files = (d) => fs.readdirSync(path.join(s.out, "xrpl", d)).sort();
  assert.deepEqual(files("d"), ["2026-10-20.json.br"]);
  // the day's hours are gone; the next day's first hour is out on its own
  assert.deepEqual(files("h"), ["2026-10-21T00.json.br"]);
  const v = verify(s.out, pub);
  assert.equal(v.ledgers, 8640 + 360);
  const before = Object.fromEntries(["d", "h"].flatMap((d) => files(d).map((f) => [`${d}/${f}`, sha256(fs.readFileSync(path.join(s.out, "xrpl", d, f)))])));
  const again = publish({ db: s.db, dir: s.out, key: keys.privateKey, now });
  assert.deepEqual([again.hours, again.days], [[], []]);
  for (const [n, h] of Object.entries(before)) assert.equal(sha256(fs.readFileSync(path.join(s.out, "xrpl", n))), h);
  // a one day window, a day on, leaves the older day out of the manifest (its file stays: the archive)
  publish({ db: s.db, dir: s.out, key: keys.privateKey, now: H + 2 * 86400 + 1800, days: 1 });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.out, "xrpl", "manifest.json"))).chunks.map((e) => e.name), ["h/2026-10-21T00.json.br"]);
  assert.ok(fs.existsSync(path.join(s.out, "xrpl", "d", "2026-10-20.json.br")));
  fs.rmSync(s.dir, { recursive: true });
});

test("a published chunk that changed or went missing stops the publisher", () => {
  const s = store(H - 30, H + 3600 + 30);
  publish({ db: s.db, dir: s.out, key: keys.privateKey, now: H + 2 * 3600 });
  fs.appendFileSync(path.join(s.out, "xrpl", "h", "2026-10-20T00.json.br"), "x");
  assert.throws(() => publish({ db: s.db, dir: s.out, key: keys.privateKey, now: H + 2 * 3600 }), /changed or gone/);
  fs.rmSync(s.dir, { recursive: true });
});

test("an install refuses a chunk that's damaged, too big, odd or doesn't add up", () => {
  const good = Array.from({ length: 3 }, (_, k) => COLS.map((c) => row(500 + k, H + 10 * k)[c]));
  const w = [WHALE_COLS.map((c) => whale(501)[c])];
  const buf = encodeChunk(good, w);
  const entry = { sha256: sha256(buf), first: 500, last: 502, ledgers: 3 };
  assert.equal(decodeChunk(buf, entry).ledgers.length, 3);
  assert.throws(() => decodeChunk(buf, { ...entry, sha256: "0".repeat(64) }), /checksum/);
  assert.throws(() => decodeChunk(buf, { ...entry, last: 503 }), /don't match/);
  assert.throws(() => decodeChunk(buf, {}, { maxJson: 100 }), /unpacks too big|isn't readable/);
  assert.throws(() => decodeChunk(Buffer.alloc(9e6)), /too big/);
  assert.throws(() => decodeChunk(Buffer.from("not brotli")), /isn't readable/);
  const tamper = (fn) => {
    const c = JSON.parse(zlib.brotliDecompressSync(buf));
    fn(c);
    return zlib.brotliCompressSync(Buffer.from(JSON.stringify(c)));
  };
  assert.throws(() => decodeChunk(tamper((c) => (c.ledgers[1][COLS.indexOf("money")] += 1))), /don't add up/);
  assert.throws(() => decodeChunk(tamper((c) => (c.ledgers[2][0] = 509))), /hole/);
  assert.throws(() => decodeChunk(tamper((c) => (c.ledgers[0][COLS.indexOf("xrp")] = -1))), /bad xrp/);
  assert.throws(() => decodeChunk(tamper((c) => (c.ledgers[0][COLS.indexOf("fees")] = 1.5))), /bad fees/);
  assert.throws(() => decodeChunk(tamper((c) => c.cols.push("extra"))), /other columns/);
  assert.throws(() => decodeChunk(tamper((c) => (c.format = 2))), /format/);
  assert.throws(() => decodeChunk(tamper((c) => (c.whales[0][2] = "not an address"))), /bad address/);
  assert.throws(() => decodeChunk(tamper((c) => (c.whales[0][6] = "Nobody's Exchange"))), /unknown exchange/);
  assert.throws(() => decodeChunk(tamper((c) => (c.whales[0][1] = 999))), /not in this chunk/);
});

test("an install refuses a manifest that names files oddly", () => {
  const entry = { name: "../../etc/passwd", first: 1, last: 1, ledgers: 1, from: H, to: H, sha256: "0".repeat(64), bytes: 10, rules: "0123456789ab" };
  const { body, sig } = signManifest({ format: 1, chain: "xrpl", updated: "x", chunks: [entry], revoked: [] }, keys.privateKey);
  assert.throws(() => readManifest(body, sig, pub), /names a chunk oddly/);
  const ok = signManifest({ format: 1, chain: "xrpl", updated: "x", chunks: [{ ...entry, name: "h/2026-10-20T00.json.br" }], revoked: [] }, keys.privateKey);
  assert.equal(readManifest(ok.body, ok.sig, pub).chunks.length, 1);
  assert.throws(() => readManifest(ok.body, ok.sig, ""), /no publisher key/);
});

// ---------- an install: the sync ----------

// a fetch that serves a published folder (and 404s the rest); tamper rewrites one file's bytes on the way
const served = (dir, tamper = {}) => async (url) => {
  const p = path.join(dir, new URL(url).pathname);
  if (!fs.existsSync(p)) return new Response("", { status: 404 });
  const name = new URL(url).pathname.replace(/^\/xrpl\//, "");
  return new Response(tamper[name] ? tamper[name](fs.readFileSync(p)) : fs.readFileSync(p));
};
const all = (db) => db.prepare("SELECT * FROM ledgers ORDER BY idx").all().map((r) => ({ ...r }));
const URL0 = "https://data.example";

test("an install fills in from the published chunks, placed exactly as on the publisher, keeping its own rows", async () => {
  const a = store(H - 30, H + 86400 + 2 * 3600 + 30);
  const now = H + 86400 + 3 * 3600;
  publish({ db: a.db, dir: a.out, key: keys.privateKey, now });
  // the install collected an hour of the day itself (seen when it did), and nothing else
  const b = store(H + 5 * 3600, H + 6 * 3600);
  b.db.exec("UPDATE ledgers SET seen = 123");
  const own = b.db.prepare("SELECT COUNT(*) AS n FROM ledgers").get().n;
  const r = await syncHistory({ format: 1, db: b.db, url: URL0, fetch: served(a.out), now, publicKey: pub });
  assert.equal(r.failed, 0, r.lastError);
  assert.equal(r.fetched, 3); // the day and the next day's two hours
  const pubRows = all(a.db).filter((x) => x.close >= H && x.close < H + 86400 + 2 * 3600);
  const got = all(b.db);
  assert.equal(got.length, pubRows.length);
  // every column, the chart place (t) included, as on the publisher; seen only where the install saw them
  assert.deepEqual(got.map(({ seen, ...x }) => x), pubRows.map(({ seen, ...x }) => x));
  assert.equal(got.filter((x) => x.seen === 123).length, own);
  assert.equal(b.db.prepare("SELECT COUNT(*) AS n FROM whales").get().n, 26);
  // what came from where, for revoking: the day around the install's own hour, and the two hours
  assert.deepEqual(JSON.parse(getState(b.db, "history.imported")).map((x) => x[2]), ["d/2026-10-20.json.br", "d/2026-10-20.json.br", "h/2026-10-21T00.json.br", "h/2026-10-21T01.json.br"]);
  // nothing missing any more: a second sync downloads nothing
  assert.equal((await syncHistory({ format: 1, db: b.db, url: URL0, fetch: served(a.out), now, publicKey: pub })).fetched, 0);

  // the day turns out wrong: revoked, put out again; the install drops what it brought, keeps its own, fills in again
  revoke(a.out, "d/2026-10-20.json.br");
  publish({ db: a.db, dir: a.out, key: keys.privateKey, now });
  assert.ok(fs.existsSync(path.join(a.out, "xrpl", "d", "2026-10-20-r2.json.br")));
  const again = await syncHistory({ format: 1, db: b.db, url: URL0, fetch: served(a.out), now, publicKey: pub });
  assert.equal(again.dropped, 8640 - own);
  assert.equal(again.fetched, 1);
  assert.equal(all(b.db).filter((x) => x.seen === 123).length, own);
  assert.deepEqual(all(b.db).map(({ seen, ...x }) => x), pubRows.map(({ seen, ...x }) => x));
  fs.rmSync(a.dir, { recursive: true });
  fs.rmSync(b.dir, { recursive: true });
});

test("a damaged chunk is skipped whole, a forged manifest brings nothing, and a huge download is cut off", async () => {
  const a = store(H - 30, H + 3 * 3600 + 30);
  const now = H + 4 * 3600;
  publish({ db: a.db, dir: a.out, key: keys.privateKey, now });
  const b = store(H, H); // empty
  const flip = (buf) => Buffer.concat([buf.subarray(0, 100), Buffer.from([buf[100] ^ 1]), buf.subarray(101)]);
  const r = await syncHistory({ format: 1, db: b.db, url: URL0, fetch: served(a.out, { "h/2026-10-20T01.json.br": flip }), now, publicKey: pub });
  assert.equal(r.fetched, 2);
  assert.equal(r.failed, 1);
  assert.match(r.lastError, /T01.*checksum/);
  assert.equal(b.db.prepare("SELECT COUNT(*) AS n FROM ledgers WHERE close >= ? AND close < ?").get(H + 3600, H + 7200).n, 0);
  // signed by someone else: refused before a single chunk
  const c = store(H, H);
  await assert.rejects(syncHistory({ format: 1, db: c.db, url: URL0, fetch: served(a.out), now, publicKey: crypto.generateKeyPairSync("ed25519").publicKey }), /signature/);
  assert.equal(c.db.prepare("SELECT COUNT(*) AS n FROM ledgers").get().n, 0);
  // a server that says (or sends) far too much
  const big = async (url) => (url.endsWith("manifest.json") ? new Response("x", { headers: { "content-length": "99999999" } }) : new Response(""));
  await assert.rejects(syncHistory({ format: 1, db: c.db, url: URL0, fetch: big, now, publicKey: pub }), /too big/);
  for (const s of [a, b, c]) fs.rmSync(s.dir, { recursive: true });
});

test("the oldest chunk at the edge of the keep window isn't fetched, so the hourly prune doesn't bring it back", async () => {
  const a = store(H - 30, H + 2 * 86400 + 3600 + 30);
  const now = H + 2 * 86400 + 2 * 3600;
  publish({ db: a.db, dir: a.out, key: keys.privateKey, now });
  const b = store(H, H);
  // a one day keep window: the 21st's day chunk starts before it (its oldest ledgers would be pruned right away)
  const r = await syncHistory({ format: 1, db: b.db, url: URL0, fetch: served(a.out), now, keepDays: 1, publicKey: pub });
  assert.equal(r.fetched, 1);
  prune(b.db, 1, now);
  assert.equal((await syncHistory({ format: 1, db: b.db, url: URL0, fetch: served(a.out), now, keepDays: 1, publicKey: pub })).fetched, 0);
  fs.rmSync(a.dir, { recursive: true });
  fs.rmSync(b.dir, { recursive: true });
});

test("revoking a day takes back the hours an install took while the day was going", async () => {
  const a = store(H - 30, H + 3 * 3600 + 30);
  publish({ db: a.db, dir: a.out, key: keys.privateKey, now: H + 4 * 3600 });
  const b = store(H, H);
  assert.equal((await syncHistory({ format: 1, db: b.db, url: URL0, fetch: served(a.out), now: H + 4 * 3600, publicKey: pub })).fetched, 3);
  // the day goes on, is rolled up, and turns out wrong
  fill(a.db, H + 3 * 3600 + 30, H + 86400 + 3600 + 30);
  const now = H + 86400 + 2 * 3600;
  publish({ db: a.db, dir: a.out, key: keys.privateKey, now });
  revoke(a.out, "d/2026-10-20.json.br");
  assert.ok(JSON.parse(fs.readFileSync(path.join(a.out, "xrpl", "revoked.json"))).includes("h/2026-10-20T01.json.br"));
  publish({ db: a.db, dir: a.out, key: keys.privateKey, now });
  const r = await syncHistory({ format: 1, db: b.db, url: URL0, fetch: served(a.out), now, publicKey: pub });
  assert.equal(r.dropped, 3 * 360);
  assert.ok(JSON.parse(getState(b.db, "history.imported")).every(([, , n]) => !n.startsWith("h/2026-10-20T")));
  assert.deepEqual(all(b.db).map(({ seen, ...x }) => x), all(a.db).filter((x) => x.close >= H && x.close < H + 86400 + 3600).map(({ seen, ...x }) => x));
  fs.rmSync(a.dir, { recursive: true });
  fs.rmSync(b.dir, { recursive: true });
});

test("an older manifest, even signed, is refused, and a revoked chunk never comes back", async () => {
  const a = store(H - 30, H + 2 * 3600 + 30);
  publish({ db: a.db, dir: a.out, key: keys.privateKey, now: H + 3 * 3600 });
  const old = path.join(a.dir, "old");
  fs.cpSync(path.join(a.out), old, { recursive: true });
  const b = store(H, H);
  await syncHistory({ format: 1, db: b.db, url: URL0, fetch: served(a.out), now: H + 3 * 3600, publicKey: pub });
  revoke(a.out, "h/2026-10-20T00.json.br");
  publish({ db: a.db, dir: a.out, key: keys.privateKey, now: H + 4 * 3600 });
  await syncHistory({ format: 1, db: b.db, url: URL0, fetch: served(a.out), now: H + 4 * 3600, publicKey: pub });
  // the older manifest (from before the revoke), served again
  await assert.rejects(syncHistory({ format: 1, db: b.db, url: URL0, fetch: served(old), now: H + 4 * 3600, publicKey: pub }), /older than one already taken/);
  // a newer manifest that lists the revoked chunk again (signed, as a stolen key could): it isn't fetched
  const m = JSON.parse(fs.readFileSync(path.join(old, "xrpl", "manifest.json")));
  const forged = signManifest({ ...m, updated: new Date((H + 5 * 3600) * 1000).toISOString(), revoked: [] }, keys.privateKey);
  fs.writeFileSync(path.join(old, "xrpl", "manifest.json"), forged.body);
  fs.writeFileSync(path.join(old, "xrpl", "manifest.json.sig"), forged.sig);
  b.db.exec("DELETE FROM ledgers");
  const r = await syncHistory({ format: 1, db: b.db, url: URL0, fetch: served(old), now: H + 5 * 3600, publicKey: pub });
  assert.equal(r.fetched, 1); // the second hour only
  assert.equal(b.db.prepare("SELECT COUNT(*) AS n FROM ledgers WHERE close < ?").get(H + 3600).n, 0);
  fs.rmSync(a.dir, { recursive: true });
  fs.rmSync(b.dir, { recursive: true });
});

// ---------- format 2: the DEX columns (.project/xrpl-dex.md) ----------
const DEX = { dex_got: 2.5, dex_paid: 3, amm_got: 1, amm_paid: 0.5, dex_bridge: 0.25, dex_fills: 4, amm_swaps: 1 };
// ledgers from a to b with DEX numbers (the collector counted them), as fill() does without
const fillDex = (db, a, b, dex = DEX) => {
  for (let t = a, idx = 1000 + (a - T0) / 10; t < b; t += 10, idx++) saveLedger(db, { row: { ...row(idx, t), ...dex }, whales: (t - T0) % 3600 === 0 ? [whale(idx)] : [] });
};
const dexIn = (db, a, b) => db.prepare(`SELECT ${DEX_COLS.join(", ")} FROM ledgers WHERE close >= ? AND close < ? ORDER BY idx`).all(a, b).map((r) => ({ ...r }));
const nulls = Object.fromEntries(DEX_COLS.map((c) => [c, null]));
const v2 = (dir, ...p) => path.join(dir, "xrpl", "v2", ...p);

test("format 2 carries the DEX numbers (NULL before counting began) beside format 1, which doesn't change", () => {
  // counting began at the second hour
  const s = store(H - 30, H + 3600);
  fillDex(s.db, H + 3600, H + 2 * 3600 + 30);
  const now = H + 3 * 3600;
  const r1 = publish({ db: s.db, dir: s.out, key: keys.privateKey, now });
  const r2 = publish({ db: s.db, dir: s.out, key: keys.privateKey, now, format: 2 });
  assert.deepEqual(r1.hours, r2.hours);
  // format 1: the same rows and columns as ever, readable by 0.1.12
  const m1 = JSON.parse(fs.readFileSync(path.join(s.out, "xrpl", "manifest.json")));
  const c1 = decodeChunk(fs.readFileSync(path.join(s.out, "xrpl", m1.chunks[1].name)), m1.chunks[1]);
  assert.deepEqual(Object.keys(c1.ledgers[0]), COLS);
  // format 2: the DEX columns, NULL in the hour before counting began, counted after
  const m2 = JSON.parse(fs.readFileSync(v2(s.out, "manifest.json")));
  assert.equal(m2.format, 2);
  assert.equal(m2.rules, FORMATS[2].rules);
  assert.notEqual(m2.rules, m1.rules);
  const hour = (k) => decodeChunk(fs.readFileSync(v2(s.out, m2.chunks[k].name)), m2.chunks[k], { format: 2 });
  assert.deepEqual(DEX_COLS.map((c) => hour(0).ledgers[0][c]), DEX_COLS.map(() => null));
  assert.deepEqual(Object.fromEntries(DEX_COLS.map((c) => [c, hour(1).ledgers[0][c]])), DEX);
  assert.equal(verify(s.out, pub, 2).chunks, 2);
  // each format refuses the other's chunks and manifest
  assert.throws(() => decodeChunk(fs.readFileSync(v2(s.out, m2.chunks[0].name)), m2.chunks[0]), /format/);
  assert.throws(() => readManifest(fs.readFileSync(v2(s.out, "manifest.json")), fs.readFileSync(v2(s.out, "manifest.json.sig"), "utf8"), pub), /format/);
  fs.rmSync(s.dir, { recursive: true });
});

test("a store from before the DEX columns (layout 1) publishes format 2 with them NULL", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const s = store(H - 30, H + 3600 + 30);
  s.db.close();
  const old = new DatabaseSync(path.join(s.dir, "xrpl.sqlite"));
  old.exec("DROP INDEX IF EXISTS ledgers_dex_t");
  for (const c of DEX_COLS) old.exec(`ALTER TABLE ledgers DROP COLUMN ${c}`);
  const r = publish({ db: old, dir: s.out, key: keys.privateKey, now: H + 2 * 3600, format: 2 });
  assert.equal(r.hours.length, 1);
  const m = JSON.parse(fs.readFileSync(v2(s.out, "manifest.json")));
  const c = decodeChunk(fs.readFileSync(v2(s.out, m.chunks[0].name)), m.chunks[0], { format: 2 });
  assert.ok(c.ledgers.every((o) => DEX_COLS.every((k) => o[k] === null)));
  old.close();
  fs.rmSync(s.dir, { recursive: true });
});

test("format 2 refuses DEX numbers that are partly missing or don't add up", () => {
  const rowOf = (dex) => FORMATS[2].cols.map((c) => ({ ...row(1003, H + 10), ...dex })[c]);
  const chunk = (dex) => encodeChunk([rowOf(dex)], [], FORMATS[2]);
  assert.equal(decodeChunk(chunk(DEX), {}, { format: 2 }).ledgers.length, 1);
  assert.equal(decodeChunk(chunk(nulls), {}, { format: 2 }).ledgers.length, 1);
  assert.throws(() => decodeChunk(chunk({ ...DEX, amm_swaps: null }), {}, { format: 2 }), /partly missing/);
  assert.throws(() => decodeChunk(chunk({ ...DEX, amm_got: 3 }), {}, { format: 2 }), /don't add up/);
  assert.throws(() => decodeChunk(chunk({ ...DEX, dex_bridge: 2.75 }), {}, { format: 2 }), /don't add up/);
  assert.throws(() => decodeChunk(chunk({ ...DEX, dex_fills: 1.5 }), {}, { format: 2 }), /bad dex_fills/);
  // a ledger of only token to token trades: received and paid both bridged, and that adds up
  assert.equal(decodeChunk(chunk({ ...DEX, dex_got: 0.25, dex_paid: 0.25, amm_got: 0, amm_paid: 0 }), {}, { format: 2 }).ledgers.length, 1);
});

test("an install on format 2 fills DEX numbers into rows it has, never over its own, and takes each chunk once", async () => {
  // the publisher counted from the second hour on
  const a = store(H - 30, H + 3600);
  fillDex(a.db, H + 3600, H + 3 * 3600 + 30);
  const now = H + 4 * 3600;
  publish({ db: a.db, dir: a.out, key: keys.privateKey, now, format: 2 });
  // the install has the second hour from before it updated (not counted), and the third counted its own way
  const b = store(H + 3600, H + 2 * 3600);
  fillDex(b.db, H + 2 * 3600, H + 3 * 3600, { ...DEX, dex_got: 7, amm_got: 2 });
  const r = await syncHistory({ db: b.db, url: URL0, fetch: served(a.out), now, publicKey: pub });
  assert.equal(r.failed, 0, r.lastError);
  assert.equal(r.fetched, 2); // the first hour (missing) and the second (not counted); the third it has, counted
  assert.equal(r.filled, 360);
  assert.ok(dexIn(b.db, H, H + 3600).every((x) => DEX_COLS.every((c) => x[c] === null)));
  assert.ok(dexIn(b.db, H + 3600, H + 2 * 3600).every((x) => x.dex_got === 2.5));
  assert.ok(dexIn(b.db, H + 2 * 3600, H + 3 * 3600).every((x) => x.dex_got === 7));
  // again: nothing to fetch, the uncounted first hour included (taken once)
  assert.equal((await syncHistory({ db: b.db, url: URL0, fetch: served(a.out), now, publicKey: pub })).fetched, 0);
  fs.rmSync(a.dir, { recursive: true });
  fs.rmSync(b.dir, { recursive: true });
});

test("a revoked chunk takes back its DEX numbers and the rows format 1 brought before the install updated", async () => {
  const a = store(H - 30, H);
  fillDex(a.db, H, H + 2 * 3600 + 30);
  const now = H + 3 * 3600;
  publish({ db: a.db, dir: a.out, key: keys.privateKey, now });
  publish({ db: a.db, dir: a.out, key: keys.privateKey, now, format: 2 });
  // before it updated, the install read format 1: two hours of rows, no DEX numbers
  const b = store(H, H);
  assert.equal((await syncHistory({ format: 1, db: b.db, url: URL0, fetch: served(a.out), now, publicKey: pub })).fetched, 2);
  assert.ok(dexIn(b.db, H, H + 2 * 3600).every((x) => x.dex_got === null));
  // updated: format 2 fills them in
  assert.equal((await syncHistory({ db: b.db, url: URL0, fetch: served(a.out), now, publicKey: pub })).filled, 720);
  // the first hour turns out wrong, in both formats: revoked, out again under a new name
  revoke(a.out, "h/2026-10-20T00.json.br");
  revoke(a.out, "h/2026-10-20T00.json.br", 2);
  publish({ db: a.db, dir: a.out, key: keys.privateKey, now });
  publish({ db: a.db, dir: a.out, key: keys.privateKey, now, format: 2 });
  const r = await syncHistory({ db: b.db, url: URL0, fetch: served(a.out), now, publicKey: pub });
  // the rows format 1 brought go, and come back from the new format 2 chunk, counted
  assert.equal(r.dropped, 360);
  assert.equal(r.fetched, 1);
  assert.ok(JSON.parse(getState(b.db, "history.imported")).every(([, , n]) => n !== "h/2026-10-20T00.json.br"));
  assert.deepEqual(dexIn(b.db, H, H + 2 * 3600), dexIn(a.db, H, H + 2 * 3600));
  fs.rmSync(a.dir, { recursive: true });
  fs.rmSync(b.dir, { recursive: true });
});
