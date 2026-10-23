// Offline tests of the XRP Ledger collector's pieces. node --test onchain/test/xrpl.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { summarize, place, ranges, RIPPLE_EPOCH, FAMILY_OF, EXCHANGES, DEX_COLS } from "../xrpl-ledger.mjs";
import { openDb, saveLedger, missing, prune, relabel, span, SCHEMA } from "../db.mjs";

const BINANCE = "rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh";
const BINANCE2 = "rNxp4h8apvRis6mJf9Sh8C6iRxfrDWN7AV";
const KRAKEN = "rLHzPsX6oXkzU2qL12kHCH8G8cnZv1rBJh";
const A = "rAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const B = "rBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const ok = { TransactionResult: "tesSUCCESS" };
const tx = (tx_json, meta = ok, hash = Math.random().toString(16).slice(2)) => ({ hash, tx_json: { Fee: "12", Flags: 0, ...tx_json }, meta });
const pay = (Account, Destination, drops, extra = {}) => tx({ TransactionType: "Payment", Account, Destination, ...extra }, { ...ok, delivered_amount: String(drops) });
const ledger = (idx, close, transactions) => ({ ledger_index: idx, close_time: close - RIPPLE_EPOCH, close_time_resolution: 10, transactions });

test("summarize: families, Batch and failed apart, XRP moved, exchanges, fees, new accounts", () => {
  const { row, whales } = summarize(
    ledger(100, 1761000030, [
      pay(A, B, 5_000_000), // 5 XRP between two accounts
      pay(A, A, 9_000_000), // to itself (a conversion): not moved
      tx({ TransactionType: "Payment", Account: A, Destination: B }, { ...ok, delivered_amount: { currency: "USD", issuer: B, value: "10" } }),
      tx({ TransactionType: "Payment", Account: A, Destination: B }, { TransactionResult: "tecPATH_DRY" }),
      tx({ TransactionType: "Batch", Account: A, RawTransactions: [{}, {}] }),
      pay(A, B, 1_000_000, { Flags: 0x40000000, Fee: "0" }), // a Batch's inner payment that applied
      tx({ TransactionType: "OfferCreate", Account: A }),
      tx({ TransactionType: "NFTokenMint", Account: A }),
      tx({ TransactionType: "TrustSet", Account: A }),
      tx({ TransactionType: "OracleSet", Account: A }),
      tx({ TransactionType: "Payment", Account: A, Destination: "rNEW" }, { ...ok, delivered_amount: "20000000", AffectedNodes: [{ CreatedNode: { LedgerEntryType: "AccountRoot" } }] }),
      pay(A, BINANCE, 200_000_000_000, { DestinationTag: 12345 }), // 200k XRP into Binance
      pay(KRAKEN, B, 3_000_000), // out of Kraken
      pay(BINANCE, BINANCE2, 7_000_000), // Binance's own wallets
      pay(BINANCE, KRAKEN, 4_000_000), // one exchange to another
    ]),
  );
  assert.equal(row.idx, 100);
  assert.equal(row.close, 1761000030);
  assert.equal(row.txs, 15);
  assert.equal(row.batch, 1);
  assert.equal(row.failed, 1);
  assert.equal(row.money, 9); // every successful payment, the inner one included
  assert.deepEqual([row.markets, row.nfts, row.accounts, row.other], [1, 1, 1, 1]);
  assert.equal(row.created, 1);
  assert.equal(row.pays, 7);
  assert.equal(row.xrp, 5 + 1 + 20 + 200_000 + 3 + 7 + 4);
  assert.equal(row.ex_in, 200_000);
  assert.equal(row.ex_out, 3);
  assert.equal(row.fees, 14 * 12);
  assert.equal(whales.length, 1);
  assert.deepEqual({ ...whales[0], hash: undefined }, { hash: undefined, idx: 100, src: A, dst: BINANCE, tag: 12345, xrp: 200_000, src_name: null, dst_name: "Binance" });
});

test("summarize: api_version 1 shape, and a ledger without expanded transactions is refused", () => {
  const v1 = { ledger_index: "7", close_time: 10, close_time_resolution: 10, transactions: [{ TransactionType: "Payment", Account: A, Destination: B, Fee: "10", hash: "H", metaData: { ...ok, delivered_amount: "150000000000" } }] };
  const { row, whales } = summarize(v1);
  assert.equal(row.idx, 7);
  assert.equal(row.close, 10 + RIPPLE_EPOCH);
  assert.equal(row.xrp, 150_000);
  assert.equal(whales[0].hash, "H");
  assert.throws(() => summarize({ ledger_index: 1, close_time: 1, transactions: ["ABC"] }), /expanded/);
});

