// The Binance history (history/binance.mjs) against a stand-in data.binance.vision and market-data API: real zips
// with their checksums, milliseconds before 2025 and microseconds after, a month not filed yet, a damaged file,
// pages from the API, the page's jobs. No network. Run: node --test history/test/binance.test.mjs
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import { deflateRawSync, crc32 } from "node:zlib";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "binance-test-"));
process.env.HISTORY_DATA = tmp;

// a zip of one file, as Binance's are (deflated, one entry)
function makeZip(name, body) {
  const data = deflateRawSync(body),
    nameBuf = Buffer.from(name),
    crc = crc32(body);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(data.length, 20);
  cd.writeUInt32LE(body.length, 24);
  cd.writeUInt16LE(nameBuf.length, 28);
  cd.writeUInt32LE(0, 42);
  const cdAt = 30 + nameBuf.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + nameBuf.length, 12);
  end.writeUInt32LE(cdAt, 16);
  return Buffer.concat([local, nameBuf, data, cd, nameBuf, end]);
}

// the stand-in: a pair listed in November 2024, "now" 10 February 2025 at noon
const DAY = 86400;
const LISTED = Date.UTC(2024, 10, 1) / 1000;
const NOW = Date.UTC(2025, 1, 10, 12) / 1000;
const TF = { "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86400, "1M": 0 };
const unit = (t) => (t >= Date.UTC(2025, 0, 1) / 1000 ? 1e6 : 1e3); // microseconds from 2025, as Binance's files
const bar = (t, sec, u = unit(t)) => {
  const p = 100 + Math.sin(t / 7200) * 3;
  // a minute with no trades now and then, as Binance has (volume 0, price flat)
  const quiet = sec === 60 && t % 7 === 0;
  return [t * u, p, quiet ? p : p + 0.2, quiet ? p : p - 0.2, quiet ? p : p + 0.05, quiet ? 0 : 12.5, (t + sec) * u - 1, 1000, quiet ? 0 : 9, 1, 1, 0];
};
const bars = (sec, from, to, u) => {
  const out = [];
  for (let t = Math.ceil(from / sec) * sec; t < to; t += sec) if (t >= LISTED) out.push(bar(t, sec, u));
  return out;
};
let clock = NOW; // the API's now
const notFiled = new Set(); // file paths answered 404
const damaged = new Set();
const gets = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  gets.push(u.pathname + u.search);
  const m = /^\/data\/spot\/(monthly|daily)\/klines\/(\w+)\/(\w+)\/\w+-\w+-([\d-]+)\.zip(\.CHECKSUM)?$/.exec(u.pathname);
  if (m) {
    const [, kind, pair, name, when, sum] = m;
    const file = u.pathname.replace(/\.CHECKSUM$/, "");
    if (pair !== "TESTUSDT" || notFiled.has(file)) return res.writeHead(404).end();
    const from = Date.parse(kind === "monthly" ? `${when}-01T00:00:00Z` : `${when}T00:00:00Z`) / 1000;
    const to = kind === "monthly" ? Date.UTC(new Date(from * 1000).getUTCFullYear(), new Date(from * 1000).getUTCMonth() + 1, 1) / 1000 : from + DAY;
    if (to > NOW - (kind === "daily" ? 0 : 0) && from >= Math.floor(NOW / DAY) * DAY) return res.writeHead(404).end();
    const csv = bars(TF[name], from, to).map((r) => r.join(",")).join("\n");
    const zip = makeZip(path.basename(file).replace(/\.zip$/, ".csv"), Buffer.from(csv));
    const hash = createHash("sha256").update(damaged.has(file) ? Buffer.from("other") : zip).digest("hex");
    return res.writeHead(200).end(sum ? `${hash}  ${path.basename(file)}` : zip);
  }
  if (u.pathname === "/api/v3/klines") {
    const sym = u.searchParams.get("symbol"),
      name = u.searchParams.get("interval"),
      start = Number(u.searchParams.get("startTime")) / 1000,
      limit = Number(u.searchParams.get("limit"));
    if (sym !== "TESTUSDT") return res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ code: -1121, msg: "Invalid symbol." }));
    if (name === "1M") return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify([[LISTED * 1000, 1, 1, 1, 1, 1, 0, 0, 1]]));
    // the API gives milliseconds, and the bar still forming too
    const rows = bars(TF[name], start, clock + TF[name], 1e3).slice(0, limit);
    return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(rows.map((r) => r.map(String))));
  }
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
process.env.BINANCE_FILES = process.env.BINANCE_API = `http://127.0.0.1:${server.address().port}`;
const store = await import("../db.mjs");
const binance = await import("../binance.mjs");
const db = store.openDb();
after(() => {
  server.close();
  db.close();
});
const rows = (tf, pair = "TESTUSDT") => db.prepare("SELECT t, o, v, n FROM bars b JOIN series s ON s.id = b.series WHERE s.exchange = 'BINANCE' AND s.symbol = ? AND s.tf = ? ORDER BY t").all(pair, tf);

