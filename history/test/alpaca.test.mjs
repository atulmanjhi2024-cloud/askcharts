// The stock history (history/alpaca.mjs) against a stand-in Alpaca: no real key, no network. The session as the
// app has it, splits found, pages followed, a slow down waited out, only the regular session kept, coarser bars
// built, the key never written down, the page's jobs, and Kraken's first download not fooled by stock bars.
// Run: node --test history/test/alpaca.test.mjs
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "alpaca-test-"));
process.env.HISTORY_DATA = tmp;
const KEY = { keyId: "PKTESTKEY0001", secretKey: "test-secret-alpaca-0001" };
fs.writeFileSync(path.join(tmp, "feeds.json"), JSON.stringify({ alpaca: { ...KEY, feed: "iex" } }));
process.env.FEEDS_FILE = path.join(tmp, "feeds.json");
process.env.ALPACA_PACE_MS = "0";
process.env.ALPACA_SLOW_MS = "20";

// Alpaca, played locally: three trading days of minutes (pre-market and after hours too, which the importer
// drops), daily bars, pages of PAGE bars, a 429 when asked, and a split when asked
const DAY = 86400;
const FIRST = Date.UTC(2026, 9, 21) / 1000; // Wed 21 Oct 2026 (New York on daylight time: 09:30 is 13:30 UTC)
const PAGE = 500;
const calls = [];
let slowDowns = 0,
  splitFactor = 1;
const minutes = [];
for (let d = 0; d < 3; d++)
  for (let m = 12 * 60; m < 21 * 60; m++) {
    const t = FIRST + d * DAY + m * 60; // 08:00 to 17:00 New York
    const p = 100 + d + m / 1000;
    minutes.push({ t, o: p, h: p + 0.05, l: p - 0.05, c: p + 0.01, v: 100 + (m % 7), n: 3 });
  }
const days = [];
for (let d = -40; d < 3; d++) {
  const t = FIRST + d * DAY;
  if ([0, 6].includes(new Date(t * 1000).getUTCDay())) continue;
  days.push({ t: t + 4 * 3600, o: 99, h: 101, l: 98, c: 100 + d / 100, v: 1e6, n: 9000 }); // Alpaca's daily bar time: midnight New York
}
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  calls.push({ path: u.pathname, q: Object.fromEntries(u.searchParams), id: req.headers["apca-api-key-id"], secret: req.headers["apca-api-secret-key"] });
  const json = (status, o) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(o));
  if (req.headers["apca-api-key-id"] !== KEY.keyId || req.headers["apca-api-secret-key"] !== KEY.secretKey) return json(401, { message: "forbidden" });
  if (slowDowns > 0) {
    slowDowns--;
    return json(429, { message: "too many requests" });
  }
  const q = u.searchParams,
    sym = q.get("symbols"),
    from = Date.parse(q.get("start")) / 1000,
    to = Date.parse(q.get("end")) / 1000;
  const all = (q.get("timeframe") === "1Day" ? days.map((b) => ({ ...b, c: b.c * splitFactor })) : minutes).filter((b) => b.t >= from && b.t <= to);
  const at = Number(q.get("page_token") || 0);
  const page = all.slice(at, at + PAGE);
  json(200, {
    bars: { [sym]: page.map((b) => ({ t: new Date(b.t * 1000).toISOString(), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, n: b.n })) },
    next_page_token: at + PAGE < all.length ? String(at + PAGE) : null,
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
process.env.ALPACA_DATA_BASE = `http://127.0.0.1:${server.address().port}`;
const store = await import("../db.mjs");
const alpaca = await import("../alpaca.mjs");
const kraken = await import("../kraken.mjs");
const db = store.openDb();
after(() => {
  server.close();
  db.close();
});
const NOW = FIRST + 3 * DAY; // midnight UTC after the third day
const series = (tf) => db.prepare("SELECT id FROM series WHERE exchange = 'US' AND symbol = 'AAPL' AND tf = ?").get(tf)?.id;
const rows = (tf) => db.prepare("SELECT t, o, h, l, c, v FROM bars WHERE series = ? ORDER BY t").all(series(tf));

test("New York's regular session, across both clock changes", () => {
  const ny = (y, mo, d, h, m) => Date.UTC(y, mo - 1, d, h, m) / 1000;
  // daylight time: 09:30 New York is 13:30 UTC; standard time: 14:30 UTC
  assert.ok(alpaca.inUsSession(ny(2026, 10, 23, 13, 30)) && !alpaca.inUsSession(ny(2026, 10, 23, 13, 29)));
  assert.ok(alpaca.inUsSession(ny(2026, 10, 23, 19, 59)) && !alpaca.inUsSession(ny(2026, 10, 23, 20, 0)));
  assert.ok(alpaca.inUsSession(ny(2026, 11, 2, 14, 30)) && !alpaca.inUsSession(ny(2026, 11, 2, 13, 30)));
  assert.ok(alpaca.inUsSession(ny(2026, 3, 9, 13, 30)) && !alpaca.inUsSession(ny(2026, 3, 6, 13, 30)));
});

test("the session matches the app's own (lib/feeds.js), minute by minute over two clock changes", async () => {
  // the app sits at quant-terminal/ in my repo and at app/ in a release
  process.env.QT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "alpaca-app-"));
  let feeds = null;
  for (const p of ["../../quant-terminal/lib/feeds.js", "../../app/lib/feeds.js"])
    if (fs.existsSync(new URL(p, import.meta.url))) feeds = await import(p);
  assert.ok(feeds, "the app's lib/feeds.js");
  for (const day of [Date.UTC(2026, 2, 6), Date.UTC(2026, 2, 9), Date.UTC(2026, 9, 30), Date.UTC(2026, 10, 2)])
    for (let t = day / 1000; t < day / 1000 + DAY; t += 60) assert.equal(alpaca.inUsSession(t), feeds.inUsSession(t), new Date(t * 1000).toISOString());
});

