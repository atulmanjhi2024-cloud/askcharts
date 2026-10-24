// The history importer's pieces, offline: archive rows, bars from trades, coarser bars, the store's
// layout and versions, gap finding, and jobs from the Crypto data page. Run: node --test history/test/history.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "history-test-"));
process.env.HISTORY_DATA = tmp;
// Kraken's archive host, played locally (HEAD, GET, ranges): the importer reads KRAKEN_FILES when it loads
const http = await import("node:http");
const served = new Map(),
  gets = [];
const kraken = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, "http://x").pathname.slice(1)),
    body = served.get(name);
  if (!body) return res.writeHead(404).end();
  if (req.method === "HEAD") return res.writeHead(200, { "content-length": body.length }).end();
  gets.push(name);
  const m = /^bytes=(\d+)-$/.exec(req.headers.range || "");
  if (m) return res.writeHead(206, { "content-length": body.length - +m[1], "content-range": `bytes ${m[1]}-${body.length - 1}/${body.length}` }).end(body.subarray(+m[1]));
  res.writeHead(200, { "content-length": body.length }).end(body);
});
await new Promise((r) => kraken.listen(0, "127.0.0.1", r));
kraken.unref();
process.env.KRAKEN_FILES = `http://127.0.0.1:${kraken.address().port}`;
const db = await import("../db.mjs");
const k = await import("../kraken.mjs");

test("archive rows: Kraken's seven columns, anything else skipped", () => {
  assert.deepEqual(k.parseRow("1782864000,1.03854,1.0392,1.0385,1.03896,9590.61293352,19"), { t: 1782864000, o: 1.03854, h: 1.0392, l: 1.0385, c: 1.03896, v: 9590.61293352, n: 19 });
  for (const bad of ["timestamp,open,high,low,close,volume,trades", "1782864000,1,2,3", "1782864000,a,1,1,1,1,1", "17828640.5,1,1,1,1,1,1", "99,1,1,1,1,1,1", "1782864000,1,1,1,1,1,1,1", "<script>,1,1,1,1,1,1"]) assert.equal(k.parseRow(bad), null, bad);
});

test("1m bars from trades: in trade-id order, open first, close last", () => {
  const bars = k.tradeBars([
    { p: 2, v: 1, time: 60.5, id: 3 },
    { p: 1, v: 2, time: 60.1, id: 1 },
    { p: 3, v: 1, time: 61, id: 2 },
    { p: 5, v: 1, time: 125, id: 4 },
  ]);
  assert.deepEqual(bars, [
    { t: 60, o: 1, h: 3, l: 1, c: 2, v: 4, n: 3 },
    { t: 120, o: 5, h: 5, l: 5, c: 5, v: 1, n: 1 },
  ]);
});

test("coarser bars: UTC buckets, complete ones only", () => {
  const ones = [0, 60, 120, 240, 300, 360].map((t, i) => ({ t, o: i, h: i + 1, l: i - 1, c: i + 0.5, v: 1, n: 2 }));
  const fives = db.aggregate(ones, 300, 420);
  assert.deepEqual(fives, [{ t: 0, o: 0, h: 4, l: -1, c: 3.5, v: 4, n: 8 }]); // 300's bucket ends at 600, past 420
  assert.equal(db.aggregate(ones, 300).length, 2);
});

test("the next quarter's archive name", () => {
  assert.equal(k.quarterAfter("2026Q3"), "2026Q4");
  assert.equal(k.quarterAfter("2026Q4"), "2027Q1");
});

test("the store's version: a new store and one made before versions both end at the current one", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const fresh = db.openDb(path.join(tmp, "fresh.sqlite"));
  assert.equal(fresh.prepare("PRAGMA user_version").get().user_version, db.SCHEMA);
  fresh.close();
  const file = path.join(tmp, "legacy.sqlite");
  const old = new DatabaseSync(file);
  old.exec("CREATE TABLE series (id INTEGER PRIMARY KEY, exchange TEXT, symbol TEXT, tf INTEGER, UNIQUE (exchange, symbol, tf)); CREATE TABLE sources (id INTEGER PRIMARY KEY, name TEXT UNIQUE); CREATE TABLE bars (series INTEGER, t INTEGER, o REAL, h REAL, l REAL, c REAL, v REAL, n INTEGER, src INTEGER, PRIMARY KEY (series, t)) WITHOUT ROWID; CREATE TABLE state (k TEXT PRIMARY KEY, v TEXT); INSERT INTO bars VALUES (1, 60, 1, 1, 1, 1, 1, 1, 1);");
  old.close();
  const up = db.openDb(file);
  assert.equal(up.prepare("PRAGMA user_version").get().user_version, db.SCHEMA);
  assert.equal(up.prepare("SELECT COUNT(*) AS n FROM bars").get().n, 1);
  up.close();
  // opened again, it stays at the current version (no step runs twice)
  const again = db.openDb(file);
  assert.equal(again.prepare("PRAGMA user_version").get().user_version, db.SCHEMA);
  again.close();
});

