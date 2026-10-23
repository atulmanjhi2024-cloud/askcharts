// Alerts on XRPL On chain indicators: the server reads the XRP Ledger store for the alert's bars, as the chart
// does, so a condition on XRPL Network or Exchange flows works like one on RSI. A small store made here.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qt-alerts-onchain-"));
process.env.QT_DATA_DIR = dir;
process.env.QT_ONCHAIN = path.join(dir, "xrpl.sqlite");
const T = 1761000000 - (1761000000 % 3600);
{
  const db = new DatabaseSync(process.env.QT_ONCHAIN);
  db.exec(`CREATE TABLE ledgers (idx INTEGER PRIMARY KEY, close INTEGER, res INTEGER, t INTEGER, seen INTEGER, txs INTEGER, failed INTEGER,
    batch INTEGER, money INTEGER, markets INTEGER, nfts INTEGER, accounts INTEGER, other INTEGER, xrp REAL, pays INTEGER, ex_in REAL,
    ex_out REAL, fees INTEGER, created INTEGER);
    CREATE TABLE whales (hash TEXT, idx INTEGER, src TEXT, dst TEXT, tag INTEGER, xrp REAL, src_name TEXT, dst_name TEXT);`);
  const add = db.prepare("INSERT INTO ledgers (idx, close, res, t, seen, txs, failed, batch, money, markets, nfts, accounts, other, xrp, pays, ex_in, ex_out, fees, created) VALUES (?, ?, 10, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?, ?, ?)");
  // hour 0: quiet; hour 1: a burst of new accounts and 6M XRP into exchanges; hour 2: quiet again
  add.run(100, T + 10, T + 10, T + 12, 50, 1e6, 2e5, 5000, 20);
  add.run(101, T + 3600 + 5, T + 3600 + 5, T + 3600 + 7, 80, 6e6, 1e6, 9000, 400);
  add.run(102, T + 7200 + 5, T + 7200 + 5, T + 7200 + 7, 40, 5e5, 1e5, 3000, 15);
  db.close();
}
const { withOnchain, add } = await import("../lib/alerts.js");
const { conditionFn } = await import("../public/lib/backtest.js");
const bars = [0, 1, 2, 3].map((i) => ({ time: T + i * 3600, open: 1, high: 1, low: 1, close: 1, volume: 1 }));

test("an alert's XRPL indicator gets the store's buckets for the alert's own bars", () => {
  const ind = withOnchain(bars, "1h", { net: { id: "xrpl_network", params: {} }, rsi: { id: "rsi", params: { length: 14 } } });
  assert.equal(ind.rsi.params.__onchain, undefined, "other indicators are left as they are");
  const d = ind.net.params.__onchain;
  assert.equal(d.tf, 3600);
  assert.deepEqual(d.rows.map((r) => r[0]), [T, T + 3600, T + 7200]);
  // a condition on it works as on any indicator: new accounts over 300 in a bar
  const over = conditionFn(bars, ind)({ left: "net.created", op: ">", right: 300 });
  assert.deepEqual([0, 1, 2, 3].map(over), [false, true, false, false]);
  // XRP into exchanges crossing 5M
  const fx = withOnchain(bars, "1h", { fx: { id: "xrpl_exchanges", params: {} } });
  const cross = conditionFn(bars, fx)({ left: "fx.in", op: "crossesAbove", right: 5e6 });
  assert.deepEqual([0, 1, 2].map(cross), [false, true, false]);
});

test("one read of the store serves every alert on the same bars", () => {
  const cache = {};
  const a = withOnchain(bars, "1h", { n: { id: "xrpl_network", params: {} } }, cache);
  const b = withOnchain(bars, "1h", { f: { id: "xrpl_exchanges", params: {} } }, cache);
  assert.equal(a.n.params.__onchain, b.f.params.__onchain);
});

test("bars the store has no ledgers for: the alert says so, not 'no output'", () => {
  const before = bars.map((b) => ({ ...b, time: b.time - 30 * 86400 }));
  const ind = withOnchain(before, "1h", { net: { id: "xrpl_network", params: {} } });
  assert.throws(() => conditionFn(before, ind)({ left: "net.created", op: ">", right: 1 }), /No XRP Ledger data/);
});

test("XRPL Network names the one output its Show computes, so an alert offers only that", async () => {
  const { BY_ID } = await import("../public/lib/indicators.js");
  assert.deepEqual(BY_ID.xrpl_network.outputsFor({}), ["created"]);
  assert.deepEqual(BY_ID.xrpl_network.outputsFor({ show: "Fees burned (XRP)" }), ["burned"]);
  assert.deepEqual(BY_ID.xrpl_network.outputsFor({ show: "Average fee (drops)" }), ["fee"]);
});

test("an alert on an XRPL indicator can be saved", () => {
  const a = add({ symbol: "BINANCE:XRPUSDT", tf: "1h", conditions: [{ left: "net.created", op: ">", right: 300 }], indicators: { net: { id: "xrpl_network", params: { show: "New accounts" } } } });
  assert.ok(a.id);
});