test("the families: every type in one, newer ones included", () => {
  for (const [t, f] of [["Payment", "money"], ["CheckCash", "money"], ["AMMCreate", "markets"], ["NFTokenCancelOffer", "nfts"], ["NFTokenModify", "nfts"], ["AccountDelete", "accounts"], ["TicketCreate", "accounts"]]) assert.equal(FAMILY_OF[t], f, t);
  assert.equal(FAMILY_OF.OracleSet, undefined);
  assert.equal(FAMILY_OF.Batch, undefined);
  for (const a of Object.keys(EXCHANGES)) assert.match(a, /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/, a);
});

test("place: ledgers spread across their rounded window", () => {
  const w = (closes) => place(closes.map((close) => ({ close, res: 10 })));
  assert.deepEqual(w([30, 31, 32]), [27, 30, 33]);
  assert.deepEqual(w([40, 41]), [38, 43]);
  assert.deepEqual(w([20]), [20]);
});

test("ranges", () => {
  assert.deepEqual(ranges("107757613-107808936"), [[107757613, 107808936]]);
  assert.deepEqual(ranges("5-9,12,20-30"), [[5, 9], [12, 12], [20, 30]]);
  assert.deepEqual(ranges(""), []);
  assert.deepEqual(ranges("empty"), []);
});

const tmpDb = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xrpl-test-"));
  return { db: openDb(path.join(dir, "x.sqlite")), dir };
};

test("store: layout version, placement redone as a window fills, seen kept", () => {
  const { db, dir } = tmpDb();
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, SCHEMA);
  const T = 1761000030;
  saveLedger(db, summarize(ledger(10, T + 1, []), { seen: T + 4 }));
  assert.equal(db.prepare("SELECT t FROM ledgers WHERE idx = 10").get().t, T); // alone in its window: the middle
  saveLedger(db, summarize(ledger(9, T, [pay(A, B, 100_000_000_000)])));
  saveLedger(db, summarize(ledger(11, T + 2, [])));
  assert.deepEqual(db.prepare("SELECT idx, t, seen FROM ledgers ORDER BY idx").all().map((r) => ({ ...r })), [
    { idx: 9, t: T - 3, seen: null },
    { idx: 10, t: T, seen: T + 4 },
    { idx: 11, t: T + 3, seen: null },
  ]);
  // filled in again later (no seen): the first sighting stays
  saveLedger(db, summarize(ledger(10, T + 1, [])));
  assert.equal(db.prepare("SELECT seen FROM ledgers WHERE idx = 10").get().seen, T + 4);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM whales").get().n, 1);
  fs.rmSync(dir, { recursive: true });
});

test("store: missing ledgers, newest first, within a span", () => {
  const { db, dir } = tmpDb();
  for (const i of [3, 4, 7, 10]) saveLedger(db, summarize(ledger(i, 1761000000 + i * 4, [])));
  assert.deepEqual(missing(db, 1, 12), [12, 11, 9, 8, 6, 5, 2, 1]);
  assert.deepEqual(missing(db, 1, 12, 3), [12, 11, 9]);
  assert.deepEqual(missing(db, 5, 6), [6, 5]);
  assert.deepEqual(missing(db, 3, 4), []);
  assert.deepEqual(missing(db, 9, 8), []);
  assert.equal(span(db).count, 4);
  fs.rmSync(dir, { recursive: true });
});

test("store: prune drops old ledgers and their big payments; relabel", () => {
  const { db, dir } = tmpDb();
  const day = 86400, T = 1761000000;
  saveLedger(db, summarize(ledger(1, T - 10 * day, [pay(A, BINANCE, 500_000_000_000)])));
  saveLedger(db, summarize(ledger(2, T - 1 * day, [pay(A, B, 500_000_000_000)])));
  assert.equal(prune(db, 5, T), 1);
  assert.deepEqual(db.prepare("SELECT idx FROM ledgers").all().map((r) => r.idx), [2]);
  assert.deepEqual(db.prepare("SELECT idx FROM whales").all().map((r) => r.idx), [2]);
  db.prepare("UPDATE whales SET dst = ?").run(KRAKEN);
  assert.equal(relabel(db, EXCHANGES), 1);
  assert.equal(db.prepare("SELECT dst_name FROM whales").get().dst_name, "Kraken");
  fs.rmSync(dir, { recursive: true });
});