test("version 2: Kraken's OHLC fillers for minutes without trades go, real bars stay", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const file = path.join(tmp, "v1.sqlite");
  const v1 = new DatabaseSync(file);
  v1.exec("CREATE TABLE series (id INTEGER PRIMARY KEY, exchange TEXT, symbol TEXT, tf INTEGER, UNIQUE (exchange, symbol, tf)); CREATE TABLE sources (id INTEGER PRIMARY KEY, name TEXT UNIQUE); CREATE TABLE bars (series INTEGER, t INTEGER, o REAL, h REAL, l REAL, c REAL, v REAL, n INTEGER, src INTEGER, PRIMARY KEY (series, t)) WITHOUT ROWID; CREATE TABLE state (k TEXT PRIMARY KEY, v TEXT); PRAGMA user_version = 1;");
  v1.exec("INSERT INTO sources VALUES (1, 'kraken-ohlc'), (2, 'kraken-archive-Full');");
  // a filler, a real OHLC bar, and an archive bar with no volume (kept: not the endpoint's filler)
  v1.exec("INSERT INTO bars VALUES (1, 60, 1, 1, 1, 1, 0, 0, 1), (1, 120, 1, 2, 1, 2, 5, 3, 1), (1, 180, 2, 2, 2, 2, 0, 0, 2);");
  v1.close();
  const up = db.openDb(file);
  assert.deepEqual(up.prepare("SELECT t FROM bars ORDER BY t").all().map((r) => r.t), [120, 180]);
  up.close();
});

test("coarser bars skip fillers: the bucket opens at its first trade", () => {
  const rows = [
    { t: 0, o: 5, h: 5, l: 5, c: 5, v: 0, n: 0 }, // filler at the last close
    { t: 60, o: 7, h: 8, l: 6, c: 7.5, v: 2, n: 4 },
  ];
  assert.deepEqual(db.aggregate(rows, 300), [{ t: 0, o: 7, h: 8, l: 6, c: 7.5, v: 2, n: 4 }]);
});

test("a stretch replaced outright: minutes with no trades lose their stale bars", () => {
  const d = db.openDb(path.join(tmp, "replace.sqlite"));
  const s = db.seriesId(d, "KRAKEN", "XRPUSD", 60),
    src = db.sourceId(d, "test");
  db.upsertBars(d, s, src, [0, 60, 120, 180].map((t) => ({ t, o: 1, h: 1, l: 1, c: 1, v: 1, n: 1 })));
  db.replaceRange(d, s, src, 60, 180, [{ t: 120, o: 2, h: 2, l: 2, c: 2, v: 2, n: 2 }]);
  assert.deepEqual(d.prepare("SELECT t, o FROM bars ORDER BY t").all().map((r) => [r.t, r.o]), [[0, 1], [120, 2], [180, 1]]);
  d.close();
});

test("gaps: an hour whose 1m trade counts don't add up to Kraken's 1h bar", () => {
  const d = db.openDb(path.join(tmp, "gaps.sqlite"));
  const one = db.seriesId(d, "KRAKEN", "XRPUSD", 60),
    hour = db.seriesId(d, "KRAKEN", "XRPUSD", 3600),
    src = db.sourceId(d, "test");
  const bar = (t, n) => ({ t, o: 1, h: 1, l: 1, c: 1, v: 1, n });
  db.upsertBars(d, hour, src, [bar(0, 10), bar(3600, 7)]);
  db.upsertBars(d, one, src, [bar(0, 4), bar(60, 6), bar(3600, 5)]); // the second hour is 2 trades short
  assert.deepEqual(k.mismatchedHours(d, "XRPUSD", 0, 7200).map((r) => [r.t, r.want, r.got]), [[3600, 7, 5]]);
  assert.equal(k.mismatchedHours(d, "NOPE", 0, 7200), null);
  d.close();
});

