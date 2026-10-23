// lib/onchain.js: the XRP Ledger store, read only, summed into buckets for XRPL On chain.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qt-onchain-"));
const file = path.join(dir, "xrpl.sqlite");
process.env.QT_ONCHAIN = file;
const { xrpl, XRPL_COLS, DEX_COLS } = await import("../lib/onchain.js");

test("no store yet: empty, with the reason", () => {
  const r = xrpl({ from: 0, to: 100, step: 60 });
  assert.deepEqual(r.buckets, []);
  assert.match(r.reason, /No XRP Ledger data yet/);
});

test("buckets by placement time, big payments from the floor up, bad input refused", async () => {
  // the collector's layout, the columns this reads (onchain/db.mjs at the repo root has the whole of it)
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE ledgers (idx INTEGER PRIMARY KEY, close INTEGER, res INTEGER, t INTEGER, seen INTEGER, ${XRPL_COLS.map((c) => `${c} REAL`).join(", ")});
    CREATE TABLE whales (hash TEXT PRIMARY KEY, idx INTEGER, src TEXT, dst TEXT, tag INTEGER, xrp REAL, src_name TEXT, dst_name TEXT);`);
  const ins = db.prepare(`INSERT INTO ledgers (idx, close, res, t, ${XRPL_COLS.join(", ")}) VALUES (?, ?, 10, ?, ${XRPL_COLS.map(() => "?").join(", ")})`);
  const T = 1761000000;
  [[1, T + 2], [2, T + 6], [3, T + 63], [4, T + 125]].forEach(([idx, t]) => ins.run(idx, t, t, ...XRPL_COLS.map((c, k) => (c === "xrp" ? 1.5 : k + 1))));
  db.prepare("INSERT INTO whales VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("A", 2, "rX", "rY", 7, 2e6, null, "Binance");
  db.prepare("INSERT INTO whales VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("B", 3, "rX", "rY", null, 2e5, null, null);
  db.close();
  // the reader opens a store at most once a minute; this one appeared after the first look
  const mod = await import(`../lib/onchain.js?again=${Date.now()}`);
  const r = mod.xrpl({ from: T - 600, to: T + 600, step: 60, min: 1000000 });
  assert.deepEqual(r.cols, [...XRPL_COLS, ...DEX_COLS, "dex_n", "last", "first"]);
  // a store from before the DEX columns: they read NULL, none counted, no start
  assert.deepEqual(r.buckets[0].slice(2 + XRPL_COLS.length, 2 + XRPL_COLS.length + DEX_COLS.length + 1), [...DEX_COLS.map(() => null), 0]);
  assert.equal(r.dexFirst, null);
  // [start, ledgers, txs, ..., last ledger, first ledger]
  assert.deepEqual(r.buckets.map((b) => [b[0], b[1], b[2], b[2 + XRPL_COLS.indexOf("xrp")], b.at(-2), b.at(-1)]), [[T, 2, 2, 3, 2, 1], [T + 60, 1, 1, 1.5, 3, 3], [T + 120, 1, 1, 1.5, 4, 4]]);
  assert.deepEqual(r.whales.map((w) => [w.hash, w.t, w.dstName, w.tag]), [["A", T + 6, "Binance", 7]]);
  assert.equal(r.first, T + 2);
  assert.equal(mod.xrpl({ from: T, to: T + 600, step: 60, min: 0 }).whales.length, 2);
  assert.throws(() => mod.xrpl({ from: T, to: T - 1, step: 60 }), /to must be after from/);
  assert.throws(() => mod.xrpl({ from: "x", to: T, step: 60 }), (e) => e.status === 400);
  assert.throws(() => mod.xrpl({ from: T, to: T + 60, step: 0 }), /step/);
});

test("a store with the DEX columns: summed where counted, how many were counted, and where counting began", async () => {
  const f2 = path.join(dir, "xrpl2.sqlite");
  const db = new DatabaseSync(f2);
  db.exec(`CREATE TABLE ledgers (idx INTEGER PRIMARY KEY, close INTEGER, res INTEGER, t INTEGER, seen INTEGER, ${[...XRPL_COLS, ...DEX_COLS].map((c) => `${c} REAL`).join(", ")});
    CREATE TABLE whales (hash TEXT PRIMARY KEY, idx INTEGER, src TEXT, dst TEXT, tag INTEGER, xrp REAL, src_name TEXT, dst_name TEXT);`);
  const ins = db.prepare(`INSERT INTO ledgers (idx, close, res, t, ${[...XRPL_COLS, ...DEX_COLS].join(", ")}) VALUES (?, ?, 10, ?, ${[...XRPL_COLS, ...DEX_COLS].map(() => "?").join(", ")})`);
  const T = 1761000000;
  // two ledgers before counting began, then two counted, all in one minute
  [[1, T + 2, null], [2, T + 6, null], [3, T + 30, 2], [4, T + 40, 3]].forEach(([idx, t, got]) => ins.run(idx, t, t, ...XRPL_COLS.map(() => 1), ...DEX_COLS.map((c) => (got == null ? null : c === "dex_got" ? got : 1))));
  db.close();
  process.env.QT_ONCHAIN = f2;
  const mod = await import(`../lib/onchain.js?dex=${Date.now()}`);
  const r = mod.xrpl({ from: T - 60, to: T + 60, step: 60 });
  const at = (b, c) => b[2 + r.cols.indexOf(c)];
  assert.equal(at(r.buckets[0], "dex_got"), 5);
  assert.equal(at(r.buckets[0], "dex_n"), 2);
  assert.equal(r.buckets[0][1], 4);
  assert.equal(r.dexFirst, T + 30);
  fs.rmSync(dir, { recursive: true });
});