test("Binance's times: milliseconds before 2025, microseconds after", () => {
  assert.equal(binance.seconds(1502942400000), 1502942400);
  assert.equal(binance.seconds(1788220800000000), 1788220800);
  assert.equal(binance.seconds("1788220859999999"), 1788220859);
});

test("a zip read in memory; a file's rows, a header skipped", () => {
  const csv = "open_time,open,high,low,close,volume,close_time,qv,trades,a,b,c\n1502942400000,4261.48,4261.48,4261.48,4261.48,1.775183,1502942459999,7564.9,3,0.07,320.3,0\n";
  const parsed = binance.parseRows(binance.unzipOne(makeZip("x.csv", Buffer.from(csv))));
  assert.deepEqual(parsed, [{ t: 1502942400, o: 4261.48, h: 4261.48, l: 4261.48, c: 4261.48, v: 1.775183, n: 3 }]);
  assert.throws(() => binance.unzipOne(Buffer.from("not a zip")), /not a zip/);
});

test("a first download: months, then this month's days, then today from the API; every interval", async () => {
  // January's monthly 1m file isn't out yet: its days fill in for it
  notFiled.add("/data/spot/monthly/klines/TESTUSDT/1m/TESTUSDT-1m-2025-01.zip");
  gets.length = 0;
  await binance.updatePair(db, "TESTUSDT", NOW);
  const m1 = rows(60);
  assert.equal(m1[0].t, LISTED, "from the first month");
  assert.equal(m1.length, (NOW - LISTED) / 60, "every finished minute to now, quiet ones too");
  assert.ok(m1.some((r) => r.v === 0 && r.n === 0), "a minute without trades kept, as Binance's charts show it");
  assert.ok(gets.some((g) => g.includes("daily/klines/TESTUSDT/1m/TESTUSDT-1m-2025-01-15.zip")), "January from its days");
  assert.ok(gets.some((g) => g.includes("daily/klines/TESTUSDT/1m/TESTUSDT-1m-2025-02-09.zip")), "this month's days");
  assert.ok(gets.some((g) => g.startsWith("/api/v3/klines?symbol=TESTUSDT&interval=1m")), "today from the API");
  for (const [name, sec] of Object.entries(binance.TFS)) {
    const r = rows(sec);
    assert.ok(r.length > 0 && r.at(-1).t + sec <= NOW, `${name}: finished bars only`);
  }
  assert.equal(rows(86400).length, (Math.floor(NOW / 86400) * 86400 - LISTED) / 86400);
  const st = JSON.parse(fs.readFileSync(path.join(tmp, "status.json"), "utf8")).binance.pairs.TESTUSDT;
  assert.deepEqual([st.first, st.bars], [LISTED, m1.length]);
});

test("the next update reads only the API from the last bar", async () => {
  gets.length = 0;
  clock = NOW + 3600;
  await binance.updatePair(db, "TESTUSDT", NOW + 3600);
  clock = NOW;
  assert.ok(gets.every((g) => g.startsWith("/api/")), gets.slice(0, 3).join(" "));
  assert.equal(rows(60).length, (NOW + 3600 - LISTED) / 60);
});

test("a file that doesn't match its checksum stops the download, and says which", async () => {
  damaged.add("/data/spot/monthly/klines/TESTUSDT/1m/TESTUSDT-1m-2024-11.zip");
  db.prepare("DELETE FROM bars").run();
  await assert.rejects(binance.updatePair(db, "TESTUSDT", NOW), /TESTUSDT-1m-2024-11\.zip doesn't match Binance's checksum/);
  damaged.clear();
});

test("the page's jobs: start, a pair Binance doesn't have refused, remove", async () => {
  db.prepare("DELETE FROM bars").run();
  assert.equal(await binance.job(db, { source: "binance", cmd: "start", pairs: ["TESTUSDT"] }), "downloaded");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tmp, "settings.json"), "utf8")).binance, { pairs: ["TESTUSDT"], automatic: true });
  await assert.rejects(binance.job(db, { cmd: "add", pair: "NOPEUSDT" }), /Invalid symbol/);
  await assert.rejects(binance.job(db, { cmd: "add", pair: "not a pair" }), /Binance names like BTCUSDT/);
  assert.equal(await binance.job(db, { cmd: "remove", pair: "TESTUSDT" }), "removed TESTUSDT");
  assert.equal(rows(60).length, 0);
});