test("a split: every recent day off by the same factor; a day or two off isn't one", () => {
  const stored = [1, 2, 3, 4, 5].map((d) => ({ t: d * DAY, c: 200 + d }));
  assert.equal(alpaca.splitSince(stored, stored.map((b) => ({ ...b, c: b.c / 2 }))), 0.5);
  assert.equal(alpaca.splitSince(stored, stored), null);
  assert.equal(alpaca.splitSince(stored, stored.map((b, i) => ({ ...b, c: i === 4 ? b.c * 1.3 : b.c }))), null, "today's bar still forming");
  assert.equal(alpaca.splitSince(stored.slice(0, 2), stored.slice(0, 2).map((b) => ({ ...b, c: b.c / 2 }))), null, "too few days to tell");
});

test("a first download: pages followed, a slow down waited out, the regular session only, coarser bars built", async () => {
  slowDowns = 1;
  calls.length = 0;
  const n = await alpaca.updateSymbol(db, "AAPL", KEY, NOW);
  assert.equal(n, 3 * 390, "390 minutes a day");
  assert.ok(calls.filter((c) => c.q.timeframe === "1Min").length >= 3, "followed the pages");
  assert.ok(calls.every((c) => c.q.feed === "sip" && c.q.adjustment === "split"));
  assert.ok(Date.parse(calls.at(-1).q.end) / 1000 <= NOW - 15 * 60, "ends at least 15 minutes back");
  const m1 = rows(60);
  assert.ok(m1.every((b) => alpaca.inUsSession(b.t)));
  assert.equal(new Date(m1[0].t * 1000).toISOString(), "2026-10-21T13:30:00.000Z");
  // 30m: 13 a day, the first one 09:30 to 10:00 made from its 30 minutes
  const m30 = rows(1800);
  assert.equal(m30.length, 39);
  const first30 = m1.filter((b) => b.t >= m30[0].t && b.t < m30[0].t + 1800);
  assert.deepEqual({ ...m30[0] }, { t: first30[0].t, o: first30[0].o, h: Math.max(...first30.map((b) => b.h)), l: Math.min(...first30.map((b) => b.l)), c: first30.at(-1).c, v: first30.reduce((s, b) => s + b.v, 0) });
  assert.equal(rows(300).length, 3 * 78);
  assert.equal(rows(900).length, 3 * 26);
  assert.equal(series(3600), undefined, "1h is built from 30m when read, as live charts build it");
  // daily bars as the trading date at UTC midnight
  assert.ok(rows(DAY).every((b) => b.t % DAY === 0));
  assert.ok(rows(DAY).some((b) => b.t === FIRST));
});

test("the next update asks only for what's new; a split means downloading it again", async () => {
  calls.length = 0;
  const before = rows(60).length;
  assert.equal(await alpaca.updateSymbol(db, "AAPL", KEY, NOW + 3600), 0);
  assert.equal(rows(60).length, before);
  assert.ok(Date.parse(calls.find((c) => c.q.timeframe === "1Min")?.q.start ?? calls.at(-1).q.start) / 1000 > NOW - 2 * DAY, "from the last bar, not from 2016");
  // a 2-for-1 split: Alpaca's adjusted closes are half the stored ones
  splitFactor = 0.5;
  calls.length = 0;
  await alpaca.updateSymbol(db, "AAPL", KEY, NOW + 7200);
  assert.ok(calls.some((c) => c.q.timeframe === "1Min" && Date.parse(c.q.start) / 1000 === alpaca.SINCE), "downloaded again from 2016");
  const d = rows(DAY).find((b) => b.t === FIRST);
  assert.equal(d.c, days.find((b) => b.t - 4 * 3600 === FIRST).c * 0.5);
  splitFactor = 1;
});

test("the page's jobs: start, a bad ticker refused, remove; the key never written down", async () => {
  await alpaca.job(db, { source: "alpaca", cmd: "start", symbols: ["SPY", "BRK.B"] });
  const set = JSON.parse(fs.readFileSync(path.join(tmp, "settings.json"), "utf8")).alpaca;
  assert.deepEqual(set, { symbols: ["SPY", "BRK.B"], automatic: true });
  await assert.rejects(alpaca.job(db, { cmd: "add", symbol: "not a ticker" }), /tickers are like AAPL/);
  assert.equal(await alpaca.job(db, { cmd: "remove", symbol: "SPY" }), "removed SPY");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bars b JOIN series s ON s.id = b.series WHERE s.symbol = 'SPY'").get().n, 0);
  const st = fs.readFileSync(path.join(tmp, "status.json"), "utf8");
  assert.ok(!st.includes(KEY.secretKey) && !st.includes(KEY.keyId));
  assert.ok(JSON.parse(st).alpaca.symbols["BRK.B"].bars > 0);
});

test("a key Alpaca refuses: said so, without the key", async () => {
  await assert.rejects(alpaca.updateSymbol(db, "AAPL", { keyId: "PKWRONG", secretKey: "wrong-secret-0001" }, NOW), (e) => /didn't accept the key/.test(e.message) && !e.message.includes("wrong-secret-0001"));
});

test("stock bars don't count as Kraken's: Kraken's first download still happens", () => {
  assert.equal(kraken.hasKrakenBars(db), false, "only US bars so far");
  const s = store.seriesId(db, "KRAKEN", "XBTUSD", 60);
  store.upsertBars(db, s, store.sourceId(db, "kraken-ohlc"), [{ t: FIRST, o: 1, h: 1, l: 1, c: 1, v: 1, n: 1 }]);
  assert.equal(kraken.hasKrakenBars(db), true);
});