// The ledger's own exchange, on real transactions saved from the ledger (test/fixtures/dex-*.json), each checked
// by hand against what the transaction asked for (its SendMax, TakerGets, TakerPays)
const real = (name) => summarize(JSON.parse(fs.readFileSync(new URL(`./fixtures/dex-${name}.json`, import.meta.url)))).row;
const dexOf = (row) => Object.fromEntries(DEX_COLS.map((c) => [c, row[c]]));
const none = { dex_got: 0, dex_paid: 0, amm_got: 0, amm_paid: 0, dex_bridge: 0, dex_fills: 0, amm_swaps: 0 };

test("DEX: taker's XRP paid to the order book, a part fill and a full one", () => {
  // a payment spending at most 0.052764 XRP for a token, through one offer it partly filled
  assert.deepEqual(dexOf(real("partial")), { ...none, dex_paid: 0.052764, dex_fills: 1 });
  // an offer selling 1437 XRP for RLUSD: 5 XRP of it crossed at once, filling one offer completely
  assert.deepEqual(dexOf(real("full")), { ...none, dex_paid: 5, dex_fills: 1 });
});

test("DEX: XRP received from the order book and from a pool", () => {
  // an offer asking 0.53002 XRP for RLUSD got 0.530185 (a better price)
  assert.deepEqual(dexOf(real("buy_book")), { ...none, dex_got: 0.530185, dex_fills: 1 });
  // an offer asking 0.2313 XRP took it out of an AMM pool
  assert.deepEqual(dexOf(real("buy_amm")), { ...none, dex_got: 0.2313, amm_got: 0.2313, amm_swaps: 1 });
});

test("DEX: a swap into a pool counts; a withdrawal from one doesn't", () => {
  // a payment spending up to 5 XRP: the pool's XRP went up by 4.999997
  assert.deepEqual(dexOf(real("amm_swap")), { ...none, dex_paid: 4.999997, amm_paid: 4.999997, amm_swaps: 1 });
  assert.deepEqual(dexOf(real("amm_deposit")), none);
});

test("DEX: token to token through XRP is bridged, not bought and sold", () => {
  const r = real("bridged");
  assert.equal(r.dex_got, 0.754917);
  assert.equal(r.dex_paid, 0.754917);
  assert.equal(r.dex_bridge, 0.754917);
  assert.equal(r.dex_fills, 2);
});

test("DEX: an offer removed unfilled, crossing your own offer, and a failed transaction don't count", () => {
  assert.deepEqual(dexOf(real("cancel")), none);
  const own = { ModifiedNode: { LedgerEntryType: "Offer", FinalFields: { Account: A, TakerGets: "1000000", TakerPays: { currency: "USD", issuer: B, value: "1" } }, PreviousFields: { TakerGets: "3000000", TakerPays: { currency: "USD", issuer: B, value: "3" } } } };
  const other = { ModifiedNode: { ...own.ModifiedNode, FinalFields: { ...own.ModifiedNode.FinalFields, Account: B } } };
  const row = summarize(ledger(101, 1761000040, [
    tx({ TransactionType: "OfferCreate", Account: A }, { ...ok, AffectedNodes: [own] }),
    tx({ TransactionType: "OfferCreate", Account: A }, { TransactionResult: "tecKILLED", AffectedNodes: [other] }),
    tx({ TransactionType: "OfferCreate", Account: A }, { ...ok, AffectedNodes: [other] }),
  ])).row;
  // only the last: A took 2 XRP from B's offer
  assert.deepEqual(dexOf(row), { ...none, dex_got: 2, dex_fills: 1 });
});

test("store layout 2: a layout 1 store gets the DEX columns, NULL on its rows; new rows are counted", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "xrpl-layout-")), "x.sqlite");
  // a layout 1 store with a ledger in it, as 0.1.12's collector left it
  openDb(file).close();
  const old = new DatabaseSync(file);
  old.exec("INSERT INTO ledgers (idx, close, res, t, seen, txs, failed, batch, money, markets, nfts, accounts, other, xrp, pays, ex_in, ex_out, fees, created) VALUES (7, 1761000000, 10, 1761000000, NULL, 1, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 12, 0)");
  old.exec("DROP INDEX IF EXISTS ledgers_dex_t");
  for (const c of DEX_COLS) old.exec(`ALTER TABLE ledgers DROP COLUMN ${c}`);
  old.exec("PRAGMA user_version = 1");
  old.close();
  const db = openDb(file);
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, SCHEMA);
  assert.deepEqual(dexOf(db.prepare("SELECT * FROM ledgers WHERE idx = 7").get()), Object.fromEntries(DEX_COLS.map((c) => [c, null])));
  saveLedger(db, summarize(JSON.parse(fs.readFileSync(new URL("./fixtures/dex-buy_book.json", import.meta.url)))));
  assert.equal(db.prepare("SELECT dex_got FROM ledgers WHERE dex_got IS NOT NULL").get().dex_got, 0.530185);
});