test("jobs from the page: each taken off the queue, bad ones refused, Automatic and remove applied", async () => {
  const d = db.openDb();
  const s = db.seriesId(d, "KRAKEN", "ATOMUSD", 60);
  db.upsertBars(d, s, db.sourceId(d, "test"), [{ t: 60, o: 1, h: 1, l: 1, c: 1, v: 1, n: 1 }]);
  fs.mkdirSync(db.JOBS_DIR, { recursive: true });
  const put = (name, job) => fs.writeFileSync(path.join(db.JOBS_DIR, name), JSON.stringify(job));
  put("1-a.json", { cmd: "rm -rf /" });
  put("2-b.json", { cmd: "remove", pair: "../../etc" });
  put("3-c.json", { cmd: "automatic", on: false });
  put("4-d.json", { cmd: "remove", pair: "ATOMUSD" });
  fs.writeFileSync(path.join(db.JOBS_DIR, "5-e.json.tmp"), "{"); // a half-written job: cleared, never run
  await k.jobs(d);
  assert.deepEqual(fs.readdirSync(db.JOBS_DIR), []);
  const st = db.readJson(db.STATUS_FILE, {});
  assert.equal(st.kraken.lastJob.cmd, "remove");
  assert.equal(st.kraken.lastJob.ok, true);
  assert.equal(db.readJson(db.SETTINGS_FILE, {}).kraken.automatic, false);
  assert.equal(d.prepare("SELECT COUNT(*) AS n FROM bars").get().n, 0);
  d.close();
});

// Prod's runner starts the importer with a message channel and starts no new run while one is alive. A
// listener on that channel kept every importer alive after its work: one update per restart (23 Oct).
test("started with a message channel, as AskCharts' runner does, the importer exits when its work is done", async () => {
  const { spawn } = await import("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "history-ipc-"));
  const child = spawn(process.execPath, [path.join(import.meta.dirname, "..", "kraken.mjs"), "status"], { env: { ...process.env, HISTORY_DATA: dir }, stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const exited = await Promise.race([new Promise((r) => child.on("exit", (code) => r({ code }))), new Promise((r) => setTimeout(() => r(null), 10000))]);
  if (!exited) child.kill();
  assert.ok(exited, "still running 10 seconds after its work");
  assert.equal(exited.code, 0);
});

// Removing a coin used to leave the store file its size (SQLite keeps freed pages for reuse); now it shrinks
// when enough was freed and the disk has room for the rewrite, and the other coins come through whole.
test("removing a coin shrinks the store when it's worth it and the disk has room", () => {
  const d = db.openDb();
  const src = db.sourceId(d, "test");
  const fill = (pair, n) => {
    const s = db.seriesId(d, "KRAKEN", pair, 60);
    const rows = [];
    for (let i = 0; i < n; i++) rows.push({ t: 60 * i, o: 1 + i / 1e6, h: 2, l: 0.5, c: 1.5, v: 1000 + i, n: 3 });
    db.upsertBars(d, s, src, rows);
  };
  fill("AAAUSD", 150000);
  fill("BBBUSD", 50000);
  d.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const size = () => fs.statSync(db.DB_FILE).size + (fs.existsSync(`${db.DB_FILE}-wal`) ? fs.statSync(`${db.DB_FILE}-wal`).size : 0);
  const full = size();
  // a few MB freed is under the 100 MB that makes a rewrite worth it: removed, the file kept
  assert.equal(k.removePair(d, "AAAUSD"), "removed");
  d.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  assert.ok(size() >= full * 0.95, `${size()} of ${full}`);
  // no room on the disk (a floor far above what's free): it says so and keeps the file
  const set = db.readJson(db.SETTINGS_FILE, {});
  db.writeJson(db.SETTINGS_FILE, { ...set, minFreeGB: 1e9 });
  const skipped = k.shrink(d, { min: 1 });
  assert.match(skipped.skipped, /not enough disk space/);
  db.writeJson(db.SETTINGS_FILE, set);
  // room, and over the threshold: the file shrinks, the other coin's bars are all there, the store checks out
  const r = k.shrink(d, { min: 1 });
  assert.ok(r.after < r.before * 0.6, `${r.before} to ${r.after}`);
  assert.ok(size() < full * 0.6);
  assert.equal(d.prepare("SELECT COUNT(*) AS n FROM bars WHERE series = (SELECT id FROM series WHERE symbol = 'BBBUSD')").get().n, 50000);
  assert.equal(d.prepare("SELECT COUNT(*) AS n FROM series WHERE symbol = 'AAAUSD'").get().n, 0);
  assert.equal(d.prepare("PRAGMA quick_check").get().quick_check, "ok");
  d.close();
});

test("the last whole quarter in Kraken's archive, from its manifest's end date", () => {
  assert.equal(k.quarterEnding("2026-09-30"), "2026Q3");
  assert.equal(k.quarterEnding("2026-03-31"), "2026Q1");
  assert.equal(k.quarterEnding("2026-12-31"), "2026Q4");
  assert.equal(k.quarterEnding("2026-08-15"), "2026Q2"); // partway through Q3: Q3 is left to its own file
  assert.equal(k.quarterEnding("2026-02-10"), "2025Q4");
  assert.equal(k.quarterEnding("soon"), null);
});

// A fresh install's first download: Kraken's Full archive in parts, each checked against Kraken's SHA-256,
// joined, tested, and only then put where the importer reads archives. A part that doesn't match goes and
// comes again; a part that's already whole isn't fetched twice.
test("the first download: Kraken's archive in parts, checked, joined and tested; a bad part comes again", async () => {
  const { createHash } = await import("node:crypto");
  const zip = fs.readFileSync(new URL("./fixtures/kraken-mini.zip", import.meta.url));
  const cut = Math.floor(zip.length / 2),
    parts = [zip.subarray(0, cut), zip.subarray(cut)];
  const name = (i) => `Kraken_OHLCVT_Full.zip.part0${i}`;
  const sums = parts.map((b, i) => `${createHash("sha256").update(b).digest("hex")}  ${name(i)}`).join("\n") + "\n";
  served.set("OHLCVT_Full_PARTS_SHA256SUMS.txt", Buffer.from(sums));
  served.set(name(0), parts[0]);
  // the second part arrives damaged: refused, removed, nothing joined
  const bad = Buffer.from(parts[1]);
  bad[3] ^= 0xff;
  served.set(name(1), bad);
  const raw = path.join(tmp, "raw", "kraken");
  await assert.rejects(k.fullArchive(), /part01 didn't match Kraken's checksum/);
  assert.deepEqual(fs.readdirSync(raw).sort(), [name(0)]);
  // it comes whole the next time; the first part, already whole, isn't fetched again
  served.set(name(1), parts[1]);
  gets.length = 0;
  assert.equal(await k.fullArchive(), true);
  assert.deepEqual(gets, ["OHLCVT_Full_PARTS_SHA256SUMS.txt", name(1)]);
  assert.deepEqual(fs.readdirSync(raw), ["Kraken_OHLCVT_Full.zip"]);
  assert.deepEqual(fs.readFileSync(path.join(raw, "Kraken_OHLCVT_Full.zip")), zip);
  // once it's there, never again
  assert.equal(await k.fullArchive(), false);
  // stopped while its test ran: the whole joined file is tested again, nothing downloaded again
  fs.renameSync(path.join(raw, "Kraken_OHLCVT_Full.zip"), path.join(raw, "Kraken_OHLCVT_Full.zip.joining"));
  gets.length = 0;
  assert.equal(await k.fullArchive(), true);
  assert.deepEqual(gets, ["OHLCVT_Full_PARTS_SHA256SUMS.txt"]);
  assert.deepEqual(fs.readdirSync(raw), ["Kraken_OHLCVT_Full.zip"]);
  // a joined file that won't test (every part matched, so the zip tool is what failed) stays, says why, and is
  // tested again next time: never ten gigabytes again every hour
  const broken = Buffer.from(zip);
  broken.fill(0, 40, 200);
  fs.rmSync(path.join(raw, "Kraken_OHLCVT_Full.zip"));
  fs.writeFileSync(path.join(raw, "Kraken_OHLCVT_Full.zip.joining"), broken);
  await assert.rejects(k.fullArchive(), /came in whole .* couldn't read it/);
  assert.deepEqual(fs.readdirSync(raw), ["Kraken_OHLCVT_Full.zip.joining"]);
  gets.length = 0;
  await assert.rejects(k.fullArchive(), /couldn't read it/);
  assert.deepEqual(gets, ["OHLCVT_Full_PARTS_SHA256SUMS.txt"]);
  fs.rmSync(raw, { recursive: true });
});

